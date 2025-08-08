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
#include <tuple>

// Specialized kernel for D=1152 (4 elems per thread at 288 threads)
template <bool UpdateY>
__global__ void fused_conditioning_kernel_1152(
    const __nv_bfloat16* __restrict__ c,           // [B, 1152]
    const __nv_bfloat16* __restrict__ mod_x_weight, // [4608, 1152] (4*D, D)
    const __nv_bfloat16* __restrict__ mod_x_bias,   // [4608]
    const __nv_bfloat16* __restrict__ mod_y_weight, // [4608, 1152] or [1152, 1152]
    const __nv_bfloat16* __restrict__ mod_y_bias,   // [4608] or [1152]
    __nv_bfloat16* __restrict__ scale_msa_x,       // [B, 1152]
    __nv_bfloat16* __restrict__ gate_msa_x,        // [B, 1152]
    __nv_bfloat16* __restrict__ scale_mlp_x,       // [B, 1152]
    __nv_bfloat16* __restrict__ gate_mlp_x,        // [B, 1152]
    __nv_bfloat16* __restrict__ scale_msa_y,       // [B, 1152]
    __nv_bfloat16* __restrict__ gate_msa_y,        // [B, 1152] (if UpdateY)
    __nv_bfloat16* __restrict__ scale_mlp_y,       // [B, 1152] (if UpdateY)
    __nv_bfloat16* __restrict__ gate_mlp_y,        // [B, 1152] (if UpdateY)
    const int B
) {
    constexpr int D = 1152;
    constexpr int THREADS = 288;  // D / 4 = 288
    constexpr int OUT_DIM_X = 4 * D;  // 4608
    constexpr int OUT_DIM_Y = UpdateY ? 4 * D : D;

    const int batch_idx = blockIdx.x;
    if (batch_idx >= B) return;

    const int tid = threadIdx.x;

    // Shared memory for input c vector (reused for both linear layers)
    __shared__ float s_c[D];  // Store in fp32 for precision

    // Load c vector into shared memory with SiLU applied
    #pragma unroll
    for (int i = 0; i < 4; ++i) {
        const int idx = tid + i * THREADS;
        if (idx < D) {
            float c_val = __bfloat162float(c[batch_idx * D + idx]);
            // SiLU: x / (1 + exp(-x))
            s_c[idx] = c_val / (1.0f + expf(-c_val));
        }
    }
    __syncthreads();

    // Each thread computes 4 outputs for mod_x (16 total elements: 4 chunks × 4 elements)
    float mod_x_out[16];  // 4 outputs × 4 chunks

    #pragma unroll
    for (int chunk = 0; chunk < 4; ++chunk) {
        #pragma unroll
        for (int i = 0; i < 4; ++i) {
            const int out_idx = tid + i * THREADS + chunk * D;
            if (out_idx < OUT_DIM_X) {
                // GEMV: mod_x_weight[out_idx, :] · c + bias
                float acc = __bfloat162float(mod_x_bias[out_idx]);

                #pragma unroll
                for (int k = 0; k < D; ++k) {
                    float weight_val = __bfloat162float(mod_x_weight[out_idx * D + k]);
                    acc = fmaf(weight_val, s_c[k], acc);
                }

                mod_x_out[chunk * 4 + i] = acc;
            }
        }
    }

    // Store mod_x outputs to their respective chunks
    #pragma unroll
    for (int i = 0; i < 4; ++i) {
        const int idx = tid + i * THREADS;
        if (idx < D) {
            const int base_offset = batch_idx * D + idx;
            scale_msa_x[base_offset] = __float2bfloat16(mod_x_out[0 * 4 + i]);
            gate_msa_x[base_offset]  = __float2bfloat16(mod_x_out[1 * 4 + i]);
            scale_mlp_x[base_offset] = __float2bfloat16(mod_x_out[2 * 4 + i]);
            gate_mlp_x[base_offset]  = __float2bfloat16(mod_x_out[3 * 4 + i]);
        }
    }

    // Handle mod_y computation
    if (UpdateY) {
        // Similar pattern for mod_y with 4 chunks
        float mod_y_out[16];

        #pragma unroll
        for (int chunk = 0; chunk < 4; ++chunk) {
            #pragma unroll
            for (int i = 0; i < 4; ++i) {
                const int out_idx = tid + i * THREADS + chunk * D;
                if (out_idx < OUT_DIM_Y) {
                    float acc = __bfloat162float(mod_y_bias[out_idx]);

                    #pragma unroll
                    for (int k = 0; k < D; ++k) {
                        float weight_val = __bfloat162float(mod_y_weight[out_idx * D + k]);
                        acc = fmaf(weight_val, s_c[k], acc);
                    }

                    mod_y_out[chunk * 4 + i] = acc;
                }
            }
        }

        // Store mod_y outputs
        #pragma unroll
        for (int i = 0; i < 4; ++i) {
            const int idx = tid + i * THREADS;
            if (idx < D) {
                const int base_offset = batch_idx * D + idx;
                scale_msa_y[base_offset] = __float2bfloat16(mod_y_out[0 * 4 + i]);
                gate_msa_y[base_offset]  = __float2bfloat16(mod_y_out[1 * 4 + i]);
                scale_mlp_y[base_offset] = __float2bfloat16(mod_y_out[2 * 4 + i]);
                gate_mlp_y[base_offset]  = __float2bfloat16(mod_y_out[3 * 4 + i]);
            }
        }
    } else {
        // Just copy mod_y result to scale_msa_y (single output)
        #pragma unroll
        for (int i = 0; i < 4; ++i) {
            const int idx = tid + i * THREADS;
            if (idx < D) {
                float acc = __bfloat162float(mod_y_bias[idx]);

                #pragma unroll
                for (int k = 0; k < D; ++k) {
                    float weight_val = __bfloat162float(mod_y_weight[idx * D + k]);
                    acc = fmaf(weight_val, s_c[k], acc);
                }

                scale_msa_y[batch_idx * D + idx] = __float2bfloat16(acc);
            }
        }
    }
}

// Host entry
std::tuple<torch::Tensor, torch::Tensor, torch::Tensor, torch::Tensor,
           torch::Tensor, torch::Tensor, torch::Tensor, torch::Tensor>
fused_conditioning_block_cuda(
    const torch::Tensor& c,              // [B, D], bf16
    const torch::Tensor& mod_x_weight,   // [4*D, D], bf16
    const torch::Tensor& mod_x_bias,     // [4*D], bf16
    const torch::Tensor& mod_y_weight,   // [4*D, D] or [D, D], bf16
    const torch::Tensor& mod_y_bias,     // [4*D] or [D], bf16
    bool update_y
) {
    TORCH_CHECK(c.device().is_cuda(), "c must be CUDA");
    TORCH_CHECK(c.scalar_type() == at::kBFloat16, "c must be bfloat16");
    TORCH_CHECK(c.is_contiguous(), "c must be contiguous");
    TORCH_CHECK(c.dim() == 2, "c must be 2D [B, D]");

    const int64_t B64 = c.size(0);
    const int64_t D64 = c.size(1);
    TORCH_CHECK(B64 <= INT_MAX && D64 <= INT_MAX, "B or D too large");
    const int B = static_cast<int>(B64);
    const int D = static_cast<int>(D64);

    // Create output tensors
    auto options = c.options();
    auto scale_msa_x = torch::empty({B, D}, options);
    auto gate_msa_x = torch::empty({B, D}, options);
    auto scale_mlp_x = torch::empty({B, D}, options);
    auto gate_mlp_x = torch::empty({B, D}, options);
    auto scale_msa_y = torch::empty({B, D}, options);

    torch::Tensor gate_msa_y, scale_mlp_y, gate_mlp_y;
    if (update_y) {
        gate_msa_y = torch::empty({B, D}, options);
        scale_mlp_y = torch::empty({B, D}, options);
        gate_mlp_y = torch::empty({B, D}, options);
    } else {
        gate_msa_y = torch::empty({0}, options);
        scale_mlp_y = torch::empty({0}, options);
        gate_mlp_y = torch::empty({0}, options);
    }

    // Get pointers
    const __nv_bfloat16* c_ptr = reinterpret_cast<const __nv_bfloat16*>(c.data_ptr<at::BFloat16>());
    const __nv_bfloat16* mod_x_weight_ptr = reinterpret_cast<const __nv_bfloat16*>(mod_x_weight.data_ptr<at::BFloat16>());
    const __nv_bfloat16* mod_x_bias_ptr = reinterpret_cast<const __nv_bfloat16*>(mod_x_bias.data_ptr<at::BFloat16>());
    const __nv_bfloat16* mod_y_weight_ptr = reinterpret_cast<const __nv_bfloat16*>(mod_y_weight.data_ptr<at::BFloat16>());
    const __nv_bfloat16* mod_y_bias_ptr = reinterpret_cast<const __nv_bfloat16*>(mod_y_bias.data_ptr<at::BFloat16>());

    __nv_bfloat16* scale_msa_x_ptr = reinterpret_cast<__nv_bfloat16*>(scale_msa_x.data_ptr<at::BFloat16>());
    __nv_bfloat16* gate_msa_x_ptr = reinterpret_cast<__nv_bfloat16*>(gate_msa_x.data_ptr<at::BFloat16>());
    __nv_bfloat16* scale_mlp_x_ptr = reinterpret_cast<__nv_bfloat16*>(scale_mlp_x.data_ptr<at::BFloat16>());
    __nv_bfloat16* gate_mlp_x_ptr = reinterpret_cast<__nv_bfloat16*>(gate_mlp_x.data_ptr<at::BFloat16>());
    __nv_bfloat16* scale_msa_y_ptr = reinterpret_cast<__nv_bfloat16*>(scale_msa_y.data_ptr<at::BFloat16>());
    __nv_bfloat16* gate_msa_y_ptr = update_y ? reinterpret_cast<__nv_bfloat16*>(gate_msa_y.data_ptr<at::BFloat16>()) : nullptr;
    __nv_bfloat16* scale_mlp_y_ptr = update_y ? reinterpret_cast<__nv_bfloat16*>(scale_mlp_y.data_ptr<at::BFloat16>()) : nullptr;
    __nv_bfloat16* gate_mlp_y_ptr = update_y ? reinterpret_cast<__nv_bfloat16*>(gate_mlp_y.data_ptr<at::BFloat16>()) : nullptr;

    auto stream = at::cuda::getCurrentCUDAStream();

    // Launch kernel (specialized for D=1152)
    if (D == 1152) {
        dim3 grid(B);
        dim3 block(288);  // D / 4
        if (update_y) {
            fused_conditioning_kernel_1152<true><<<grid, block, 0, stream>>>(
                c_ptr, mod_x_weight_ptr, mod_x_bias_ptr, mod_y_weight_ptr, mod_y_bias_ptr,
                scale_msa_x_ptr, gate_msa_x_ptr, scale_mlp_x_ptr, gate_mlp_x_ptr,
                scale_msa_y_ptr, gate_msa_y_ptr, scale_mlp_y_ptr, gate_mlp_y_ptr, B);
        } else {
            fused_conditioning_kernel_1152<false><<<grid, block, 0, stream>>>(
                c_ptr, mod_x_weight_ptr, mod_x_bias_ptr, mod_y_weight_ptr, mod_y_bias_ptr,
                scale_msa_x_ptr, gate_msa_x_ptr, scale_mlp_x_ptr, gate_mlp_x_ptr,
                scale_msa_y_ptr, gate_msa_y_ptr, scale_mlp_y_ptr, gate_mlp_y_ptr, B);
        }
    } else {
        TORCH_CHECK(false, "Only D=1152 supported currently");
    }

    C10_CUDA_KERNEL_LAUNCH_CHECK();

    return std::make_tuple(scale_msa_x, gate_msa_x, scale_mlp_x, gate_mlp_x,
                          scale_msa_y, gate_msa_y, scale_mlp_y, gate_mlp_y);
}

// Meta kernel: validate shapes/dtypes and return meta tensors
static std::tuple<at::Tensor, at::Tensor, at::Tensor, at::Tensor,
                  at::Tensor, at::Tensor, at::Tensor, at::Tensor>
fused_conditioning_block_meta(
    const at::Tensor& c,
    const at::Tensor& mod_x_weight,
    const at::Tensor& mod_x_bias,
    const at::Tensor& mod_y_weight,
    const at::Tensor& mod_y_bias,
    bool update_y) {

    TORCH_CHECK(c.scalar_type() == at::kBFloat16, "c must be bfloat16");
    TORCH_CHECK(c.dim() == 2, "c must be 2D [B, D]");

    const int64_t B = c.size(0);
    const int64_t D = c.size(1);
    auto options = c.options().device(c10::Device(c10::kMeta));

    auto scale_msa_x = at::empty({B, D}, options);
    auto gate_msa_x = at::empty({B, D}, options);
    auto scale_mlp_x = at::empty({B, D}, options);
    auto gate_mlp_x = at::empty({B, D}, options);
    auto scale_msa_y = at::empty({B, D}, options);
    auto gate_msa_y = update_y ? at::empty({B, D}, options) : at::empty({0}, options);
    auto scale_mlp_y = update_y ? at::empty({B, D}, options) : at::empty({0}, options);
    auto gate_mlp_y = update_y ? at::empty({B, D}, options) : at::empty({0}, options);

    return std::make_tuple(scale_msa_x, gate_msa_x, scale_mlp_x, gate_mlp_x,
                          scale_msa_y, gate_msa_y, scale_mlp_y, gate_mlp_y);
}

// Register op schema
TORCH_LIBRARY(mochi, m) {
    m.def("fused_conditioning_block(Tensor c, Tensor mod_x_weight, Tensor mod_x_bias, Tensor mod_y_weight, Tensor mod_y_bias, bool update_y) -> (Tensor, Tensor, Tensor, Tensor, Tensor, Tensor, Tensor, Tensor)");
}

// Register Meta and CUDA implementations
TORCH_LIBRARY_IMPL(mochi, Meta, m) {
    m.impl("fused_conditioning_block", TORCH_FN(fused_conditioning_block_meta));
}

TORCH_LIBRARY_IMPL(mochi, CUDA, m) {
    m.impl("fused_conditioning_block", TORCH_FN(fused_conditioning_block_cuda));
}

// Keep an empty pybind11 module so importing the extension loads this .so
PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {}