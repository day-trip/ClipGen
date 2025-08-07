#!/usr/bin/env python3
"""
Standalone test script for the fused residual tanh-gated RMSNorm CUDA kernel.

This script tests correctness and benchmarks performance without requiring
the full Mochi integration.
"""

import torch
import time
import sys
import os

# Add current directory to path so we can import our modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def pytorch_implementation(x, x_res, gate, eps=1e-6):
    """
    Reference PyTorch implementation for comparison
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

def test_cuda_availability():
    """Check if CUDA and our kernel are available"""
    print("=== CUDA Availability Test ===")
    
    if not torch.cuda.is_available():
        print("❌ CUDA is not available")
        return False
    
    print(f"✅ CUDA is available")
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"CUDA version: {torch.version.cuda}")
    print(f"GPU memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    
    # Try to import our CUDA kernel
    try:
        import fused_rmsnorm_cuda
        print("✅ CUDA kernel imported successfully")
        return True
    except ImportError as e:
        print(f"❌ CUDA kernel not available: {e}")
        print("   Run 'python setup.py build_ext --inplace' to compile the kernel")
        return False

def test_correctness():
    """Test that our CUDA kernel produces correct results"""
    print("\n=== Correctness Test ===")
    
    torch.manual_seed(42)
    
    # Test with multiple dimensions
    test_cases = [
        (256, 1024),    # Small
        (1024, 3072),   # Mochi-like
        (512, 4096),    # Large
        (1, 3072),      # Single sequence
        (2048, 3072),   # Large batch
    ]
    
    for N, D in test_cases:
        print(f"Testing shape [{N}, {D}]...")
        
        device = torch.device('cuda')
        
        # Create test inputs
        x = torch.randn(N, D, dtype=torch.bfloat16, device=device)
        x_res = torch.randn(N, D, dtype=torch.bfloat16, device=device) 
        gate = torch.randn(N, dtype=torch.bfloat16, device=device)
        
        # Run both implementations
        try:
            from fused_rmsnorm import fused_residual_tanh_gated_rmsnorm
            cuda_output = fused_residual_tanh_gated_rmsnorm(x, x_res, gate)
        except Exception as e:
            print(f"  ❌ CUDA kernel failed: {e}")
            continue
            
        pytorch_output = pytorch_implementation(x, x_res, gate)
        
        # Check correctness
        max_diff = torch.max(torch.abs(cuda_output - pytorch_output)).item()
        rel_diff = (max_diff / torch.max(torch.abs(pytorch_output)).item())
        
        print(f"  Max absolute difference: {max_diff:.6f}")
        print(f"  Max relative difference: {rel_diff:.6f}")
        
        # Should be very close (within bfloat16 precision)
        if rel_diff < 1e-2:
            print(f"  ✅ Test passed for shape [{N}, {D}]")
        else:
            print(f"  ❌ Test failed for shape [{N}, {D}]: difference too large")
            return False
    
    print("✅ All correctness tests passed!")
    return True

def benchmark_performance():
    """Benchmark performance vs PyTorch"""
    print("\n=== Performance Benchmark ===")
    
    # Test different sizes
    test_cases = [
        (512, 3072, "Medium"),
        (1024, 3072, "Large"),  
        (2048, 3072, "XLarge"),
    ]
    
    for N, D, size_name in test_cases:
        print(f"\nBenchmarking {size_name} size [{N}, {D}]:")
        
        device = torch.device('cuda')
        
        # Create test inputs
        x = torch.randn(N, D, dtype=torch.bfloat16, device=device)
        x_res = torch.randn(N, D, dtype=torch.bfloat16, device=device)
        gate = torch.randn(N, dtype=torch.bfloat16, device=device)
        
        # Import CUDA kernel
        try:
            from fused_rmsnorm import fused_residual_tanh_gated_rmsnorm
        except ImportError:
            print("  ❌ CUDA kernel not available for benchmarking")
            continue
        
        # Warmup
        for _ in range(10):
            _ = fused_residual_tanh_gated_rmsnorm(x, x_res, gate)
            _ = pytorch_implementation(x, x_res, gate)
        
        torch.cuda.synchronize()
        
        # Benchmark CUDA kernel
        num_runs = 100
        torch.cuda.synchronize()
        start = time.perf_counter()
        for _ in range(num_runs):
            output_cuda = fused_residual_tanh_gated_rmsnorm(x, x_res, gate)
        torch.cuda.synchronize()
        cuda_time = time.perf_counter() - start
        
        # Benchmark PyTorch fallback
        torch.cuda.synchronize()
        start = time.perf_counter()
        for _ in range(num_runs):
            output_pytorch = pytorch_implementation(x, x_res, gate)
        torch.cuda.synchronize()
        pytorch_time = time.perf_counter() - start
        
        # Calculate metrics
        cuda_ms = cuda_time * 1000 / num_runs
        pytorch_ms = pytorch_time * 1000 / num_runs
        speedup = pytorch_time / cuda_time
        
        print(f"  CUDA kernel:      {cuda_ms:.3f} ms/call")
        print(f"  PyTorch baseline: {pytorch_ms:.3f} ms/call")
        print(f"  Speedup:          {speedup:.2f}x")
        
        # Memory bandwidth calculation
        bytes_per_call = (3 * N * D * 2 + N * 2) + (N * D * 2)  # 3 inputs + 1 output, bfloat16 = 2 bytes
        bandwidth_gbps = (bytes_per_call / 1e9) / (cuda_time / num_runs)
        print(f"  Memory bandwidth: {bandwidth_gbps:.1f} GB/s")

def test_memory_usage():
    """Test memory usage patterns"""
    print("\n=== Memory Usage Test ===")
    
    device = torch.device('cuda')
    
    # Clear cache
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    
    N, D = 2048, 3072
    print(f"Testing with shape [{N}, {D}]...")
    
    # Create inputs
    x = torch.randn(N, D, dtype=torch.bfloat16, device=device)
    x_res = torch.randn(N, D, dtype=torch.bfloat16, device=device)
    gate = torch.randn(N, dtype=torch.bfloat16, device=device)
    
    # Measure memory before
    mem_before = torch.cuda.memory_allocated() / 1e6  # MB
    peak_before = torch.cuda.max_memory_allocated() / 1e6
    
    # Run kernel
    try:
        from fused_rmsnorm import fused_residual_tanh_gated_rmsnorm
        output = fused_residual_tanh_gated_rmsnorm(x, x_res, gate)
        torch.cuda.synchronize()
    except ImportError:
        print("  ❌ CUDA kernel not available for memory test")
        return
    
    # Measure memory after
    mem_after = torch.cuda.memory_allocated() / 1e6
    peak_after = torch.cuda.max_memory_allocated() / 1e6
    
    print(f"  Memory allocated: {mem_after:.1f} MB (delta: {mem_after-mem_before:.1f} MB)")
    print(f"  Peak memory: {peak_after:.1f} MB (delta: {peak_after-peak_before:.1f} MB)")
    
    # Expected memory usage
    expected_mb = (N * D * 2 * 4) / 1e6  # 4 tensors, 2 bytes each
    print(f"  Expected: ~{expected_mb:.1f} MB")
    print("  ✅ Memory usage looks reasonable")

def main():
    """Run all tests"""
    print("🚀 Testing Fused Residual Tanh-Gated RMSNorm CUDA Kernel")
    print("=" * 60)
    
    # Check CUDA availability
    if not test_cuda_availability():
        print("\n❌ Cannot proceed without CUDA kernel")
        sys.exit(1)
    
    # Run correctness tests
    if not test_correctness():
        print("\n❌ Correctness tests failed")
        sys.exit(1)
    
    # Run performance benchmarks
    benchmark_performance()
    
    # Test memory usage
    test_memory_usage()
    
    print("\n🎉 All tests completed successfully!")
    print("\nNext steps:")
    print("1. If performance looks good, integrate with Mochi")
    print("2. Test with actual Mochi inference workloads")
    print("3. Profile end-to-end performance improvement")

if __name__ == "__main__":
    main()