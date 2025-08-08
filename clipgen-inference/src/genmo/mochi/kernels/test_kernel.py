#!/usr/bin/env python3
"""
Quick numerical test for CUDA kernel correctness.
Run with: python -m pytest test_kernel.py -v
"""
import torch
import pytest
from .ops import fused_residual_tanh_gated_rmsnorm, _residual_tanh_gated_rmsnorm_pytorch


@pytest.mark.skipif(not torch.cuda.is_available(), reason="CUDA not available")
def test_kernel_correctness():
    """Test CUDA kernel matches PyTorch implementation."""
    torch.manual_seed(42)
    
    # Test dimensions from actual Mochi usage
    test_cases = [
        (2, 3072),    # Typical Mochi batch
        (1, 3072),    # Single sample
        (4, 1536),    # Different dimension
    ]
    
    for B, D in test_cases:
        print(f"Testing shape [{B}, {D}]")
        
        # Create test tensors
        x = torch.randn(B, D, dtype=torch.bfloat16, device='cuda')
        x_res = torch.randn(B, D, dtype=torch.bfloat16, device='cuda') 
        gate = torch.randn(B, D, dtype=torch.bfloat16, device='cuda')
        
        # PyTorch reference
        ref_out = _residual_tanh_gated_rmsnorm_pytorch(
            x.float(), x_res.float(), gate.float()
        ).to(torch.bfloat16)
        
        # CUDA kernel
        cuda_out = fused_residual_tanh_gated_rmsnorm(x, x_res, gate)
        
        # Compare outputs
        diff = (ref_out - cuda_out).abs().max().item()
        rel_diff = (diff / ref_out.abs().max().item()) * 100
        
        print(f"  Max diff: {diff:.2e}, Rel diff: {rel_diff:.3f}%")
        assert diff < 1e-2, f"CUDA kernel differs too much from reference: {diff}"
        assert rel_diff < 5.0, f"Relative error too high: {rel_diff}%"

@pytest.mark.skipif(not torch.cuda.is_available(), reason="CUDA not available")  
def test_kernel_performance():
    """Quick performance check."""
    torch.manual_seed(42)
    B, D = 8, 3072  # Realistic batch
    
    x = torch.randn(B, D, dtype=torch.bfloat16, device='cuda')
    x_res = torch.randn(B, D, dtype=torch.bfloat16, device='cuda')
    gate = torch.randn(B, D, dtype=torch.bfloat16, device='cuda')
    
    # Warmup
    for _ in range(10):
        _ = fused_residual_tanh_gated_rmsnorm(x, x_res, gate)
    torch.cuda.synchronize()
    
    # Time CUDA kernel
    start = torch.cuda.Event(enable_timing=True)
    end = torch.cuda.Event(enable_timing=True) 
    
    start.record()
    for _ in range(100):
        cuda_out = fused_residual_tanh_gated_rmsnorm(x, x_res, gate)
    end.record()
    torch.cuda.synchronize()
    
    cuda_time = start.elapsed_time(end) / 100  # Average per call
    print(f"CUDA kernel: {cuda_time:.3f} ms/call")
    
    # Sanity check - should be much faster than naive implementation
    assert cuda_time < 1.0, f"Kernel seems slow: {cuda_time} ms"


if __name__ == "__main__":
    test_kernel_correctness()
    test_kernel_performance()
    print("✅ All tests passed!")
