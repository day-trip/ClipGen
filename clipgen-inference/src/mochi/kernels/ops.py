"""
High-level operations using optimized CUDA kernels.
"""

import torch
import warnings

def residual_tanh_gated_rmsnorm_pytorch(x, x_res, gate, eps=1e-6):
    """
    PyTorch fallback implementation for residual tanh-gated RMSNorm.
    
    Args:
        x: [N, D] residual input tensor
        x_res: [N, D] tensor to normalize  
        gate: [N] gate values
        eps: epsilon for numerical stability
        
    Returns:
        [N, D] output tensor
    """
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

# Try to import CUDA implementation
_cuda_fused_rmsnorm = None
try:
    from ..kernels._C.fused_rmsnorm import fused_residual_tanh_gated_rmsnorm_cuda
    _cuda_fused_rmsnorm = fused_residual_tanh_gated_rmsnorm_cuda
except ImportError:
    pass

class FusedResidualTanhGatedRMSNorm(torch.autograd.Function):
    @staticmethod
    def forward(ctx, x, x_res, gate, eps=1e-6, exact_mode=False):
        if _cuda_fused_rmsnorm is None:
            raise RuntimeError("CUDA kernel not available")
        return _cuda_fused_rmsnorm(x, x_res, gate, eps, exact_mode)
    
    @staticmethod  
    def backward(ctx, grad_output):
        # For inference-only kernel
        raise NotImplementedError("Backward pass not implemented for inference-only kernel")

def fused_residual_tanh_gated_rmsnorm(x, x_res, gate, eps=1e-6, exact_mode=False):
    """
    Fused CUDA implementation of residual tanh-gated RMSNorm.
    
    Args:
        x: [N, D] residual input tensor (bfloat16)
        x_res: [N, D] tensor to normalize (bfloat16)  
        gate: [N] gate values (bfloat16)
        eps: epsilon for numerical stability
        exact_mode: if True, match PyTorch precision exactly
        
    Returns:
        [N, D] output tensor (bfloat16)
    """
    if not torch.cuda.is_available() or not x.is_cuda:
        return residual_tanh_gated_rmsnorm_pytorch(x, x_res, gate, eps)
    
    if _cuda_fused_rmsnorm is None:
        warnings.warn(
            "CUDA kernel not available, falling back to PyTorch. "
            "Run 'pip install -e .' to build optimized kernels.",
            UserWarning,
            stacklevel=2
        )
        return residual_tanh_gated_rmsnorm_pytorch(x, x_res, gate, eps)
    
    return FusedResidualTanhGatedRMSNorm.apply(x, x_res, gate, eps, exact_mode)

# Public API - auto-select best implementation
def residual_tanh_gated_rmsnorm(x, x_res, gate, eps=1e-6):
    """
    Residual tanh-gated RMSNorm operation.
    
    Automatically uses optimized CUDA kernel when available,
    otherwise falls back to PyTorch implementation.
    
    Args:
        x: [N, D] residual input tensor
        x_res: [N, D] tensor to normalize
        gate: [N] gate values  
        eps: epsilon for numerical stability
        
    Returns:
        [N, D] output tensor
    """
    # Use CUDA kernel if available and appropriate
    if (torch.cuda.is_available() and 
        x.is_cuda and 
        x.dtype == torch.bfloat16 and
        _cuda_fused_rmsnorm is not None):
        try:
            return fused_residual_tanh_gated_rmsnorm(x, x_res, gate, eps, exact_mode=False)
        except Exception as e:
            warnings.warn(
                f"CUDA kernel failed ({e}), falling back to PyTorch",
                UserWarning,
                stacklevel=2
            )
    
    # Fallback to PyTorch
    return residual_tanh_gated_rmsnorm_pytorch(x, x_res, gate, eps)