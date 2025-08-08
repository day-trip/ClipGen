from functools import partial
from pathlib import Path

import torch
import torch.nn as nn
from genmo.mochi.util.utils import Timer
from torch.distributed.fsdp.wrap import lambda_auto_wrap_policy

from genmo.mochi.pipelines import ModelFactory
from genmo.mochi.pipelines import setup_fsdp_sync


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
