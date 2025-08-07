from typing import Tuple, Union

import torch
import torch.distributed as dist
import torch.nn.functional as F

import genmo.mochi.dit.context_parallel as cp


def cast_tuple(t, length=1):
    return t if isinstance(t, tuple) else ((t,) * length)


def cp_pass_frames(x: torch.Tensor, frames_to_send: int) -> torch.Tensor:
    """
    Forward pass that handles communication between ranks for inference.
    Args:
        x: Tensor of shape (B, C, T, H, W)
        frames_to_send: int, number of frames to communicate between ranks
    Returns:
        output: Tensor of shape (B, C, T', H, W)
    """
    cp_rank, cp_world_size = cp.get_cp_rank_size()
    if frames_to_send == 0 or cp_world_size == 1:
        return x

    group = cp.get_cp_group()
    global_rank = dist.get_rank()

    # Send to next rank
    if cp_rank < cp_world_size - 1:
        assert x.size(2) >= frames_to_send
        tail = x[:, :, -frames_to_send:].contiguous()
        dist.send(tail, global_rank + 1, group=group)

    # Receive from previous rank
    if cp_rank > 0:
        B, C, _, H, W = x.shape
        recv_buffer = torch.empty(
            (B, C, frames_to_send, H, W),
            dtype=x.dtype,
            device=x.device,
        )
        dist.recv(recv_buffer, global_rank - 1, group=group)
        x = torch.cat([recv_buffer, x], dim=2)

    return x


def _pad_to_max(x: torch.Tensor, max_T: int) -> torch.Tensor:
    if max_T > x.size(2):
        pad_T = max_T - x.size(2)
        pad_dims = (0, 0, 0, 0, 0, pad_T)
        return F.pad(x, pad_dims)
    return x


def gather_all_frames(x: torch.Tensor) -> torch.Tensor:
    """
    Gathers all frames from all processes for inference.
    Args:
        x: Tensor of shape (B, C, T, H, W)
    Returns:
        output: Tensor of shape (B, C, T_total, H, W)
    """
    cp_rank, cp_size = cp.get_cp_rank_size()
    if cp_size == 1:
        return x

    cp_group = cp.get_cp_group()

    # Ensure the tensor is contiguous for collective operations
    x = x.contiguous()

    # Get the local time dimension size
    local_T = x.size(2)
    local_T_tensor = torch.tensor([local_T], device=x.device, dtype=torch.int64)

    # Gather all T sizes from all processes
    all_T = [torch.zeros(1, dtype=torch.int64, device=x.device) for _ in range(cp_size)]
    dist.all_gather(all_T, local_T_tensor, group=cp_group)
    all_T = [t.item() for t in all_T]

    # Pad the tensor at the end of the time dimension to match max_T
    max_T = max(all_T)
    x = _pad_to_max(x, max_T).contiguous()

    # Prepare a list to hold the gathered tensors
    gathered_x = [torch.zeros_like(x).contiguous() for _ in range(cp_size)]

    # Perform the all_gather operation
    dist.all_gather(gathered_x, x, group=cp_group)

    # Slice each gathered tensor back to its original T size
    for idx, t_size in enumerate(all_T):
        gathered_x[idx] = gathered_x[idx][:, :, :t_size]

    return torch.cat(gathered_x, dim=2)
