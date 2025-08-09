# Stage 1: Builder
FROM nvidia/cuda:12.6.3-devel-ubuntu22.04 AS builder

# Install system dependencies required for building
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-dev git curl build-essential ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy uv binary for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Set uv to use system Python
ENV UV_SYSTEM_PYTHON=1
ENV TORCH_CUDA_ARCH_LIST="9.0"

WORKDIR /app

# Copy dependency files AND setup.py first for Docker layer caching
COPY pyproject.toml uv.lock setup.py ./

# Install dependencies into a virtual environment
RUN uv sync --frozen --no-dev --no-install-package torch
RUN uv pip install --no-cache-dir setuptools>=75.2.0 pybind11 pip --python .venv/bin/python
RUN uv pip install torch==2.6.0+cu126 --index-url https://download.pytorch.org/whl/cu126 --python .venv/bin/python

# Copy source code into the builder stage
COPY src/ ./src/

# Set CUDA environment variables and install with CUDA support
ENV CUDA_HOME=/usr/local/cuda \
    PATH=/usr/local/cuda/bin:$PATH \
    LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH \
    FORCE_CUDA=1

# Now we can use pip since we installed it
RUN ./.venv/bin/python -m pip install . --no-build-isolation -v
RUN uv pip install .[flash] --no-build-isolation --no-cache-dir --python .venv/bin/python

# --- Stage 2: Final Image ---
FROM nvidia/cuda:12.6.3-devel-ubuntu22.04

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-dev build-essential ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the virtual environment with all packages from the builder stage
COPY --from=builder /app/.venv ./.venv

# Copy the application source code from the builder stage
COPY --from=builder /app/src ./src

# Set environment variables for the application
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    COMPILE_DIT="1" \
    CUDA_HOME=/usr/local/cuda \
    PATH="/usr/local/cuda/bin:$PATH" \
    LD_LIBRARY_PATH="/usr/local/cuda/lib64:$LD_LIBRARY_PATH"

EXPOSE 8000

# Run the main application using the python from our venv
CMD ["./.venv/bin/python", "-u", "src/clipgen/main.py"]