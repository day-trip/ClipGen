"""
Optimized CUDA kernels for Mochi inference.

This module provides high-performance CUDA implementations of frequently-used
operations in the Mochi text-to-video model.
"""

import torch
import warnings

# Initialize kernel availability flags
_KERNELS_AVAILABLE = {
    'fused_rmsnorm': False,
}

# Try to import compiled CUDA kernels
if torch.cuda.is_available():
    try:
        from .ops import fused_residual_tanh_gated_rmsnorm
        _KERNELS_AVAILABLE['fused_rmsnorm'] = True
        print("🚀 Mochi CUDA kernels loaded successfully")
    except ImportError as e:
        warnings.warn(
            f"CUDA kernels not available ({e}). "
            "Run 'pip install -e .' to build optimized kernels. "
            "Falling back to PyTorch implementations.",
            UserWarning
        )
        from .ops import fused_residual_tanh_gated_rmsnorm
else:
    warnings.warn("CUDA not available, using PyTorch fallback implementations", UserWarning)
    from .ops import fused_residual_tanh_gated_rmsnorm

# Public API
__all__ = [
    'fused_residual_tanh_gated_rmsnorm',
]

def kernel_info():
    """Print information about available kernels."""
    print("Mochi CUDA Kernels Status:")
    for kernel, available in _KERNELS_AVAILABLE.items():
        status = "✅ Available" if available else "❌ Fallback"
        print(f"  {kernel}: {status}")
    
    if torch.cuda.is_available():
        print(f"GPU: {torch.cuda.get_device_name()}")
        print(f"CUDA Version: {torch.version.cuda}")
    else:
        print("GPU: Not available")