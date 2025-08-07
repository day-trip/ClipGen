#!/bin/bash
"""
Complete build and test script for the CUDA kernel
Run this on your H100 VM after transferring the files
"""

set -e  # Exit on any error

echo "🚀 Building and Testing Fused RMSNorm CUDA Kernel"
echo "=================================================="

# Check prerequisites
echo "Checking prerequisites..."

# Check CUDA
if ! command -v nvcc &> /dev/null; then
    echo "❌ NVCC not found. Please install CUDA toolkit."
    exit 1
fi

echo "✅ CUDA toolkit found: $(nvcc --version | grep 'release')"

# Check PyTorch
python3 -c "import torch; print(f'✅ PyTorch {torch.__version__} with CUDA {torch.version.cuda}')" || {
    echo "❌ PyTorch with CUDA not found"
    exit 1
}

# Check GPU
python3 -c "
import torch
if not torch.cuda.is_available():
    print('❌ CUDA not available')
    exit(1)
print(f'✅ GPU: {torch.cuda.get_device_name(0)}')
"

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf build/
rm -f *.so
rm -f fused_rmsnorm_cuda*.so

# Build the extension
echo "Building CUDA extension..."
python3 setup.py build_ext --inplace

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
else
    echo "❌ Build failed!"
    exit 1
fi

# Check if the compiled module can be imported
echo "Testing module import..."
python3 -c "import fused_rmsnorm_cuda; print('✅ CUDA module imports successfully')" || {
    echo "❌ Failed to import CUDA module"
    exit 1
}

# Run the comprehensive test suite
echo "Running test suite..."
python3 test_kernel.py

echo "🎉 Build and test completed!"
echo ""
echo "If all tests passed, the kernel is ready for integration with Mochi."