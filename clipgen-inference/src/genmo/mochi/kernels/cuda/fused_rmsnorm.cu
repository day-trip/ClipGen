#include <torch/extension.h>
#include <torch/library.h>
#include <ATen/cuda/CUDAContext.h>
#include <c10/cuda/CUDAStream.h>
#include <c10/cuda/CUDAException.h>
#include <ATen/ATen.h>
#include <ATen/core/Tensor.h>
#include <ATen/ops/empty_like.h>
#include <cuda_runtime.h>
#include <cuda_bf16.h>
#include <device_launch_parameters.h>
#include <cmath>

#define WARP_SIZE 32
#define FULL_MASK 0xffffffffu

// Warp reduce (sum)
__device__ __forceinline__ float warp_reduce_sum(float val) {
    #pragma unroll
    for (int offset = WARP_SIZE / 2; offset > 0; offset >>= 1) {
        val += __shfl_down_sync(FULL_MASK, val, offset);
    }
    return val;
}

// Block reduce with broadcast to all threads
__device__ __forceinline__ float block_reduce_sum_broadcast(float val, float* shared) {
    const int lane = threadIdx.x & (WARP_SIZE - 1);
    const int wid  = threadIdx.x >> 5; // warp id in block
    const int nwarps = (blockDim.x + WARP_SIZE - 1) / WARP_SIZE;

    // Reduce within warp
    val = warp_reduce_sum(val);

    // Write each warp's sum
    if (lane == 0) {
        shared[wid] = val;
    }
    __syncthreads();

    // Final reduction in warp 0
    float block_sum = 0.f;
    if (wid == 0) {
        float warp_val = (threadIdx.x < nwarps) ? shared[lane] : 0.f;
        block_sum = warp_reduce_sum(warp_val);
        if (lane == 0) shared[0] = block_sum; // broadcast
    }
    __syncthreads();
    return shared[0];
}

// General kernel: per-feature gating
template <bool ExactMode>
__global__ void fused_residual_tanh_gated_rmsnorm_kernel(
    const __nv_bfloat16* __restrict__ x,       // [N, D]
    const __nv_bfloat16* __restrict__ x_res,   // [N, D]
    const __nv_bfloat16* __restrict__ gate,    // [N, D]
    __nv_bfloat16* __restrict__ out,           // [N, D]
    const int N,
    const int D,
    const float eps
) {
    const int row = blockIdx.x;
    if (row >= N) return;

    // Shared memory for reduction only
    const int nwarps = (blockDim.x + WARP_SIZE - 1) / WARP_SIZE;
    extern __shared__ float s_reduce[]; // size = nwarps

    const int base = row * D;

    // Phase 1: sum of squares in FP32 (over x_res row)
    float thread_sum = 0.f;
    for (int idx = threadIdx.x; idx < D; idx += blockDim.x) {
        float v = __bfloat162float(x_res[base + idx]);
        thread_sum = fmaf(v, v, thread_sum);
    }
    const float total_sum = block_reduce_sum_broadcast(thread_sum, s_reduce);

    // Compute inv_rms once, broadcast via shared[0]
    if (threadIdx.x == 0) {
        const float mean_sq = total_sum / static_cast<float>(D);
        s_reduce[0] = rsqrtf(mean_sq + eps);
    }
    __syncthreads();
    const float inv_rms = s_reduce[0];

    // Phase 2: elementwise tanh(gate), scale and residual add
    if (ExactMode) {
        for (int idx = threadIdx.x; idx < D; idx += blockDim.x) {
            const int off = base + idx;

            // Load and quantize inputs as needed
            float xv  = __bfloat162float(x[off]);
            float xrv = __bfloat162float(x_res[off]);

            // Per-feature tanh gate (optionally quantize gate_tanh to bf16)
            float g = __bfloat162float(gate[off]);
            g = tanhf(g);
            g = __bfloat162float(__float2bfloat16(g)); // quantize tanh(gate) to bf16

            // Normalize x_res in fp32, then quantize to bf16 before the add
            float x_normed_f = xrv * (inv_rms * g);
            __nv_bfloat16 x_normed_b = __float2bfloat16(x_normed_f);

            // Simulate bf16 + bf16 add
            float sum_f = __bfloat162float(__float2bfloat16(xv)) + __bfloat162float(x_normed_b);
            out[off] = __float2bfloat16(sum_f);
        }
    } else {
        for (int idx = threadIdx.x; idx < D; idx += blockDim.x) {
            const int off = base + idx;

            float xv  = __bfloat162float(x[off]);
            float xrv = __bfloat162float(x_res[off]);

            float g = __bfloat162float(gate[off]);
            g = tanhf(g);

            float res = fmaf(xrv, inv_rms * g, xv);
            out[off] = __float2bfloat16(res);
        }
    }
}

// Specialized kernel for D = 3072 (6 elems per thread at 512 threads), per-feature gating
template <bool ExactMode>
__global__ void fused_residual_tanh_gated_rmsnorm_kernel_3072(
    const __nv_bfloat16* __restrict__ x,       // [N, 3072]
    const __nv_bfloat16* __restrict__ x_res,   // [N, 3072]
    const __nv_bfloat16* __restrict__ gate,    // [N, 3072]
    __nv_bfloat16* __restrict__ out,           // [N, 3072]
    const int N,
    const float eps
) {
    constexpr int D = 3072;
    constexpr int THREADS = 512;

    const int row = blockIdx.x;
    if (row >= N) return;

    __shared__ float s_reduce[THREADS / WARP_SIZE]; // 16 floats
    __shared__ float s_inv_rms;

    const int base = row * D;
    const int tid = threadIdx.x;

    // Each thread handles 6 elements
    float xv[6], xrv[6], gv[6];
    float thread_sum = 0.f;

    #pragma unroll
    for (int i = 0; i < 6; ++i) {
        const int idx = tid + i * THREADS;
        const int off = base + idx;
        xrv[i] = __bfloat162float(x_res[off]);
        xv[i]  = __bfloat162float(x[off]);

        float g = __bfloat162float(gate[off]);
        g = tanhf(g);
        if (ExactMode) {
            g = __bfloat162float(__float2bfloat16(g)); // quantize tanh(gate) to bf16
        }
        gv[i] = g;

        thread_sum = fmaf(xrv[i], xrv[i], thread_sum);
    }

    // Reduce sum to all threads
    float warp_sum = warp_reduce_sum(thread_sum);
    if ((tid & (WARP_SIZE - 1)) == 0) {
        s_reduce[tid / WARP_SIZE] = warp_sum;
    }
    __syncthreads();

    // Final reduction in warp 0 and broadcast inv_rms
    if ((tid / WARP_SIZE) == 0) {
        float block_sum = (tid < THREADS / WARP_SIZE) ? s_reduce[tid] : 0.f;
        block_sum = warp_reduce_sum(block_sum);
        if ((tid & (WARP_SIZE - 1)) == 0) s_inv_rms = rsqrtf(block_sum / float(D) + eps);
    }
    __syncthreads();

    const float inv_rms = s_inv_rms;

    if (ExactMode) {
        #pragma unroll
        for (int i = 0; i < 6; ++i) {
            float x_normed_f = xrv[i] * (inv_rms * gv[i]);
            __nv_bfloat16 x_normed_b = __float2bfloat16(x_normed_f);

            float sum_f = __bfloat162float(__float2bfloat16(xv[i])) + __bfloat162float(x_normed_b);
            out[base + (tid + i * THREADS)] = __float2bfloat16(sum_f);
        }
    } else {
        #pragma unroll
        for (int i = 0; i < 6; ++i) {
            float res = fmaf(xrv[i], inv_rms * gv[i], xv[i]);
            out[base + (tid + i * THREADS)] = __float2bfloat16(res);
        }
    }
}

// Utility: next power-of-two not exceeding limit and >= 32
static inline int pick_block_threads(int D) {
    int t = 32;
    while (t < D && t < 512) t <<= 1;
    if (t > 512) t = 512;
    return t;
}

template <bool ExactMode>
static void launch_kernel_dispatch(
    const __nv_bfloat16* x,
    const __nv_bfloat16* x_res,
    const __nv_bfloat16* gate,
    __nv_bfloat16* out,
    int N,
    int D,
    float eps,
    cudaStream_t stream
) {
    if (N == 0 || D == 0) return;

    // Specialized fast path for D=3072 with 512 threads
    if (D == 3072) {
        dim3 grid(N);
        dim3 block(512);
        fused_residual_tanh_gated_rmsnorm_kernel_3072<ExactMode>
            <<<grid, block, 0, stream>>>(x, x_res, gate, out, N, eps);
        C10_CUDA_KERNEL_LAUNCH_CHECK();
        return;
    }

    // General path
    const int threads = pick_block_threads(D);
    const int nwarps = (threads + WARP_SIZE - 1) / WARP_SIZE;
    // shared: nwarps floats for reduction
    size_t shmem = nwarps * sizeof(float);

    dim3 grid(N);
    dim3 block(threads);

    fused_residual_tanh_gated_rmsnorm_kernel<ExactMode>
        <<<grid, block, shmem, stream>>>(x, x_res, gate, out, N, D, eps);
    C10_CUDA_KERNEL_LAUNCH_CHECK();
}

// Host entry
torch::Tensor fused_residual_tanh_gated_rmsnorm_cuda(
    const torch::Tensor& x,       // [N, D], bf16
    const torch::Tensor& x_res,   // [N, D], bf16
    const torch::Tensor& gate,    // [N, D], bf16 (per-feature gate)
    double eps_d,
    bool exact_mode
) {
    TORCH_CHECK(x.device().is_cuda(), "x must be CUDA");
    TORCH_CHECK(x_res.device().is_cuda(), "x_res must be CUDA");
    TORCH_CHECK(gate.device().is_cuda(), "gate must be CUDA");

    TORCH_CHECK(x.scalar_type() == at::kBFloat16, "x must be bfloat16");
    TORCH_CHECK(x_res.scalar_type() == at::kBFloat16, "x_res must be bfloat16");
    TORCH_CHECK(gate.scalar_type() == at::kBFloat16, "gate must be bfloat16");

    TORCH_CHECK(x.is_contiguous(), "x must be contiguous");
    TORCH_CHECK(x_res.is_contiguous(), "x_res must be contiguous");
    TORCH_CHECK(gate.is_contiguous(), "gate must be contiguous");

    TORCH_CHECK(x.dim() == 2 && x_res.dim() == 2 && gate.dim() == 2, "x, x_res, gate must be 2D");
    TORCH_CHECK(x.sizes() == x_res.sizes(), "x and x_res must have the same shape");
    TORCH_CHECK(gate.sizes() == x.sizes(), "gate must have the same shape as x (per-feature)");

    const int64_t N64 = x.size(0);
    const int64_t D64 = x.size(1);
    TORCH_CHECK(N64 <= INT_MAX && D64 <= INT_MAX, "N or D too large");
    const int N = static_cast<int>(N64);
    const int D = static_cast<int>(D64);

    auto out = torch::empty_like(x);

    const __nv_bfloat16* x_ptr     = reinterpret_cast<const __nv_bfloat16*>(x.data_ptr<at::BFloat16>());
    const __nv_bfloat16* x_res_ptr = reinterpret_cast<const __nv_bfloat16*>(x_res.data_ptr<at::BFloat16>());
    const __nv_bfloat16* gate_ptr  = reinterpret_cast<const __nv_bfloat16*>(gate.data_ptr<at::BFloat16>());
    __nv_bfloat16* out_ptr         = reinterpret_cast<__nv_bfloat16*>(out.data_ptr<at::BFloat16>());

    auto stream = at::cuda::getCurrentCUDAStream();
    const float eps = static_cast<float>(eps_d);

    if (exact_mode) {
        launch_kernel_dispatch<true>(x_ptr, x_res_ptr, gate_ptr, out_ptr, N, D, eps, stream);
    } else {
        launch_kernel_dispatch<false>(x_ptr, x_res_ptr, gate_ptr, out_ptr, N, D, eps, stream);
    }

    return out;
}

// Meta kernel: validate shapes/dtypes and return a meta tensor
static at::Tensor fused_residual_tanh_gated_rmsnorm_meta(
const at::Tensor& x,
const at::Tensor& x_res,
const at::Tensor& gate,
double eps,
bool exact_mode) {

TORCH_CHECK(x.scalar_type() == at::kBFloat16, "x must be bfloat16");
TORCH_CHECK(x_res.scalar_type() == at::kBFloat16, "x_res must be bfloat16");
TORCH_CHECK(gate.scalar_type() == at::kBFloat16, "gate must be bfloat16");

TORCH_CHECK(x.dim() == 2 && x_res.dim() == 2 && gate.dim() == 2,
            "x, x_res, gate must be 2D [N, D] (per-feature gate)");
TORCH_CHECK(x.sizes() == x_res.sizes(), "x and x_res must have the same shape");
TORCH_CHECK(x.sizes() == gate.sizes(), "gate must have the same shape as x");

return at::empty_like(x, x.options().device(c10::Device(c10::kMeta)));
}

// Register op schema
TORCH_LIBRARY(mochi, m) {
m.def("fused_residual_tanh_gated_rmsnorm(Tensor x, Tensor x_res, Tensor gate, float eps=1e-6, bool exact_mode=False) -> Tensor");
}

// Register Meta and CUDA implementations
TORCH_LIBRARY_IMPL(mochi, Meta, m) {
m.impl("fused_residual_tanh_gated_rmsnorm", TORCH_FN(fused_residual_tanh_gated_rmsnorm_meta));
}

TORCH_LIBRARY_IMPL(mochi, CUDA, m) {
m.impl("fused_residual_tanh_gated_rmsnorm", TORCH_FN(fused_residual_tanh_gated_rmsnorm_cuda));
}

// Keep an empty pybind11 module so importing the extension loads this .so
PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {}