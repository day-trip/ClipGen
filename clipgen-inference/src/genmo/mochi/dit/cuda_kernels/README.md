# Mochi CUDA Kernels

Custom CUDA kernels for optimizing Mochi inference.

## Kernels

- **fused_rmsnorm**: Fused Residual Tanh-Gated RMSNorm operation

## Building

```bash
cd fused_rmsnorm/
python setup.py build_ext --inplace
```

## Testing

```bash
cd fused_rmsnorm/
python test_kernel.py
```

## Requirements

- CUDA 12.1+
- PyTorch with CUDA support  
- H100 GPU (sm_90 architecture)

## Performance

Expected speedup: 40-70% for the RMSNorm operation, 3-7% overall inference improvement.