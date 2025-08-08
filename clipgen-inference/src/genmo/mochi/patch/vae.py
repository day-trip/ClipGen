import torch

import genmo.mochi.dit.context_parallel as cp
from genmo.mochi.vae.cp_conv import gather_all_frames
from genmo.mochi.vae.models import normalize_decoded_frames


def _run_tiled_decode_on_slice(
        decoder,
        z_slice,
        *,
        tile_sample_min_height: int,
        tile_sample_min_width: int,
        tile_overlap_factor_height: float,
        tile_overlap_factor_width: float,
        frame_batch_size: int,
        rank: int = 0,  # MODIFICATION: Added rank to control progress bar visibility.
):
    """
    This function contains the core tiling logic.
    Source: Its body is a direct copy of `decode_latents_tiled_full` from `models.py`.

    MODIFICATIONS:
    1. It operates on `z_slice` (a temporal slice of the full latent tensor) instead of the full `z`.
    2. It accepts a `rank` argument so that the progress bar only displays for the primary GPU (rank 0).
    3. The final `normalize_decoded_frames` call is removed; normalization will be handled by the main wrapper function.
    """
    B, C, T, H, W = z_slice.shape
    assert B == 1, "Tiled decoding only supports batch size 1"

    # --- The following logic is directly copied from `decode_latents_tiled_full` ---
    tile_latent_min_height = int(tile_sample_min_height / 8)
    tile_latent_min_width = int(tile_sample_min_width / 8)

    def blend_v(a: torch.Tensor, b: torch.Tensor, blend_extent: int) -> torch.Tensor:
        blend_extent = min(a.shape[3], b.shape[3], blend_extent)
        for y in range(blend_extent):
            b[:, :, :, y, :] = a[:, :, :, -blend_extent + y, :] * (1 - y / blend_extent) + b[:, :, :, y, :] * (
                    y / blend_extent
            )
        return b

    def blend_h(a: torch.Tensor, b: torch.Tensor, blend_extent: int) -> torch.Tensor:
        blend_extent = min(a.shape[4], b.shape[4], blend_extent)
        for x in range(blend_extent):
            b[:, :, :, :, x] = a[:, :, :, :, -blend_extent + x] * (1 - x / blend_extent) + b[:, :, :, :, x] * (
                    x / blend_extent
            )
        return b

    overlap_height = int(tile_latent_min_height * (1 - tile_overlap_factor_height))
    overlap_width = int(tile_latent_min_width * (1 - tile_overlap_factor_width))
    blend_extent_height = int(tile_sample_min_height * tile_overlap_factor_height)
    blend_extent_width = int(tile_sample_min_width * tile_overlap_factor_width)
    row_limit_height = tile_sample_min_height - blend_extent_height
    row_limit_width = tile_sample_min_width - blend_extent_width

    # MODIFICATION: Removed progress bar

    rows = []
    for i in range(0, H, overlap_height):
        row = []
        for j in range(0, W, overlap_width):
            temporal = []
            # Handle cases where T is smaller than frame_batch_size
            num_temporal_batches = T // frame_batch_size
            if T % frame_batch_size != 0:
                num_temporal_batches += 1

            for k in range(num_temporal_batches):
                start_frame = k * frame_batch_size
                end_frame = min((k + 1) * frame_batch_size, T)
                if start_frame >= end_frame: continue

                tile = z_slice[
                       :,
                       :,
                       start_frame:end_frame,
                       i: i + tile_latent_min_height,
                       j: j + tile_latent_min_width,
                       ]
                tile = decoder(tile)
                temporal.append(tile)
            row.append(torch.cat(temporal, dim=2))
        rows.append(row)

    result_rows = []
    for i, row in enumerate(rows):
        result_row = []
        for j, tile in enumerate(row):
            if i > 0:
                tile = blend_v(rows[i - 1][j], tile, blend_extent_height)
            if j > 0:
                tile = blend_h(row[j - 1], tile, blend_extent_width)
            result_row.append(tile[:, :, :, :row_limit_height, :row_limit_width])
        result_rows.append(torch.cat(result_row, dim=4))

    # MODIFICATION: Return the raw tensor. Normalization is handled outside this helper.
    return torch.cat(result_rows, dim=3)


@torch.inference_mode()
def decode_latents_tiled_distributed(
        decoder,
        z,
        *,
        tile_sample_min_height: int = 240,
        tile_sample_min_width: int = 424,
        tile_overlap_factor_height: float = 0.1666,
        tile_overlap_factor_width: float = 0.2,
        frame_batch_size: int = 16,  # Mini-optimization: Default to a safe batch size
):
    """
    This is the main function to be called from the pipeline.
    It combines the distributed logic from `decode_latents` with the tiling logic
    from `decode_latents_tiled_full` to perform a memory-efficient, parallel decode.
    """
    # --- Step 1: Split workload across GPUs ---
    # Source: Logic from `models.py:decode_latents`
    cp_rank, cp_size = cp.get_cp_rank_size()
    if cp_size > 1:
        z_slice = z.tensor_split(cp_size, dim=2)[cp_rank]
    else:
        z_slice = z

    # --- Step 2: Run tiled decoding on each GPU's slice ---
    decoded_slice = _run_tiled_decode_on_slice(
        decoder,
        z_slice,
        tile_sample_min_height=tile_sample_min_height,
        tile_sample_min_width=tile_sample_min_width,
        tile_overlap_factor_height=tile_overlap_factor_height,
        tile_overlap_factor_width=tile_overlap_factor_width,
        frame_batch_size=frame_batch_size,
        rank=cp_rank,
    )

    # --- Step 3: Gather results from all GPUs ---
    # Source: Logic from `models.py:decode_latents`
    if cp_size > 1:
        samples = gather_all_frames(decoded_slice)
    else:
        samples = decoded_slice

    # --- Step 4: Normalize and return the final video tensor ---
    return normalize_decoded_frames(samples)
