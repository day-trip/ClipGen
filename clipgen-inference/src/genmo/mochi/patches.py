from functools import partial
from pathlib import Path

import ray
import torch
import torch.distributed as dist
import torch.nn as nn
from safetensors.torch import load_file
from torch.distributed.fsdp.wrap import transformer_auto_wrap_policy, lambda_auto_wrap_policy
from transformers import T5EncoderModel, T5Config
from transformers.modeling_utils import no_init_weights
from transformers.models.t5.modeling_t5 import T5Block

import genmo.mochi.dit.context_parallel as cp
from genmo.mochi.pipelines import ModelFactory, get_conditioning, sample_model, t5_tokenizer
from genmo.mochi.pipelines import T5_MODEL, setup_fsdp_sync
from genmo.mochi.util.utils import Timer
from genmo.mochi.vae.cp_conv import gather_all_frames
from genmo.mochi.vae.models import normalize_decoded_frames


class BetterT5ModelFactory(ModelFactory):
    """
    Newer versions of `T5EncoderModel` can no longer load .bin models, so we need custom logic for loading
    the safetensors file instead.
    """

    def __init__(self, safetensors_path):
        super().__init__()
        self.safetensors_path = safetensors_path
        self.model_dir = T5_MODEL

    def get_model(self, *, local_rank, device_id, world_size):
        super().get_model(local_rank=local_rank, device_id=device_id, world_size=world_size)

        # todo: cache config download too?
        config = T5Config.from_pretrained(self.model_dir)
        with no_init_weights():
            model = T5EncoderModel(config)

        # Load weights from local safetensors
        state_dict = load_file(self.safetensors_path, device=f"cuda:{device_id}")
        model.load_state_dict(state_dict, strict=False, assign=True)

        if world_size > 1:
            model = setup_fsdp_sync(
                model,
                device_id=device_id,
                param_dtype=torch.float32,
                auto_wrap_policy=partial(
                    transformer_auto_wrap_policy,
                    transformer_layer_cls={
                        T5Block,
                    },
                ),
            )
        elif isinstance(device_id, int):
            model = model.to(torch.device(f"cuda:{device_id}"))

        return model.eval()


class PreshardedDitModelFactory(ModelFactory):
    def __init__(self, *, shards_dir: Path, model_dtype: str):
        self.shards_dir = shards_dir

        super().__init__(
            model_path=None,  # We are handling model loading ourselves
            model_dtype=model_dtype,
            attention_mode="flash"  # Make life simple for everyone and always use flash
        )

    def get_model(
            self,
            *,
            local_rank,
            device_id,
            world_size,
            model_kwargs=None,
            strict_load=True,
            load_checkpoint=True,
            fast_init=True,
    ):
        from genmo.mochi.dit.asymm_models_joint import AsymmDiTJoint

        if not model_kwargs:
            model_kwargs = {}

        model_args = dict(depth=48, patch_size=2, num_heads=24, hidden_size_x=3072, hidden_size_y=1536,
                          mlp_ratio_x=4.0, mlp_ratio_y=4.0, in_channels=12, qk_norm=True, qkv_bias=False,
                          out_bias=True, patch_embed_bias=True, timestep_mlp_bias=True, timestep_scale=1000.0,
                          t5_feat_dim=4096, t5_token_length=256, rope_theta=10000.0,
                          attention_mode=self.kwargs["attention_mode"], **model_kwargs)

        t = Timer()

        print("Creating model structure...")

        if fast_init:
            model: nn.Module = torch.nn.utils.skip_init(AsymmDiTJoint, **model_args)
        else:
            model: nn.Module = AsymmDiTJoint(**model_args)

        print("Setting up FSDP wrapping...")

        # Step 1: Apply FSDP wrapping FIRST
        with t("fsdp_setup"):
            model = setup_fsdp_sync(
                model,
                device_id=device_id,
                param_dtype=torch.float32,
                sync_module_states=False,
                auto_wrap_policy=partial(
                    lambda_auto_wrap_policy,
                    lambda_fn=lambda m: m in model.blocks,
                ),
            )

        # Load pre-sharded checkpoint for this rank
        print(f"Loading pre-sharded checkpoint for rank {local_rank}...")

        import torch.distributed.checkpoint as dcp
        from torch.distributed.checkpoint.state_dict import _patch_model_state_dict

        # Step 2: Make the FSDP model "stateful"
        # This is the key - patches the empty model to understand distributed loading
        _patch_model_state_dict(model)

        # Step 3: Load using distributed checkpoint
        # Each rank loads only its portion automatically
        checkpoint_dir = str(self.shards_dir)  # Directory containing the distributed checkpoint

        print("Loading checkpoint...")

        with t("checkpoint_load"):
            dcp.load(
                state_dict={"model": model},  # The empty FSDP model to populate
                checkpoint_id=checkpoint_dir, # Directory with distributed checkpoint
            )

        print(f"Rank {local_rank} DiT loading breakdown:")
        t.print_stats()

        return model.eval()


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


def _run_tiled_decode_on_slice(
        decoder,
        z_slice,
        *,
        tile_sample_min_height: int,
        tile_sample_min_width: int,
        tile_overlap_factor_height: float,
        tile_overlap_factor_width: float,
        frame_batch_size: int,
        rank: int = 0,  # MODIFICATION: Added rank to control progress bar visibility.
):
    """
    This function contains the core tiling logic.
    Source: Its body is a direct copy of `decode_latents_tiled_full` from `models.py`.

    MODIFICATIONS:
    1. It operates on `z_slice` (a temporal slice of the full latent tensor) instead of the full `z`.
    2. It accepts a `rank` argument so that the progress bar only displays for the primary GPU (rank 0).
    3. The final `normalize_decoded_frames` call is removed; normalization will be handled by the main wrapper function.
    """
    B, C, T, H, W = z_slice.shape
    assert B == 1, "Tiled decoding only supports batch size 1"

    # --- The following logic is directly copied from `decode_latents_tiled_full` ---
    tile_latent_min_height = int(tile_sample_min_height / 8)
    tile_latent_min_width = int(tile_sample_min_width / 8)

    def blend_v(a: torch.Tensor, b: torch.Tensor, blend_extent: int) -> torch.Tensor:
        blend_extent = min(a.shape[3], b.shape[3], blend_extent)
        for y in range(blend_extent):
            b[:, :, :, y, :] = a[:, :, :, -blend_extent + y, :] * (1 - y / blend_extent) + b[:, :, :, y, :] * (
                    y / blend_extent
            )
        return b

    def blend_h(a: torch.Tensor, b: torch.Tensor, blend_extent: int) -> torch.Tensor:
        blend_extent = min(a.shape[4], b.shape[4], blend_extent)
        for x in range(blend_extent):
            b[:, :, :, :, x] = a[:, :, :, :, -blend_extent + x] * (1 - x / blend_extent) + b[:, :, :, :, x] * (
                    x / blend_extent
            )
        return b

    overlap_height = int(tile_latent_min_height * (1 - tile_overlap_factor_height))
    overlap_width = int(tile_latent_min_width * (1 - tile_overlap_factor_width))
    blend_extent_height = int(tile_sample_min_height * tile_overlap_factor_height)
    blend_extent_width = int(tile_sample_min_width * tile_overlap_factor_width)
    row_limit_height = tile_sample_min_height - blend_extent_height
    row_limit_width = tile_sample_min_width - blend_extent_width

    # MODIFICATION: Removed progress bar

    rows = []
    for i in range(0, H, overlap_height):
        row = []
        for j in range(0, W, overlap_width):
            temporal = []
            # Handle cases where T is smaller than frame_batch_size
            num_temporal_batches = T // frame_batch_size
            if T % frame_batch_size != 0:
                num_temporal_batches += 1

            for k in range(num_temporal_batches):
                start_frame = k * frame_batch_size
                end_frame = min((k + 1) * frame_batch_size, T)
                if start_frame >= end_frame: continue

                tile = z_slice[
                       :,
                       :,
                       start_frame:end_frame,
                       i: i + tile_latent_min_height,
                       j: j + tile_latent_min_width,
                       ]
                tile = decoder(tile)
                temporal.append(tile)
            row.append(torch.cat(temporal, dim=2))
        rows.append(row)

    result_rows = []
    for i, row in enumerate(rows):
        result_row = []
        for j, tile in enumerate(row):
            if i > 0:
                tile = blend_v(rows[i - 1][j], tile, blend_extent_height)
            if j > 0:
                tile = blend_h(row[j - 1], tile, blend_extent_width)
            result_row.append(tile[:, :, :, :row_limit_height, :row_limit_width])
        result_rows.append(torch.cat(result_row, dim=4))

    # MODIFICATION: Return the raw tensor. Normalization is handled outside this helper.
    return torch.cat(result_rows, dim=3)


@torch.inference_mode()
def decode_latents_tiled_distributed(
        decoder,
        z,
        *,
        tile_sample_min_height: int = 240,
        tile_sample_min_width: int = 424,
        tile_overlap_factor_height: float = 0.1666,
        tile_overlap_factor_width: float = 0.2,
        frame_batch_size: int = 16,  # Mini-optimization: Default to a safe batch size
):
    """
    This is the main function to be called from the pipeline.
    It combines the distributed logic from `decode_latents` with the tiling logic
    from `decode_latents_tiled_full` to perform a memory-efficient, parallel decode.
    """
    # --- Step 1: Split workload across GPUs ---
    # Source: Logic from `models.py:decode_latents`
    cp_rank, cp_size = cp.get_cp_rank_size()
    if cp_size > 1:
        z_slice = z.tensor_split(cp_size, dim=2)[cp_rank]
    else:
        z_slice = z

    # --- Step 2: Run tiled decoding on each GPU's slice ---
    decoded_slice = _run_tiled_decode_on_slice(
        decoder,
        z_slice,
        tile_sample_min_height=tile_sample_min_height,
        tile_sample_min_width=tile_sample_min_width,
        tile_overlap_factor_height=tile_overlap_factor_height,
        tile_overlap_factor_width=tile_overlap_factor_width,
        frame_batch_size=frame_batch_size,
        rank=cp_rank,
    )

    # --- Step 3: Gather results from all GPUs ---
    # Source: Logic from `models.py:decode_latents`
    if cp_size > 1:
        samples = gather_all_frames(decoded_slice)
    else:
        samples = decoded_slice

    # --- Step 4: Normalize and return the final video tensor ---
    return normalize_decoded_frames(samples)
