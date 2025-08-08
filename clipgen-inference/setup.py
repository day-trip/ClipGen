from setuptools import setup, find_packages
from torch.utils import cpp_extension
import torch
import os

# Set CUDA_HOME explicitly in setup.py
os.environ['CUDA_HOME'] = '/usr/local/cuda'
os.environ['TORCH_CUDA_ARCH_LIST'] = '9.0'


def create_cuda_extension(name: str, path: str):
    return cpp_extension.CUDAExtension(
        name=name,
        sources=[path],
        extra_compile_args={
            'cxx': ['-O3'],
            'nvcc': [
                '-O3',
                '--use_fast_math',
                '-arch=sm_90',      # H100 architecture
                '--ptxas-options=-v',
                '-lineinfo',
                '--extended-lambda',
                '--expt-relaxed-constexpr'
            ]
        },
        include_dirs=cpp_extension.include_paths(),
    )

# Only build CUDA extensions if CUDA is available OR if forced
ext_modules = []
if torch.cuda.is_available() or os.environ.get('FORCE_CUDA', '').lower() in ('1', 'true'):
    # Fused RMSNorm kernel
    ext_modules.append(create_cuda_extension('genmo.mochi.kernels._C.fused_rmsnorm', os.path.join('src', 'genmo', 'mochi', 'kernels', 'cuda', 'fused_rmsnorm.cu')))
    # Fused conditioning
    # ext_modules.append(create_cuda_extension('genmo.mochi.kernels._C.fused_conditioning', os.path.join('src', 'genmo', 'mochi', 'kernels', 'cuda', 'fused_conditioning.cu')))

setup(
    name='clipgen-inference',
    version='0.1.0',
    description='Mochi text-to-video inference with optimized CUDA kernels',
    packages=find_packages('src'),
    package_dir={'': 'src'},
    ext_modules=ext_modules,
    cmdclass={'build_ext': cpp_extension.BuildExtension} if ext_modules else {},
    python_requires='>=3.8',
    install_requires=[
        'torch>=2.0.0',
        'einops',
        'transformers',
        'safetensors',
        'accelerate',
    ],
    extras_require={
        'dev': [
            'pytest',
            'pybind11',
            'ninja',
        ]
    },
    zip_safe=False,
)