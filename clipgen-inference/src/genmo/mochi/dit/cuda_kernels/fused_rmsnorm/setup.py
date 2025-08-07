from setuptools import setup, Extension
from pybind11.setup_helpers import Pybind11Extension, build_ext
from torch.utils import cpp_extension
import torch

ext_modules = [
    cpp_extension.CUDAExtension(
        name='fused_rmsnorm_cuda',
        sources=[
            'fused_rmsnorm.cu',
        ],
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
]

setup(
    name='fused_rmsnorm_cuda',
    ext_modules=ext_modules,
    cmdclass={'build_ext': cpp_extension.BuildExtension},
    zip_safe=False,
)