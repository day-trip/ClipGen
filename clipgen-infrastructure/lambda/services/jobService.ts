import {DynamoDBDocumentClient, GetCommand, PutCommand} from '@aws-sdk/lib-dynamodb';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {SendMessageCommand, SQSClient} from '@aws-sdk/client-sqs';
import {GetObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {v4 as uuidv4} from 'uuid';
import {createJobSchema, formatValidationErrors} from '../types/schemas';
import {getNextTicket} from '../utils/queueCounter';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqsClient = new SQSClient({});
const s3Client = new S3Client({});

// TTL constant for 32 days (for request logs retention)
const TTL_SECONDS = 32 * 24 * 60 * 60; // 32 days

export interface CreateJobResult {
    jobId: string;
    status: string;
    ticketNumber: number;
    createdAt: string;
}

export interface Job {
    jobId: string;
    status: string;
    prompt?: string;
    createdAt: string;
    completedAt?: string;
    videoUrl?: string;
    queuePosition?: number;
    ticketNumber?: number;
    errorMessage?: string;
}

export class JobService {
    static async createJob(userId: string, requestData: any): Promise<CreateJobResult> {
        // Validate with Zod
        const validation = createJobSchema.safeParse(requestData);
        if (!validation.success) {
            throw new Error(formatValidationErrors(validation.error));
        }

        const {
            prompt, height = 480,
            width = 848,
            negative_prompt = "",
            num_frames = 25,
            num_inference_steps = 64,
            guidance_scale = 6.0,
            seed = Math.floor(Math.random() * 2147483647)
        } = validation.data;

        const jobId = `job_${uuidv4().replace(/-/g, '')}`;
        const now = new Date().toISOString();
        const jobNumber = Date.now();

        // Get ticket number for queue position
        const ticketNumber = await getNextTicket(ddbClient);

        // Create job record with all video generation parameters
        const jobRecord = {
            userId, jobId, jobNumber, ticketNumber, status: 'queued', input_data: {
                prompt,
                negative_prompt,
                width, height,
                num_frames,
                num_inference_steps,
                guidance_scale,
                seed
            }, createdAt: now, ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS
        };

        await ddbClient.send(new PutCommand({
            TableName: process.env.JOB_TABLE_NAME!, Item: jobRecord
        }));

        // Send minimal data to SQS
        await sqsClient.send(new SendMessageCommand({
            QueueUrl: process.env.PROCESSING_QUEUE_URL!, MessageBody: JSON.stringify({jobId, userId})
        }));

        return {
            jobId, status: 'queued', ticketNumber, createdAt: now,
        };
    }

    static async getJob(userId: string, jobId: string, options: {
        includeSignedUrl?: boolean
    } = {}): Promise<Job | null> {
        // Get job from DynamoDB
        const result = await ddbClient.send(new GetCommand({
            TableName: process.env.JOB_TABLE_NAME!, Key: {userId, jobId}
        }));

        if (!result.Item) {
            return null;
        }

        const job = result.Item;

        // Generate video URL based on options
        let videoUrl = null;
        if (job.status === 'completed' && job.videoUrl) {
            if (options.includeSignedUrl) {
                // Parse S3 URL (format: s3://bucket/key) to extract bucket and key for signed URL
                const s3UrlMatch = job.videoUrl.match(/^s3:\/\/([^\/]+)\/(.+)$/);
                if (s3UrlMatch) {
                    const [, bucket, key] = s3UrlMatch;
                    videoUrl = await getSignedUrl(s3Client, new GetObjectCommand({
                        Bucket: bucket, Key: key
                    }), {expiresIn: 3600}); // 1 hour
                }
            } else {
                // For internal endpoints, parse videoUrl from outputKey if needed (for backward compatibility)
                videoUrl = job.videoUrl;
                if (!videoUrl && job.outputKey) {
                    // If only outputKey exists, construct the S3 URL
                    videoUrl = `https://${process.env.MEDIA_BUCKET_NAME}.s3.amazonaws.com/${job.outputKey}`;
                }
            }
        }

        return {
            jobId: job.jobId,
            status: job.status,
            prompt: job.input_data?.prompt || job.prompt,
            createdAt: job.createdAt,
            completedAt: job.completedAt,
            videoUrl,
            ticketNumber: job.ticketNumber,
            errorMessage: job.errorMessage
        };
    }
}