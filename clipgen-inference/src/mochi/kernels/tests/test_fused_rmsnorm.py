#!/usr/bin/env python3
"""
Comprehensive tests for the fused residual tanh-gated RMSNorm kernel.
"""

import pytest
import torch
import time
import sys
import os

# Add parent directories to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mochi.kernels.ops import (
    residual_tanh_gated_rmsnorm,
    residual_tanh_gated_rmsnorm_pytorch,
    fused_residual_tanh_gated_rmsnorm
)

@pytest.fixture
def cuda_device():
    """Fixture to check CUDA availability."""
    if not torch.cuda.is_available():
        pytest.skip("CUDA not available")
    return torch.device('cuda')

class TestFusedRMSNorm:
    """Test suite for fused RMSNorm operations."""
    
    def test_correctness_small(self, cuda_device):
        """Test correctness with small tensors."""
        torch.manual_seed(42)
        N, D = 256, 1024
        
        x = torch.randn(N, D, dtype=torch.bfloat16, device=cuda_device)
        x_res = torch.randn(N, D, dtype=torch.bfloat16, device=cuda_device) 
        gate = torch.randn(N, dtype=torch.bfloat16, device=cuda_device)
        
        # Compare implementations
        pytorch_output = residual_tanh_gated_rmsnorm_pytorch(x, x_res, gate)
        try:
            cuda_output = fused_residual_tanh_gated_rmsnorm(x, x_res, gate)
            
            max_diff = torch.max(torch.abs(cuda_output - pytorch_output)).item()
            rel_diff = (max_diff / torch.max(torch.abs(pytorch_output)).item())
            
            assert rel_diff < 1e-2, f"Results differ too much: {rel_diff}"
        except RuntimeError as e:
            if "CUDA kernel not available" in str(e):
                pytest.skip("CUDA kernel not compiled")
            raise

    def test_correctness_mochi_size(self, cuda_device):
        """Test correctness with Mochi-typical tensor sizes."""
        torch.manual_seed(42)
        N, D = 1024, 3072  # Typical Mochi size
        
        x = torch.randn(N, D, dtype=torch.bfloat16, device=cuda_device)
        x_res = torch.randn(N, D, dtype=torch.bfloat16, device=cuda_device) 
        gate = torch.randn(N, dtype=torch.bfloat16, device=cuda_device)
        
        pytorch_output = residual_tanh_gated_rmsnorm_pytorch(x, x_res, gate)
        try:
            cuda_output = fused_residual_tanh_gated_rmsnorm(x, x_res, gate)
            
            max_diff = torch.max(torch.abs(cuda_output - pytorch_output)).item()
            rel_diff = (max_diff / torch.max(torch.abs(pytorch_output)).item())
            
            assert rel_diff < 1e-2, f"Results differ too much: {rel_diff}"
            assert cuda_output.shape == pytorch_output.shape
            assert cuda_output.dtype == x.dtype
        except RuntimeError as e:
            if "CUDA kernel not available" in str(e):
                pytest.skip("CUDA kernel not compiled")
            raise

    @pytest.mark.parametrize("N,D", [
        (1, 3072),      # Single sequence
        (512, 1024),    # Small
        (1024, 3072),   # Medium  
        (2048, 3072),   # Large
        (512, 4096),    # Different dimension
    ])
    def test_correctness_various_sizes(self, cuda_device, N, D):
        """Test correctness across various tensor sizes."""
        torch.manual_seed(42)
        
        x = torch.randn(N, D, dtype=torch.bfloat16, device=cuda_device)
        x_res = torch.randn(N, D, dtype=torch.bfloat16, device=cuda_device) 
        gate = torch.randn(N, dtype=torch.bfloat16, device=cuda_device)
        
        pytorch_output = residual_tanh_gated_rmsnorm_pytorch(x, x_res, gate)
        
        try:
            cuda_output = fused_residual_tanh_gated_rmsnorm(x, x_res, gate)
            
            max_diff = torch.max(torch.abs(cuda_output - pytorch_output)).item()
            rel_diff = (max_diff / torch.max(torch.abs(pytorch_output)).item())
            
            assert rel_diff < 1e-2, f"Results differ too much for size [{N}, {D}]: {rel_diff}"
        except RuntimeError as e:
            if "CUDA kernel not available" in str(e):
                pytest.skip("CUDA kernel not compiled")
            raise

    def test_exact_mode(self, cuda_device):
        """Test exact mode precision matching."""
        torch.manual_seed(42)
        N, D = 1024, 3072
        
        x = torch.randn(N, D, dtype=torch.bfloat16, device=cuda_device)
        x_res = torch.randn(N, D, dtype=torch.bfloat16, device=cuda_device) 
        gate = torch.randn(N, dtype=torch.bfloat16, device=cuda_device)
        
        try:
            exact_output = fused_residual_tanh_gated_rmsnorm(x, x_res, gate, exact_mode=True)
            fast_output = fused_residual_tanh_gated_rmsnorm(x, x_res, gate, exact_mode=False)
            
            # Exact mode should be very close to PyTorch
            pytorch_output = residual_tanh_gated_rmsnorm_pytorch(x, x_res, gate)
            
            exact_diff = torch.max(torch.abs(exact_output - pytorch_output)).item()
            fast_diff = torch.max(torch.abs(fast_output - pytorch_output)).item()
            
            # Exact mode should be closer to PyTorch reference
            assert exact_diff <= fast_diff or exact_diff < 1e-3
        except RuntimeError as e:
            if "CUDA kernel not available" in str(e):
                pytest.skip("CUDA kernel not compiled")
            raise

    def test_auto_selection(self, cuda_device):
        """Test automatic kernel selection."""
        torch.manual_seed(42)
        N, D = 1024, 3072
        
        x = torch.randn(N, D, dtype=torch.bfloat16, device=cuda_device)
        x_res = torch.randn(N, D, dtype=torch.bfloat16, device=cuda_device) 
        gate = torch.randn(N, dtype=torch.bfloat16, device=cuda_device)
        
        # This should automatically select the best implementation
        output = residual_tanh_gated_rmsnorm(x, x_res, gate)
        
        assert output.shape == (N, D)
        assert output.dtype == torch.bfloat16
        assert output.device.type == cuda_device.type

    def test_cpu_fallback(self):
        """Test CPU fallback behavior."""
        torch.manual_seed(42)
        N, D = 64, 256
        
        x = torch.randn(N, D, dtype=torch.float32)
        x_res = torch.randn(N, D, dtype=torch.float32) 
        gate = torch.randn(N, dtype=torch.float32)
        
        # Should automatically use PyTorch implementation
        output = residual_tanh_gated_rmsnorm(x, x_res, gate)
        
        assert output.shape == (N, D)
        assert output.device.type == 'cpu'

    def test_dtype_handling(self, cuda_device):
        """Test different dtype handling."""
        torch.manual_seed(42)
        N, D = 256, 1024
        
        # Test with float32 - should fall back to PyTorch
        x_f32 = torch.randn(N, D, dtype=torch.float32, device=cuda_device)
        x_res_f32 = torch.randn(N, D, dtype=torch.float32, device=cuda_device) 
        gate_f32 = torch.randn(N, dtype=torch.float32, device=cuda_device)
        
        output_f32 = residual_tanh_gated_rmsnorm(x_f32, x_res_f32, gate_f32)
        assert output_f32.dtype == torch.float32
        
        # Test with bfloat16 - should try CUDA kernel
        x_bf16 = x_f32.to(torch.bfloat16)
        x_res_bf16 = x_res_f32.to(torch.bfloat16)
        gate_bf16 = gate_f32.to(torch.bfloat16)
        
        output_bf16 = residual_tanh_gated_rmsnorm(x_bf16, x_res_bf16, gate_bf16)
        assert output_bf16.dtype == torch.bfloat16

@pytest.mark.benchmark
class TestPerformance:
    """Performance benchmarks."""
    
    @pytest.mark.parametrize("N,D", [
        (512, 3072),
        (1024, 3072), 
        (2048, 3072),
    ])
    def test_performance_benchmark(self, cuda_device, N, D):
        """Benchmark performance against PyTorch."""
        torch.manual_seed(42)
        
        x = torch.randn(N, D, dtype=torch.bfloat16, device=cuda_device)
        x_res = torch.randn(N, D, dtype=torch.bfloat16, device=cuda_device)
        gate = torch.randn(N, dtype=torch.bfloat16, device=cuda_device)
        
        # Warmup
        for _ in range(10):
            _ = residual_tanh_gated_rmsnorm_pytorch(x, x_res, gate)
            try:
                _ = fused_residual_tanh_gated_rmsnorm(x, x_res, gate)
            except RuntimeError:
                pytest.skip("CUDA kernel not available")
        
        torch.cuda.synchronize()
        
        # Benchmark PyTorch
        num_runs = 100
        torch.cuda.synchronize()
        start = time.perf_counter()
        for _ in range(num_runs):
            _ = residual_tanh_gated_rmsnorm_pytorch(x, x_res, gate)
        torch.cuda.synchronize()
        pytorch_time = time.perf_counter() - start
        
        # Benchmark CUDA
        torch.cuda.synchronize()
        start = time.perf_counter()
        for _ in range(num_runs):
            _ = fused_residual_tanh_gated_rmsnorm(x, x_res, gate)
        torch.cuda.synchronize()
        cuda_time = time.perf_counter() - start
        
        speedup = pytorch_time / cuda_time
        print(f"\nSize [{N}, {D}]: {speedup:.2f}x speedup")
        print(f"  PyTorch: {pytorch_time/num_runs*1000:.3f} ms")
        print(f"  CUDA:    {cuda_time/num_runs*1000:.3f} ms")
        
        # Should be faster (allow for some measurement variance)
        assert speedup > 1.5, f"Expected speedup > 1.5x, got {speedup:.2f}x"

if __name__ == "__main__":
    # Run tests manually if not using pytest
    if torch.cuda.is_available():
        device = torch.device('cuda')
        test_class = TestFusedRMSNorm()
        
        print("🚀 Running manual tests...")
        
        test_class.test_correctness_small(device)
        print("✅ Small tensor test passed")
        
        test_class.test_correctness_mochi_size(device)
        print("✅ Mochi size test passed")
        
        test_class.test_auto_selection(device)
        print("✅ Auto-selection test passed")
        
        print("🎉 All manual tests passed!")
    else:
        print("❌ CUDA not available, skipping tests")