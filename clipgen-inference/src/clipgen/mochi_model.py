import asyncio
import os
import time
from pathlib import Path
from typing import Dict, Any

import imageio
import numpy as np
import torch
from huggingface_hub import hf_hub_download

from model_interface import ModelInterface
from clipgen.coordinator import coordinate_pod_work
from clipgen.util import dump_mochi_weights_info

import sys
print("Python path:", sys.path)
import mochi
print("Mochi path:", mochi.__file__)

# Multi-GPU configuration
# Benefits: Distributes model weights across GPUs, faster inference for large models
# Tradeoffs: Added complexity, Ray overhead, potential for distributed failures
USE_MULTI_GPU = False

class MochiModel(ModelInterface):
    def __init__(self):
        self.weights_dir = Path("/tmp/mochi_models/weights")

        self.pipeline = None
        self._initialized = False

        # Model files to download
        self.model_files = [
            ("genmo/mochi-1-preview", "decoder.safetensors"),
            ("genmo/mochi-1-preview", "dit.safetensors"),
            ("comfyanonymous/flux_text_encoders", "t5xxl_fp16.safetensors"),
        ]

    async def _download_models(self) -> None:
        """Download Mochi model files from HuggingFace if not already present."""
        # Enable hf_transfer for faster downloads
        os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "1"

        def all_models_exist() -> bool:
            return all(
                (self.weights_dir / path).exists()
                for _, path in self.model_files
            )

        async def download_missing_models() -> None:
            for repo_id, path in self.model_files:
                local_file_path = self.weights_dir / path

                if not local_file_path.exists():
                    print(f"Downloading {path} from {repo_id}...")

                    try:
                        downloaded_path = await asyncio.to_thread(
                            hf_hub_download,
                            repo_id=repo_id,
                            filename=path,
                            local_dir=str(self.weights_dir),
                            local_dir_use_symlinks=False
                        )

                        Path(downloaded_path).rename(local_file_path)
                        print(f"Downloaded {path}")

                    except Exception as e:
                        print(f"Failed to download {path}: {e}")
                        # Clean up any partial downloads
                        try:
                            Path(downloaded_path).unlink()
                        except (NameError, FileNotFoundError):
                            pass
                        raise
                else:
                    print(f"{path} already exists")

        await coordinate_pod_work(
            work_dir=self.weights_dir,
            is_work_complete=all_models_exist,
            do_work=download_missing_models,
            lock_name="download",
            work_description="model downloads",
            max_wait_seconds=1800
        )

    async def initialize(self, gpu_devices: list[int]) -> None:
        """Initialize the Mochi model pipeline."""
        print(f"Initializing Mochi model on GPUs: {gpu_devices}")
        if USE_MULTI_GPU:
            assert len(gpu_devices) >= 2, "At least two GPUs are required for Mochi inference"

        if not gpu_devices or not torch.cuda.is_available():
            raise RuntimeError("GPU(s) not available for Mochi inference")

        if USE_MULTI_GPU:
            print(f"Multi-GPU mode enabled with {len(gpu_devices)} GPUs: {gpu_devices}")

            # Set up the environment for distributed training
            import os
            os.environ['MASTER_ADDR'] = '127.0.0.1'
            os.environ['MASTER_PORT'] = '29500'
            os.environ['NCCL_DEBUG'] = 'INFO'  # For debugging distributed issues

        # Download models if needed
        await self._download_models()

        dump_mochi_weights_info(Path("/tmp/mochi_models"))

        # Import Mochi pipeline components
        if USE_MULTI_GPU:
            from mochi.pipelines import DecoderModelFactory, DitModelFactory
            from mochi.patches.encoder import BetterT5ModelFactory
            from mochi.patches.pipeline import MochiDualGPUPipeline

            print("Loading Multi-GPU Mochi pipeline...")

            text_encoder_factory = BetterT5ModelFactory(self.weights_dir / "t5xxl_fp16.safetensors")
            dit_factory = DitModelFactory(
                model_path=str(self.weights_dir / "dit.safetensors"),
                model_dtype="bf16"  # Multi-GPU requires bf16
            )
            decoder_factory = DecoderModelFactory(
                model_path=str(self.weights_dir / "decoder.safetensors")
            )

            # Initialize Multi-GPU pipeline
            self.pipeline = await asyncio.to_thread(
                MochiDualGPUPipeline,
                text_encoder_factory=text_encoder_factory,
                dit_factory=dit_factory,
                decoder_factory=decoder_factory
            )
            print(f"Multi-GPU pipeline initialized with {len(gpu_devices)} GPUs")
        else:
            from mochi.pipelines import (
                MochiSingleGPUPipeline,
                DitModelFactory,
                DecoderModelFactory
            )
            from mochi.patches.encoder import BetterT5ModelFactory

            print("Loading Single-GPU Mochi pipeline...")

            text_encoder_factory = BetterT5ModelFactory(self.weights_dir / "t5xxl_fp16.safetensors")
            dit_factory = DitModelFactory(
                model_path=str(self.weights_dir / "dit.safetensors"),
                model_dtype="bf16"
            )
            decoder_factory = DecoderModelFactory(
                model_path=str(self.weights_dir / "decoder.safetensors")
            )

            # Initialize the Single-GPU pipeline with tiled decoding for memory efficiency
            self.pipeline = await asyncio.to_thread(
                MochiSingleGPUPipeline,
                text_encoder_factory=text_encoder_factory,
                dit_factory=dit_factory,
                decoder_factory=decoder_factory,
                cpu_offload=False,
                decode_type="tiled_spatial",
                decode_args=dict(overlap=8)
            )

        self._initialized = True
        print("Mochi model initialized successfully")

    async def generate(self, input_data: Dict[str, Any]) -> Path:
        """Generate a video using the Mochi model."""
        if not self._initialized:
            raise RuntimeError("Model not initialized. Call initialize() first.")

        prompt = input_data.get("prompt", "")
        if not prompt:
            raise ValueError("Prompt is required for Mochi generation")

        # Extract generation parameters with Mochi-specific defaults
        negative_prompt = input_data.get("negative_prompt", "")
        num_frames = int(input_data.get("num_frames", 25))
        height = int(input_data.get("height", 480))
        width = int(input_data.get("width", 848))
        num_inference_steps = int(input_data.get("num_inference_steps", 64))
        guidance_scale = float(input_data.get("guidance_scale", 6.0))
        seed = int(input_data.get("seed", 42))

        # Mochi constraint: (num_frames - 1) must be divisible by 6
        if (num_frames - 1) % 6 != 0:
            # Find the nearest valid frame count
            valid_frames = ((num_frames - 1) // 6 + 1) * 6 + 1
            print(f"⚠️ Adjusting num_frames from {num_frames} to {valid_frames} (Mochi constraint: (frames-1) % 6 == 0)")
            num_frames = valid_frames

        print(f"Generating video for prompt: '{prompt}'")
        print(f"Parameters: {num_frames} frames, {height}x{width}, {num_inference_steps} steps, guidance: {guidance_scale}")

        # Create the output directory
        output_dir = Path(f"/tmp/outputs/{int(time.time())}")
        output_dir.mkdir(parents=True, exist_ok=True)

        # Prepare Mochi pipeline arguments
        from mochi.pipelines import linear_quadratic_schedule

        # Create sigma and cfg schedules
        sigma_schedule = linear_quadratic_schedule(num_inference_steps, 0.025)
        cfg_schedule = [guidance_scale] * num_inference_steps

        pipeline_args = {
            "seed": seed,
            "num_frames": num_frames,
            "height": height,
            "width": width,
            "num_inference_steps": num_inference_steps,
            "sigma_schedule": sigma_schedule,
            "cfg_schedule": cfg_schedule
        }

        # Generate video frames
        print("Running inference...")

        if USE_MULTI_GPU and hasattr(self.pipeline, 'ctxs'):
            # Multi-GPU pipeline call - Ray handles the distribution
            print("Running multi-GPU inference...")
            frames = await asyncio.to_thread(
                self.pipeline,
                batch_cfg=True,  # Don't batch positive/negative prompts
                prompt=prompt,
                negative_prompt=negative_prompt,
                **pipeline_args
            )
        else:
            # Single-GPU pipeline call
            print("Running single-GPU inference...")
            frames = await asyncio.to_thread(
                self.pipeline,
                batch_cfg=False,  # Don't batch positive/negative prompts
                prompt=prompt,
                negative_prompt=negative_prompt,
                **pipeline_args
            )

        # Save video
        output_path = output_dir / f"mochi_video_{seed}.mp4"
        await asyncio.to_thread(self._save_video, frames, output_path, fps=24)

        print(f"Video generated: {output_path}")
        return output_path

    def _save_video(self, frames: np.ndarray, output_path: Path, fps: int):
        """Save the numpy frames to a MP4 file."""
        print(f"Saving video with shape {frames.shape} to {output_path}")

        # Handle different frame shapes from single-GPU vs multi-GPU pipelines
        if len(frames.shape) == 5:
            # Multi-GPU returns (batch, frames, height, width, channels) - remove batch dim
            frames = frames[0]
        elif len(frames.shape) == 4:
            # Single-GPU returns (frames, height, width, channels) - already correct
            pass
        else:
            raise ValueError(f"Unexpected frame shape: {frames.shape}")

        print(f"Adjusted frame shape: {frames.shape}")

        # Ensure values are in [0, 255] range
        if frames.max() <= 1.0:
            frames = (frames * 255).astype(np.uint8)
        else:
            frames = frames.astype(np.uint8)

        # Save as MP4
        with imageio.get_writer(str(output_path), fps=fps, codec='libx264') as writer:
            for frame in frames:
                writer.append_data(frame)

    async def cleanup(self) -> None:
        """Clean up model resources."""

        # todo: deal with "WARNING: destroy_process_group() was not called before program exit, which can leak resources. For more info, please see https://pytorch.org/docs/stable/distributed.html#shutdown (function operator())"

        if self.pipeline:
            # Special cleanup for multi-GPU Ray actors
            if USE_MULTI_GPU and hasattr(self.pipeline, 'ctxs'):
                try:
                    import ray
                    # Gracefully shutdown Ray actors
                    for ctx in self.pipeline.ctxs:
                        ray.kill(ctx)
                    ray.shutdown()
                    print("Ray actors cleaned up")
                except Exception as e:
                    print(f"Warning: Ray cleanup failed: {e}")

            del self.pipeline
            self.pipeline = None

        # Clear CUDA cache if using GPU
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        self._initialized = False
        print("Mochi model cleaned up")

    @property
    def model_name(self) -> str:
        return "mochi"
