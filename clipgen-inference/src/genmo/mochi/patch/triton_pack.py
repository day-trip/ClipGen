import os
import torch

try:
    import triton
    import triton.language as tl
    HAS_TRITON = True
except Exception as e:
    print("SEVERE: Failed to load Triton", e)
    HAS_TRITON = False

USE_TRITON_PACK = os.environ.get("TRITON_PACK", "1") == "1" and HAS_TRITON

def _pick_block_d(D: int) -> int:
    if D <= 64: return 64
    if D <= 128: return 128
    if D <= 256: return 256
    if D <= 512: return 512
    return 1024  # rare, but safe

def _pick_num_warps(D: int) -> int:
    if D <= 128: return 4
    if D <= 256: return 8
    return 8

@triton.jit
def _pack_two_src_kernel(
        qx_ptr, qy_ptr, dst_ptr, idx_ptr,
        B, N, L, D,
        stride_qx_b, stride_qx_n, stride_qx_d,
        stride_qy_b, stride_qy_l, stride_qy_d,
        stride_dst_t, stride_dst_d,
        BLOCK_D: tl.constexpr,
):
    t = tl.program_id(0)
    off_d = tl.arange(0, BLOCK_D)

    idx = tl.load(idx_ptr + t)
    total = N + L
    b = idx // total
    pos = idx % total
    is_x = pos < N

    pos_x = pos
    pos_y = pos - N

    base_dst = dst_ptr + t * stride_dst_t
    mask = off_d < D

    # Load from X only if pos < N
    base_x = qx_ptr + b * stride_qx_b + pos_x * stride_qx_n
    vals_x = tl.load(base_x + off_d * stride_qx_d, mask=mask & is_x, other=0)

    # Load from Y only if pos >= N
    base_y = qy_ptr + b * stride_qy_b + pos_y * stride_qy_l
    vals_y = tl.load(base_y + off_d * stride_qy_d, mask=mask & (~is_x), other=0)

    vals = tl.where(is_x, vals_x, vals_y)
    tl.store(base_dst + off_d * stride_dst_d, vals, mask=mask)

@triton.jit
def _unpack_split_kernel(
        src_ptr, x_ptr, y_ptr, idx_ptr,
        B, N, L, D,
        stride_src_t, stride_src_d,
        stride_x_b, stride_x_n, stride_x_d,
        stride_y_b, stride_y_l, stride_y_d,
        BLOCK_D: tl.constexpr,
):
    t = tl.program_id(0)
    off_d = tl.arange(0, BLOCK_D)

    idx = tl.load(idx_ptr + t)
    total = N + L
    b = idx // total
    pos = idx % total
    is_x = pos < N

    pos_x = pos
    pos_y = pos - N

    base_src = src_ptr + t * stride_src_t
    mask = off_d < D
    vals = tl.load(base_src + off_d * stride_src_d, mask=mask, other=0)

    # Store to exactly one of X or Y
    base_x = x_ptr + b * stride_x_b + pos_x * stride_x_n
    base_y = y_ptr + b * stride_y_b + pos_y * stride_y_l
    tl.store(base_x + off_d * stride_x_d, vals, mask=mask & is_x)
    tl.store(base_y + off_d * stride_y_d, vals, mask=mask & (~is_x))

def _ensure_i32(x: torch.Tensor) -> torch.Tensor:
    return x.to(torch.int32) if x.dtype != torch.int32 else x

@torch.no_grad()
def pack_cat_gather(
        qx: torch.Tensor,  # (B, N, h, d)
        qy: torch.Tensor,  # (B, L, h, d)
        valid_token_indices: torch.Tensor,  # (total,)
) -> torch.Tensor:
    """
    Triton pack: builds (total, h*d) without creating the (B, N+L, h*d) concat buffer.
    Returns tensor with shape (total, h, d) but contiguous as (total, h*d).
    """
    if not USE_TRITON_PACK:
        # Fallback to original: cat + view + gather (PyTorch path)
        B, N, h, d = qx.shape
        L = qy.shape[1]
        D = h * d
        src = torch.cat([qx, qy], dim=1).contiguous().view(B * (N + L), D)
        idx = valid_token_indices.to(src.device)
        out = src.index_select(0, idx)  # (total, D)
        return out.view(-1, h, d)

    assert qx.is_cuda and qy.is_cuda
    B, N, h, d = qx.shape
    L = qy.shape[1]
    D = h * d

    qx2d = qx.contiguous().view(B, N, D)
    qy2d = qy.contiguous().view(B, L, D)
    total = valid_token_indices.numel()
    dst = torch.empty((total, D), device=qx.device, dtype=qx.dtype)

    BLOCK_D = _pick_block_d(D)
    num_warps = _pick_num_warps(D)

    grid = (total,)
    _pack_two_src_kernel[grid](
        qx2d, qy2d, dst, _ensure_i32(valid_token_indices),
        B, N, L, D,
        qx2d.stride(0), qx2d.stride(1), qx2d.stride(2),
        qy2d.stride(0), qy2d.stride(1), qy2d.stride(2),
        dst.stride(0),  dst.stride(1),
        BLOCK_D=BLOCK_D, num_warps=num_warps,
    )
    return dst.view(total, h, d)

@torch.no_grad()
def unpack_split_xy(
        src: torch.Tensor,               # (total, h*d) contiguous
        valid_token_indices: torch.Tensor,  # (total,)
        B: int, N: int, L: int,
) -> tuple[torch.Tensor, torch.Tensor]:
    """
    Triton unpack: scatter 'src' back into X=(B,N,D) and Y=(B,L,D) directly,
    skipping the "fill big buffer then split/pad" step.
    Returns (x2d, y2d) with shapes (B, N, D) and (B, L, D).
    """
    if not USE_TRITON_PACK:
        # Fallback: make a (B*(N+L), D) zero buffer and scatter via index_select/scatter
        D = src.shape[1]
        full = src.new_zeros((B * (N + L), D))
        idx = _ensure_i32(valid_token_indices)
        full.index_copy_(0, idx.to(full.device), src)
        full = full.view(B, N + L, D)
        return full[:, :N], full[:, N:]

    assert src.is_cuda
    total, D = src.shape
    x = torch.zeros((B, N, D), device=src.device, dtype=src.dtype)
    y = torch.zeros((B, L, D), device=src.device, dtype=src.dtype)

    BLOCK_D = _pick_block_d(D)
    num_warps = _pick_num_warps(D)

    grid = (total,)
    _unpack_split_kernel[grid](
        src, x, y, _ensure_i32(valid_token_indices),
        B, N, L, D,
        src.stride(0), src.stride(1),
        x.stride(0), x.stride(1), x.stride(2),
        y.stride(0), y.stride(1), y.stride(2),
        BLOCK_D=BLOCK_D, num_warps=num_warps,
    )
    return x, y
