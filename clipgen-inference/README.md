# Inference

## Optimization Ideas
### Load time
- Shard the DiT via FSDP ahead of time?
- Load directly to the GPU
- Quantization

### Inference time
- Investigate Ray overhead (maybe specialize for 2 GPUs?)
- Reduce communication overhead (difficult; the flow is serial)
- Ensure PyTorch optimizations are being used correctly
- 