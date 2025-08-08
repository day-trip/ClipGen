from functools import partial

import torch
from safetensors.torch import load_file
from torch.distributed.fsdp.wrap import transformer_auto_wrap_policy
from transformers import T5Config, T5EncoderModel
from transformers.modeling_utils import no_init_weights
from transformers.models.t5.modeling_t5 import T5Block

from mochi.pipelines import ModelFactory, T5_MODEL, setup_fsdp_sync


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
