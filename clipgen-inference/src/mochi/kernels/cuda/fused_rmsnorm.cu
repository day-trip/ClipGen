#include <torch/extension.h>
#include <ATen/cuda/CUDAContext.h>
#include <c10/cuda/CUDAStream.h>
#include <c10/cuda/CUDAException.h>
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

// General kernel, handles any D
template <bool ExactMode>
__global__ void fused_residual_tanh_gated_rmsnorm_kernel(
    const __nv_bfloat16* __restrict__ x,       // [N, D]
    const __nv_bfloat16* __restrict__ x_res,   // [N, D]
    const __nv_bfloat16* __restrict__ gate,    // [N]
    __nv_bfloat16* __restrict__ out,           // [N, D]
    const int N,
    const int D,
    const float eps
) {
    const int row = blockIdx.x;
    if (row >= N) return;

    // shared layout: [nwarps floats for reduction] + [2 scalars: gate, inv_rms]
    const int nwarps = (blockDim.x + WARP_SIZE - 1) / WARP_SIZE;
    extern __shared__ float smem[];
    float* s_reduce = smem;
    float* s_scalars = smem + nwarps; // s_scalars[0] = gate_tanh, s_scalars[1] = inv_rms

    // Thread 0 computes tanh(gate) once
    if (threadIdx.x == 0) {
        float g = __bfloat162float(gate[row]);
        g = tanhf(g);
        if (ExactMode) {
            g = __bfloat162float(__float2bfloat16(g));
        }
        s_scalars[0] = g;
    }
    __syncthreads();

    const int base = row * D;

    // Phase 1: sum of squares in FP32
    float thread_sum = 0.f;
    for (int idx = threadIdx.x; idx < D; idx += blockDim.x) {
        float v = __bfloat162float(x_res[base + idx]);
        thread_sum = fmaf(v, v, thread_sum);
    }

    const float total_sum = block_reduce_sum_broadcast(thread_sum, s_reduce);

    // Thread 0 computes inv_rms once
    if (threadIdx.x == 0) {
        const float mean_sq = total_sum / static_cast<float>(D);
        s_scalars[1] = rsqrtf(mean_sq + eps);
    }
    __syncthreads();

    const float gate_tanh = s_scalars[0];
    const float inv_rms   = s_scalars[1];
    const float scale     = inv_rms * gate_tanh;

    // Phase 2: normalize, gate, add residual (with optional exact-mode rounding)
    if (ExactMode) {
        for (int idx = threadIdx.x; idx < D; idx += blockDim.x) {
            float xv  = __bfloat162float(x[base + idx]);
            float xrv = __bfloat162float(x_res[base + idx]);
            float x_normed_f = xrv * scale;
            __nv_bfloat16 x_normed_b = __float2bfloat16(x_normed_f);
            // Simulate bf16+bf16 add then round to bf16
            float sum_f = __bfloat162float(__float2bfloat16(xv)) + __bfloat162float(x_normed_b);
            out[base + idx] = __float2bfloat16(sum_f);
        }
    } else {
        for (int idx = threadIdx.x; idx < D; idx += blockDim.x) {
            float xv  = __bfloat162float(x[base + idx]);
            float xrv = __bfloat162float(x_res[base + idx]);
            float res = fmaf(xrv, scale, xv);
            out[base + idx] = __float2bfloat16(res);
        }
    }
}

// Specialized kernel for D = 3072 (6 elems per thread at 512 threads)
template <bool ExactMode>
__global__ void fused_residual_tanh_gated_rmsnorm_kernel_3072(
    const __nv_bfloat16* __restrict__ x,       // [N, 3072]
    const __nv_bfloat16* __restrict__ x_res,   // [N, 3072]
    const __nv_bfloat16* __restrict__ gate,    // [N]
    __nv_bfloat16* __restrict__ out,           // [N, 3072]
    const int N,
    const float eps
) {
    constexpr int D = 3072;
    constexpr int THREADS = 512;

    const int row = blockIdx.x;
    if (row >= N) return;

    // shared layout: [THREADS/32 floats for reduction] + [2 scalars: gate, inv_rms]
    __shared__ float s_reduce[THREADS / WARP_SIZE];
    __shared__ float s_scalars[2];

    // Thread 0 computes tanh(gate)
    if (threadIdx.x == 0) {
        float g = __bfloat162float(gate[row]);
        g = tanhf(g);
        if (ExactMode) {
            g = __bfloat162float(__float2bfloat16(g));
        }
        s_scalars[0] = g;
    }
    __syncthreads();

    const int base = row * D;
    const int tid = threadIdx.x;

    // Each thread handles 6 elements
    float xv[6], xrv[6];
    float thread_sum = 0.f;

    #pragma unroll
    for (int i = 0; i < 6; ++i) {
        const int idx = tid + i * THREADS;
        xrv[i] = __bfloat162float(x_res[base + idx]);
        xv[i]  = __bfloat162float(x[base + idx]);
        thread_sum = fmaf(xrv[i], xrv[i], thread_sum);
    }

    // Reduce sum to all threads
    // First reduce within warp
    float warp_sum = warp_reduce_sum(thread_sum);
    // Write warp results
    if ((tid & (WARP_SIZE - 1)) == 0) {
        s_reduce[tid / WARP_SIZE] = warp_sum;
    }
    __syncthreads();

    // Final reduction in warp 0 and broadcast
    if ((tid / WARP_SIZE) == 0) {
        float block_sum = (tid < THREADS / WARP_SIZE) ? s_reduce[tid] : 0.f;
        block_sum = warp_reduce_sum(block_sum);
        if ((tid & (WARP_SIZE - 1)) == 0) s_scalars[1] = rsqrtf(block_sum / float(D) + eps);
    }
    __syncthreads();

    const float scale = s_scalars[0] * s_scalars[1];

    if (ExactMode) {
        #pragma unroll
        for (int i = 0; i < 6; ++i) {
            float x_normed_f = xrv[i] * scale;
            __nv_bfloat16 x_normed_b = __float2bfloat16(x_normed_f);
            float sum_f = __bfloat162float(__float2bfloat16(xv[i])) + __bfloat162float(x_normed_b);
            out[base + (tid + i * THREADS)] = __float2bfloat16(sum_f);
        }
    } else {
        #pragma unroll
        for (int i = 0; i < 6; ++i) {
            float res = fmaf(xrv[i], scale, xv[i]);
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

    // Special fast path for D=3072 with 512 threads
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
    // shared: nwarps for reduce + 2 scalars
    size_t shmem = (nwarps + 2) * sizeof(float);

    dim3 grid(N);
    dim3 block(threads);

    fused_residual_tanh_gated_rmsnorm_kernel<ExactMode>
        <<<grid, block, shmem, stream>>>(x, x_res, gate, out, N, D, eps);
    C10_CUDA_KERNEL_LAUNCH_CHECK();
}

// Host entry
torch::Tensor fused_residual_tanh_gated_rmsnorm_cuda(
    torch::Tensor x,         // [N, D], bf16
    torch::Tensor x_res,     // [N, D], bf16
    torch::Tensor gate,      // [N] or [N,1], bf16
    double eps_d = 1e-6,
    bool exact_mode = false
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

    TORCH_CHECK(x.dim() == 2 && x_res.dim() == 2, "x and x_res must be 2D");
    TORCH_CHECK(x.sizes() == x_res.sizes(), "x and x_res must have the same shape");

    const int64_t N64 = x.size(0);
    const int64_t D64 = x.size(1);
    TORCH_CHECK(N64 <= INT_MAX && D64 <= INT_MAX, "N or D too large");
    const int N = static_cast<int>(N64);
    const int D = static_cast<int>(D64);

    // Accept gate shape [N] or [N,1]; flatten
    TORCH_CHECK(gate.numel() == N, "gate must have N elements (shape [N] or [N,1])");
    auto gate_flat = gate.reshape({N}).contiguous();

    auto out = torch::empty_like(x);

    const __nv_bfloat16* x_ptr     = reinterpret_cast<const __nv_bfloat16*>(x.data_ptr<at::BFloat16>());
    const __nv_bfloat16* x_res_ptr = reinterpret_cast<const __nv_bfloat16*>(x_res.data_ptr<at::BFloat16>());
    const __nv_bfloat16* gate_ptr  = reinterpret_cast<const __nv_bfloat16*>(gate_flat.data_ptr<at::BFloat16>());
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

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
    m.def("fused_residual_tanh_gated_rmsnorm_cuda",
          &fused_residual_tanh_gated_rmsnorm_cuda,
          "Fused Residual Tanh-Gated RMSNorm (CUDA)",
          py::arg("x"),
          py::arg("x_res"),
          py::arg("gate"),
          py::arg("eps") = 1e-6,
          py::arg("exact_mode") = false);
}