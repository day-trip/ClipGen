import torch

# Try to import the compiled CUDA extension
try:
    import fused_rmsnorm_cuda
    _CUDA_AVAILABLE = True
except ImportError:
    _CUDA_AVAILABLE = False

class FusedResidualTanhGatedRMSNorm(torch.autograd.Function):
    @staticmethod
    def forward(ctx, x, x_res, gate, eps=1e-6):
        # Save for backward pass (if needed)
        ctx.save_for_backward(x, x_res, gate)
        ctx.eps = eps
        
        return fused_rmsnorm_cuda.fused_residual_tanh_gated_rmsnorm_cuda(
            x, x_res, gate, eps
        )
    
    @staticmethod  
    def backward(ctx, grad_output):
        # For inference, we don't need gradients
        # For training, you'd implement the backward pass here
        raise NotImplementedError("Backward pass not implemented for inference-only kernel")

def fused_residual_tanh_gated_rmsnorm(x, x_res, gate, eps=1e-6):
    """
    Fused implementation of residual_tanh_gated_rmsnorm
    
    Args:
        x: [N, D] residual input tensor (bfloat16)
        x_res: [N, D] tensor to normalize (bfloat16)  
        gate: [N] gate values (bfloat16)
        eps: epsilon for numerical stability
        
    Returns:
        [N, D] output tensor (bfloat16)
    """
    if not _CUDA_AVAILABLE:
        raise RuntimeError("CUDA kernel not available. Run 'python setup.py build_ext --inplace' first.")
    
    return FusedResidualTanhGatedRMSNorm.apply(x, x_res, gate, eps)

# Fallback to original implementation
def residual_tanh_gated_rmsnorm_pytorch(x, x_res, gate, eps=1e-6):
    """
    PyTorch fallback implementation
    """
    x_res = x_res.float()
    mean_square = x_res.pow(2).mean(-1, keepdim=True)
    scale = torch.rsqrt(mean_square + eps)
    tanh_gate = torch.tanh(gate).unsqueeze(1)
    x_normed = x_res * scale * tanh_gate
    output = x + x_normed.type_as(x)
    return output

# Auto-detect and use best implementation
def residual_tanh_gated_rmsnorm(x, x_res, gate, eps=1e-6):
    """
    Automatically use CUDA kernel if available, otherwise fallback to PyTorch
    """
    if _CUDA_AVAILABLE:
        return fused_residual_tanh_gated_rmsnorm(x, x_res, gate, eps)
    else:
        return residual_tanh_gated_rmsnorm_pytorch(x, x_res, gate, eps)