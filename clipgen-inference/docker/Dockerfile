# Stage 1: Builder
# This stage has all the build tools needed to install complex Python packages.
FROM nvidia/cuda:12.6.3-devel-ubuntu22.04 AS builder

# Install system dependencies required for building
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-dev git curl build-essential ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy uv binary for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Set uv to use system Python
ENV UV_SYSTEM_PYTHON=1

WORKDIR /app

# Copy dependency files first for Docker layer caching
COPY pyproject.toml uv.lock ./

# Install dependencies into a virtual environment
RUN uv sync --frozen --no-dev
RUN uv pip install --no-cache-dir setuptools>=75.2.0 --python .venv/bin/python
RUN uv pip install -e . --no-build-isolation --python .venv/bin/python
# The [flash] extra likely pulls in dependencies that need the toolchain
RUN uv pip install .[flash] --no-build-isolation --no-cache-dir --python .venv/bin/python

# Copy source code into the builder stage
COPY src/ ./src/


# --- Stage 2: Final Image ---
# This stage creates the final, smaller image. We copy the built .venv
# from the builder stage, but we MUST keep build-essential for torch.compile
FROM nvidia/cuda:12.6.3-devel-ubuntu22.04

# Install only the RUNTIME system dependencies.
# build-essential and python3.10-dev ARE runtime dependencies for torch.compile
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-dev build-essential ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the virtual environment with all packages from the builder stage
COPY --from=builder /app/.venv ./.venv

# Copy the application source code from the builder stage
COPY --from=builder /app/src ./src

# Set environment variables for the application
# Note the corrected syntax for COMPILE_DIT
ENV PYTHONPATH="/app/src" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    COMPILE_DIT="1"

EXPOSE 8000

# Run the main application using the python from our venv
CMD ["./.venv/bin/python", "-u", "src/clipgen/main.py"]