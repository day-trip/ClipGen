"""
Fused Residual Tanh-Gated RMSNorm CUDA kernel
"""
from .fused_rmsnorm import residual_tanh_gated_rmsnorm

__all__ = ['residual_tanh_gated_rmsnorm']