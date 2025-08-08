import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Any, Optional

from clipgen.model_interface import ModelInterface
from clipgen.mochi import MochiModel


@dataclass
class InferenceRequest:
    job_id: str
    user_id: str
    input_data: Dict[str, Any]  # JSON from job table
    s3_bucket: str

@dataclass
class InferenceResult:
    job_id: str
    video_path: Path
    processing_time: float
    metadata: Optional[Dict[str, Any]] = None


class InferenceEngine:
    """Main inference engine that delegates to model implementations"""

    def __init__(self, model_type: str, gpu_devices: list[int]):
        self.model_type = model_type
        self.gpu_devices = gpu_devices

        # Model registry
        self.models = {
            'mochi': MochiModel
        }

        if model_type not in self.models:
            raise ValueError(f"Unknown model type: {model_type}")

        self.model: ModelInterface = self.models[model_type]()

    async def initialize(self) -> None:
        """Initialize the inference engine"""
        await self.model.initialize(self.gpu_devices)
        print(f"Inference engine initialized with {self.model.model_name}")

    async def process(self, request: InferenceRequest) -> InferenceResult:
        """Process an inference request"""
        start_time = time.time()

        try:
            # Generate video
            video_path = await self.model.generate(request.input_data)

            processing_time = time.time() - start_time

            return InferenceResult(
                job_id=request.job_id,
                video_path=video_path,
                processing_time=processing_time,
                metadata={
                    'model': self.model.model_name,
                    'gpu_devices': self.gpu_devices
                }
            )

        except Exception as e:
            # Clean up any partial results
            await self.model.cleanup()
            raise e

    async def cleanup(self) -> None:
        """Clean up the inference engine"""
        await self.model.cleanup()

# Factory function for easy model switching
def create_inference_engine(model_type: str = None, gpu_devices: list[int] = None) -> InferenceEngine:
    """Factory function to create an inference engine based on environment or parameters"""
    import os

    model_type = model_type or os.environ.get('MODEL_TYPE', 'mochi')
    gpu_devices = gpu_devices or [int(x) for x in os.environ.get('CUDA_VISIBLE_DEVICES', '0').split(',')]

    return InferenceEngine(model_type, gpu_devices)