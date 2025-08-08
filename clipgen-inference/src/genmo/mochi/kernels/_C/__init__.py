"""
Compiled CUDA extensions.
This module is automatically populated when extensions are built.
"""
try:
    from . import fused_rmsnorm as _fused_rmsnorm  # noqa: F401
    # from . import fused_conditioning as _fused_conditioning
except Exception as e:
    # Safe to ignore on CPU-only envs; Python wrapper will fall back.
    print("Failed to load kernel", e)
