# Mochi CUDA Kernels

High-performance CUDA implementations of frequently-used operations in the Mochi text-to-video model.

## Available Kernels

### Fused Residual Tanh-Gated RMSNorm
- **Operation**: Fuses RMSNorm, tanh activation, gating, and residual connection
- **Speedup**: 5-10x over PyTorch on H100
- **Usage**: Automatically used in `residual_tanh_gated_rmsnorm()`

## Installation

Build the optimized kernels:

```bash
# From the project root
pip install -e .
```

This will automatically detect CUDA and compile the kernels if available.

## Requirements

- **CUDA**: 12.1+ (compatible with 12.6+)
- **GPU**: H100 recommended (sm_90 architecture)  
- **PyTorch**: 2.0+ with CUDA support
- **Python**: 3.8+

## Usage

The kernels are automatically integrated into Mochi operations:

```python
from mochi.dit.residual_tanh_gated_rmsnorm import residual_tanh_gated_rmsnorm

# This will automatically use CUDA kernel if available
result = residual_tanh_gated_rmsnorm(x, x_res, gate)
```

### Manual Kernel Access

```python
from mochi import (
    residual_tanh_gated_rmsnorm,
    kernel_info
)

# Check kernel availability
kernel_info()

# Use kernels directly
result = residual_tanh_gated_rmsnorm(x, x_res, gate, eps=1e-6)
```

## Testing

Run the test suite:

```bash
# Basic functionality test
python -m pytest src/genmo/mochi/kernels/tests/test_fused_rmsnorm.py

# Include performance benchmarks
python -m pytest src/genmo/mochi/kernels/tests/test_fused_rmsnorm.py -m benchmark

# Manual test (no pytest required)
cd src/genmo/mochi/kernels/tests/
python test_fused_rmsnorm.py
```

## Development

### Adding New Kernels

1. Add CUDA implementation in `src/genmo/mochi/kernels/cuda/`
2. Add Python wrapper in `src/genmo/mochi/kernels/ops.py`
3. Register in `setup.py`
4. Add tests in `src/genmo/mochi/kernels/tests/`

### Build Configuration

Edit `setup.py` to adjust compilation flags:

```python
extra_compile_args={
    'nvcc': [
        '-arch=sm_90',      # H100 architecture
        '--use_fast_math',  # Fast math optimizations
        '-O3',              # Optimization level
    ]
}
```

## Performance

Expected performance improvements on H100:

| Operation | Tensor Size | Speedup |
|-----------|-------------|---------|
| Fused RMSNorm | 512×3072 | 5.6x |
| Fused RMSNorm | 1024×3072 | 6.3x |
| Fused RMSNorm | 2048×3072 | 9.6x |

## Troubleshooting

### CUDA Kernel Not Loading

```bash
# Check CUDA version compatibility
python -c "import torch; print(f'PyTorch CUDA: {torch.version.cuda}')"
nvcc --version

# Rebuild with verbose output
pip install -e . --verbose

# Check library paths
export LD_LIBRARY_PATH="$(python -c 'import torch; print(torch.__path__[0])')/lib:$LD_LIBRARY_PATH"
```

### Performance Issues

- Ensure you're using bfloat16 tensors
- Verify tensors are on CUDA device
- Check that tensor dimensions are optimized sizes (multiples of 32)
- Use `kernel_info()` to verify kernel availability

## Architecture Notes

### Memory Layout
- Optimized for coalesced memory access patterns
- Shared memory usage minimized for better occupancy
- Vectorized loads where possible

### Precision
- `exact_mode=False`: Fast computation with minor precision trade-offs
- `exact_mode=True`: Bit-exact matching with PyTorch reference

### Thread Configuration
- General path: Adaptive block sizes (32-512 threads)  
- D=3072 path: Fixed 512 threads, 6 elements per thread
- Optimized for H100 architecture (sm_90)