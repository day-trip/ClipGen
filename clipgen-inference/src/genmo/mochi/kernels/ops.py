import torch

try:
    from . import _C  # noqa: F401
except Exception as e:
    print("Failed to load CUDA kernels, falling back to pure Python", e)

def _residual_tanh_gated_rmsnorm(x, x_res, gate, eps=1e-6):
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


def fused_conditioning_block(c, mod_x_weight, mod_x_bias, mod_y_weight, mod_y_bias, update_y):
    """
    Fused conditioning block:
    - c: [B, D], bfloat16, CUDA
    - mod_x_weight: [4*D, D], bfloat16, CUDA
    - mod_x_bias: [4*D], bfloat16, CUDA
    - mod_y_weight: [4*D, D] or [D, D], bfloat16, CUDA
    - mod_y_bias: [4*D] or [D], bfloat16, CUDA
    - update_y: bool

    Returns: (scale_msa_x, gate_msa_x, scale_mlp_x, gate_mlp_x,
              scale_msa_y, gate_msa_y, scale_mlp_y, gate_mlp_y)
    All outputs: [B, D], bfloat16 (last 3 are empty tensors if update_y=False)
    """
    if (not c.is_cuda) or c.dtype != torch.bfloat16:
        # Eager fallback
        import torch.nn.functional as F
        c_silu = F.silu(c)

        # mod_x linear
        mod_x_out = F.linear(c_silu, mod_x_weight, mod_x_bias)  # [B, 4*D]
        scale_msa_x, gate_msa_x, scale_mlp_x, gate_mlp_x = mod_x_out.chunk(4, dim=1)

        # mod_y linear
        mod_y_out = F.linear(c_silu, mod_y_weight, mod_y_bias)
        if update_y:
            scale_msa_y, gate_msa_y, scale_mlp_y, gate_mlp_y = mod_y_out.chunk(4, dim=1)
        else:
            scale_msa_y = mod_y_out
            gate_msa_y = torch.empty(0, dtype=c.dtype, device=c.device)
            scale_mlp_y = torch.empty(0, dtype=c.dtype, device=c.device)
            gate_mlp_y = torch.empty(0, dtype=c.dtype, device=c.device)

        return (scale_msa_x, gate_msa_x, scale_mlp_x, gate_mlp_x,
                scale_msa_y, gate_msa_y, scale_mlp_y, gate_mlp_y)

    # CUDA path
    return torch.ops.mochi.fused_conditioning_block(
        c.contiguous(),
        mod_x_weight.contiguous(),
        mod_x_bias.contiguous(),
        mod_y_weight.contiguous(),
        mod_y_bias.contiguous(),
        bool(update_y)
    )
