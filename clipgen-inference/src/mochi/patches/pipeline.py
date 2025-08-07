import ray
import torch

import torch.distributed as dist

from mochi.lib.utils import Timer
from mochi.patches.vae import decode_latents_tiled_distributed
from mochi.pipelines import ModelFactory, t5_tokenizer, get_conditioning, sample_model

import mochi.dit.context_parallel as cp


class DualGPUContext:
    def __init__(
            self,
            *,
            text_encoder_factory: ModelFactory,
            dit_factory: ModelFactory,  # Your ShardedDitModelFactory
            decoder_factory: ModelFactory,
            device_id,
            local_rank,
            world_size,
    ):
        t = Timer()
        self.device = torch.device(f"cuda:{device_id}")
        print(f"Initializing rank {local_rank + 1}/{world_size}")

        # Keep the exact same distributed setup as the working version
        assert world_size > 1, f"Multi-GPU mode requires world_size > 1, got {world_size}"

        with t("init_process_group"):
            dist.init_process_group(
                "nccl",
                rank=local_rank,
                world_size=world_size,
                device_id=self.device,
            )
        cp.set_cp_group(dist.group.WORLD, list(range(world_size)), local_rank)

        distributed_kwargs = dict(local_rank=local_rank, device_id=device_id, world_size=world_size)

        with t("load_tokenizer"):
            self.tokenizer = t5_tokenizer(text_encoder_factory.model_dir)

        print(f"Rank {local_rank} starting T5 loading...")
        with t("load_text_encoder"):
            self.text_encoder = text_encoder_factory.get_model(**distributed_kwargs)
        print(f"Rank {local_rank} T5 loading complete!")

        print(f"Rank {local_rank} starting DiT loading...")
        with t("load_dit"):
            self.dit = dit_factory.get_model(**distributed_kwargs)
        print(f"Rank {local_rank} DiT loading complete!")

        print(f"Rank {local_rank} starting VAE loading...")
        with t("load_vae"):
            self.decoder = decoder_factory.get_model(**distributed_kwargs)
        print(f"Rank {local_rank} VAE loading complete!")

        print(f"Rank {local_rank} ALL MODELS LOADED SUCCESSFULLY!")

        self.local_rank = local_rank
        t.print_stats()

    def run(self, *, fn, **kwargs):
        return fn(self, **kwargs)


class MochiDualGPUPipeline:
    def __init__(
            self,
            *,
            text_encoder_factory: ModelFactory,
            dit_factory: ModelFactory,
            decoder_factory: ModelFactory
    ):
        print("Initializing Ray for multi-GPU setup")

        # Configure Ray with explicit settings
        ray.init(num_gpus=2)

        RemoteClass = ray.remote(DualGPUContext)
        self.ctxs = [
            RemoteClass.options(num_gpus=1).remote(
                text_encoder_factory=text_encoder_factory,
                dit_factory=dit_factory,
                decoder_factory=decoder_factory,
                world_size=2,
                device_id=0,  # Ray will handle device assignment
                local_rank=i,
            )
            for i in range(2)
        ]

        # Wait for all contexts to be ready with explicit timeout
        print("Waiting for all Ray actors to initialize...")
        try:
            ready_refs = [ctx.__ray_ready__.remote() for ctx in self.ctxs]
            ray.get(ready_refs, timeout=120)  # 2 minute timeout
            print("All Ray actors initialized successfully")
        except ray.exceptions.GetTimeoutError:
            print("Ray actor initialization timed out!")
            raise

    def __call__(self, **kwargs):
        def sample(ctx, *, batch_cfg, prompt, negative_prompt, **kwargs):
            # CHANGE: removed progress bar - our K8 won't render these anyway
            with torch.inference_mode():
                conditioning = get_conditioning(
                    ctx.tokenizer,
                    ctx.text_encoder,
                    ctx.device,
                    batch_cfg,
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                )
                latents = sample_model(ctx.device, ctx.dit, conditioning=conditioning, **kwargs)
                # CHANGE: no longer saving intermediate state to 'latents.pt'
                frames = decode_latents_tiled_distributed(ctx.decoder, latents)
            return frames.cpu().numpy()

        return ray.get(
            [ctx.run.remote(fn=sample, **kwargs, show_progress=i == 0) for i, ctx in enumerate(self.ctxs)])[0]