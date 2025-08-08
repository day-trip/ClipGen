import torch

# Try to import optimized CUDA kernel
try:
    from ..kernels import fused_residual_tanh_gated_rmsnorm as _optimized_rmsnorm
    _USE_CUDA_KERNEL = True
    print("🚀 Using optimized CUDA kernel for residual_tanh_gated_rmsnorm")
except ImportError:
    _USE_CUDA_KERNEL = False
    print("⚠️  CUDA kernel not available, using PyTorch fallback")

def residual_tanh_gated_rmsnorm_pytorch_fallback(x, x_res, gate, eps=1e-6):
    """PyTorch fallback implementation."""
    # Convert to fp32 for precision
    x_res = x_res.float()

    # Compute RMS
    mean_square = x_res.pow(2).mean(-1, keepdim=True)
    scale = torch.rsqrt(mean_square + eps)

    # Apply tanh to gate
    tanh_gate = torch.tanh(gate).unsqueeze(1)

    # Normalize and apply gated scaling
    x_normed = x_res * scale * tanh_gate

    # Apply residual connection
    output = x + x_normed.type_as(x)
    return output

def residual_tanh_gated_rmsnorm(x, x_res, gate, eps=1e-6):
    """
    Residual tanh-gated RMSNorm operation.
    
    Uses optimized CUDA kernel when available, otherwise falls back to PyTorch.
    
    Args:
        x: [N, D] residual input tensor
        x_res: [N, D] tensor to normalize
        gate: [N] gate values  
        eps: epsilon for numerical stability
        
    Returns:
        [N, D] output tensor
    """
    if _USE_CUDA_KERNEL:
        return _optimized_rmsnorm(x, x_res, gate, eps)
    else:
        return residual_tanh_gated_rmsnorm_pytorch_fallback(x, x_res, gate, eps)
