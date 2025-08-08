import asyncio
import json
import os
import signal
import time
import traceback
from pathlib import Path
from typing import Dict, Any

from inference_engine import InferenceRequest, create_inference_engine
from monitoring import GPUMonitor, setup_logging
from prometheus_client import Counter, Histogram, Gauge, start_http_server

# Metrics
JOBS_PROCESSED = Counter('jobs_processed_total', 'Total jobs processed', ['status'])
PROCESSING_TIME = Histogram('job_processing_seconds', 'Time spent processing jobs')
GPU_MEMORY_USAGE = Gauge('gpu_memory_used_bytes', 'GPU memory usage', ['gpu_id'])
QUEUE_DEPTH = Gauge('sqs_queue_depth', 'Current SQS queue depth')

logger = setup_logging()

class WorkerConfig:
    def __init__(self):
        self.queue_url = os.environ['SQS_QUEUE_URL']
        self.s3_bucket = os.environ['MEDIA_BUCKET_NAME']
        self.job_table = os.environ['JOB_TABLE_NAME']
        self.max_concurrent_jobs = int(os.environ.get('MAX_CONCURRENT_JOBS', '1'))
        self.gpu_devices = [int(x) for x in os.environ.get('CUDA_VISIBLE_DEVICES', '0,1').split(',')]

class SpeechfaceWorker:
    def __init__(self, config: WorkerConfig):
        self.config = config
        self.running = True
        self.current_jobs = 0

        # AWS clients - use aioboto3 for async operations
        import aioboto3
        self.session = aioboto3.Session()

        # Initialize inference engine
        self.inference_engine = create_inference_engine(
            model_type=os.environ.get('MODEL_TYPE', 'mochi'),
            gpu_devices=config.gpu_devices
        )

        # GPU monitoring
        self.gpu_monitor = GPUMonitor(config.gpu_devices)

        # Signal handlers
        signal.signal(signal.SIGTERM, self._shutdown_handler)
        signal.signal(signal.SIGINT, self._shutdown_handler)

        logger.info(f"Worker initialized with {len(config.gpu_devices)} GPUs")

    def _shutdown_handler(self, _sig, _frame):
        logger.info("Received shutdown signal, finishing current jobs...")
        self.running = False

    async def start(self):
        """Start the worker with monitoring"""
        # Initialize the inference engine
        await self.inference_engine.initialize()

        # Start the Prometheus metrics server
        start_http_server(8000)

        # Start GPU monitoring task
        monitor_task = asyncio.create_task(self._monitor_loop())

        # Start the main processing loop
        try:
            await self._process_loop()
        finally:
            monitor_task.cancel()
            await self.inference_engine.cleanup()

    async def _monitor_loop(self):
        """Background monitoring task"""
        while self.running:
            try:
                # Update GPU metrics
                gpu_stats = self.gpu_monitor.get_stats()
                for gpu_id, stats in gpu_stats.items():
                    GPU_MEMORY_USAGE.labels(gpu_id=gpu_id).set(stats['memory_used'])

                # Update queue depth (approximate)
                async with self.session.client('sqs') as sqs:
                    queue_attrs = await sqs.get_queue_attributes(
                        QueueUrl=self.config.queue_url,
                        AttributeNames=['ApproximateNumberOfMessages']
                    )
                QUEUE_DEPTH.set(int(queue_attrs['Attributes']['ApproximateNumberOfMessages']))

                await asyncio.sleep(10)  # Monitor every 10 seconds
            except Exception as e:
                logger.error(f"Monitoring error: {e}")

    async def _process_loop(self):
        """Main SQS processing loop"""
        while self.running:
            try:
                if self.current_jobs >= self.config.max_concurrent_jobs:
                    await asyncio.sleep(1)
                    continue

                # Poll SQS asynchronously
                async with self.session.client('sqs') as sqs:
                    response = await sqs.receive_message(
                        QueueUrl=self.config.queue_url,
                        MaxNumberOfMessages=1,
                        WaitTimeSeconds=5,
                        MessageAttributeNames=['All']
                    )

                messages = response.get('Messages', [])
                if not messages:
                    continue

                # Process message
                message = messages[0]
                task = asyncio.create_task(self._process_message(message))
                self.current_jobs += 1

                # Don't await - let it run concurrently
                def job_finished(_task):
                    self.current_jobs -= 1
                task.add_done_callback(job_finished)

            except Exception as e:
                logger.error(f"Process loop error: {e}")
                await asyncio.sleep(5)


    async def _process_message(self, message: Dict[str, Any]):
        """Process a single SQS message"""
        receipt_handle = message['ReceiptHandle']

        try:
            # Parse message - SQS now only contains job identifiers
            body = json.loads(message['Body'])
            job_id = body['jobId']
            user_id = body['userId']

            logger.info(f"Processing job {job_id}")

            # Fetch full job data from DynamoDB
            job_data = await self._get_job_data(user_id, job_id)
            if not job_data:
                logger.error(f"Job {job_id} not found in database")
                return

            # Update job status to processing
            await self._update_job_status(user_id, job_id, 'processing')

            with PROCESSING_TIME.time():
                # Create an inference request with input_data from DynamoDB
                request = InferenceRequest(
                    job_id=job_id,
                    user_id=user_id,
                    input_data=job_data.get('input_data', {}),  # JSON data from DynamoDB
                    s3_bucket=self.config.s3_bucket
                )

                # Run inference
                result = await self.inference_engine.process(request)

                # Upload the result to S3
                output_key = f"output/{job_id}.mp4"
                await self._upload_result(result.video_path, output_key)

                # Update job status to completed
                await self._update_job_status(
                    user_id, job_id, 'completed',
                    video_url=f"s3://{self.config.s3_bucket}/{output_key}",
                    processing_time=result.processing_time
                )

            JOBS_PROCESSED.labels(status='success').inc()
            logger.info(f"Job {job_id} completed successfully")

        except Exception as e:
            logger.error(f"Job processing failed: {e}")
            logger.error(traceback.format_exc())

            try:
                body = json.loads(message['Body'])
                await self._update_job_status(
                    body['userId'], body['jobId'], 'failed',
                    error=str(e)
                )
            except Exception as e:
                logger.error(f"Failed to update job status after processing failure: {e}")
                pass

            JOBS_PROCESSED.labels(status='error').inc()

        finally:
            # Always delete the message
            try:
                async with self.session.client('sqs') as sqs:
                    await sqs.delete_message(
                        QueueUrl=self.config.queue_url,
                        ReceiptHandle=receipt_handle
                    )
            except Exception as e:
                logger.error(f"Failed to delete SQS message: {e}")

    async def _get_job_data(self, user_id: str, job_id: str) -> Dict[str, Any]:
        """Fetch job data from DynamoDB"""
        try:
            async with self.session.resource('dynamodb') as dynamodb:
                table = await dynamodb.Table(self.config.job_table)
                response = await table.get_item(
                    Key={'userId': user_id, 'jobId': job_id}
                )
                return response.get('Item', {})
        except Exception as e:
            logger.error(f"Failed to fetch job data: {e}")
            return {}

    async def _update_job_status(self, user_id: str, job_id: str, status: str, **kwargs):
        """Update job status in DynamoDB"""
        from decimal import Decimal
        update_expr = "SET #status = :status, updatedAt = :now"
        expr_values = {
            ':status': status,
            ':now': Decimal(str(time.time()))
        }
        expr_names = {'#status': 'status'}

        # Add optional fields
        if 'video_url' in kwargs:
            update_expr += ", videoUrl = :video_url"
            expr_values[':video_url'] = kwargs['video_url']

        # if 'processing_time' in kwargs:
        #     update_expr += ", processingTime = :processing_time"
        #     expr_values[':processing_time'] = Decimal(str(kwargs['processing_time']))

        if 'error' in kwargs:
            update_expr += ", errorMessage = :error"
            expr_values[':error'] = kwargs['error']

        if status == 'completed':
            update_expr += ", completedAt = :now"

        async with self.session.resource('dynamodb') as dynamodb:
            table = await dynamodb.Table(self.config.job_table)
            await table.update_item(
                Key={'userId': user_id, 'jobId': job_id},
                UpdateExpression=update_expr,
                ExpressionAttributeValues=expr_values,
                ExpressionAttributeNames=expr_names
            )

    async def _upload_result(self, local_path: Path, s3_key: str):
        """Upload result video to S3"""
        async with self.session.client('s3') as s3:
            await s3.upload_file(str(local_path), self.config.s3_bucket, s3_key)
        # Clean up the local file
        local_path.unlink()

async def main():
    config = WorkerConfig()
    worker = SpeechfaceWorker(config)

    logger.info("Starting Speechface worker...")
    await worker.start()

if __name__ == "__main__":
    asyncio.run(main())