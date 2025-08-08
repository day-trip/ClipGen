import torch

try:
    from . import _C  # noqa: F401
except Exception as e:
    print("Failed to load CUDA kernels, falling back to pure Python", e)

def _residual_tanh_gated_rmsnorm_pytorch(x, x_res, gate, eps=1e-6):
    # Reference fallback (runs on CPU or when CUDA op is unavailable)
    # Broadcast gate to x's shape
    gate_b = torch.broadcast_to(gate, x.shape)
    x_res_f = x_res.float()
    mean_square = (x_res_f * x_res_f).mean(-1, keepdim=True)
    scale = torch.rsqrt(mean_square + eps)
    tanh_gate = torch.tanh(gate_b)
    x_normed = x_res_f * scale * tanh_gate
    return x + x_normed.to(dtype=x.dtype)

def fused_residual_tanh_gated_rmsnorm(x, x_res, gate, eps=1e-6, exact_mode=False):
    """
    Fused CUDA op:
    - x, x_res: [..., D], bfloat16, CUDA
    - gate: broadcastable to x.shape, bfloat16, CUDA
    Returns: [..., D], bfloat16
    """
    if (not x.is_cuda) or x.dtype != torch.bfloat16:
        # Eager fallback (fast and graph-friendly)
        gate_b = torch.broadcast_to(gate, x.shape)
        x_res_f = x_res.float()
        scale = torch.rsqrt((x_res_f * x_res_f).mean(-1, keepdim=True) + eps)
        x_normed = x_res_f * scale * torch.tanh(gate_b)
        return x + x_normed.to(dtype=x.dtype)

    # No branching: assume dtype and broadcastability already correct
    D = x.size(-1)
    gate_b = torch.broadcast_to(gate, x.shape)

    x2   = x.reshape(-1, D).contiguous()
    xr2  = x_res.reshape(-1, D).contiguous()
    g2   = gate_b.reshape(-1, D).contiguous()

    out2 = torch.ops.mochi.fused_residual_tanh_gated_rmsnorm(
        x2, xr2, g2, float(eps), bool(exact_mode)
    )
    return out2.view_as(x)
