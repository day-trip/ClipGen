import asyncio
from pathlib import Path

import ray
import torch

from genmo.mochi.pipelines import DitModelFactory, ModelFactory
from clipgen.coordinator import coordinate_pod_work


class ShardingContext:
    """Minimal context for DiT shard extraction only."""

    def __init__(self, *, dit_factory, device_id, local_rank, world_size):
        import torch.distributed as dist
        import genmo.mochi.dit.context_parallel as cp

        self.device = torch.device(f"cuda:{device_id}")
        self.local_rank = local_rank
        self.world_size = world_size

        print(f"Initializing ShardingContext rank {local_rank + 1}/{world_size}")

        # Exact same distributed setup as DualGPUContext
        assert world_size > 1, f"Multi-GPU mode requires world_size > 1, got {world_size}"

        dist.init_process_group(
            "nccl",
            rank=local_rank,
            world_size=world_size,
            device_id=self.device,
        )
        pg = dist.group.WORLD
        cp.set_cp_group(pg, list(range(world_size)), local_rank)

        distributed_kwargs = dict(local_rank=local_rank, device_id=device_id, world_size=world_size)

        print(f"Rank {local_rank} starting DiT loading...")
        self.dit = dit_factory.get_model(**distributed_kwargs)

    def extract_dit_shard(self, checkpoint_dir: str) -> int:
        """Create distributed checkpoint from loaded FSDP model."""
        import torch.distributed.checkpoint as dcp
        from torch.distributed.checkpoint.state_dict import _patch_model_state_dict

        print(f"Rank {self.local_rank}: Creating distributed checkpoint...")
        _patch_model_state_dict(self.dit)
        dcp.save(
            state_dict={"model": self.dit},  # Just the model, no optimizer
            checkpoint_id=checkpoint_dir,    # Directory, not file
        )
        print(f"Rank {self.local_rank}: Distributed checkpoint saved to {checkpoint_dir}")

        # Step 3: Calculate params for reporting
        total_params = sum(p.numel() for p in self.dit.parameters())
        return total_params


async def create_shards(weights_dir: Path, shards_dir: Path) -> None:
    """
    Create pre-sharded DiT checkpoints using pod coordination.

    This function replicates the exact same model loading process as the real
    inference pipeline, then extracts each rank's portion of the DiT model.
    """

    def all_shards_exist() -> bool:
        """Check if distributed checkpoint already exists."""
        # Distributed checkpoint creates a .metadata file and rank-specific files
        metadata_file = shards_dir / ".metadata"

        if not metadata_file.exists():
            print(f"No distributed checkpoint found in {shards_dir}")
            return False

        # Also check for rank-specific checkpoint files
        world_size = 2  # Hardcoded for your setup
        rank_files = [
            shards_dir / f"__{rank}_0.distcp"  # Distributed checkpoint naming pattern
            for rank in range(world_size)
        ]

        all_exist = all(f.exists() for f in rank_files)

        if all_exist:
            print(f"Complete distributed checkpoint found in {shards_dir}")
        else:
            print(f"Incomplete distributed checkpoint in {shards_dir}")

        return all_exist

    async def create_missing_shards() -> None:
        """Actually create the shard files."""
        print("Starting shard creation process...")

        # Ensure output directory exists
        shards_dir.mkdir(parents=True, exist_ok=True)

        # Create the shards using Ray (identical to inference setup)
        await _create_shards_with_ray(weights_dir, shards_dir)

        print("Shard creation completed successfully")

    # Use coordinator to ensure only one pod does the sharding work
    await coordinate_pod_work(
        work_dir=shards_dir,
        is_work_complete=all_shards_exist,
        do_work=create_missing_shards,
        lock_name="sharding",
        work_description="DiT model sharding",
        max_wait_seconds=600  # 10 minutes - sharding might take a while
    )


async def _create_shards_with_ray(weights_dir: Path, shards_dir: Path) -> None:
    """Create shards using Ray - mirrors the real pipeline setup exactly."""

    world_size = 2
    print(f"Creating shards using Ray with world_size={world_size}")

    # Initialize Ray if not already running
    print("Initializing Ray for sharding...")
    ray.init(num_gpus=world_size)

    try:
        # Create the model factory (identical to the real pipeline)
        dit_factory = DitModelFactory(
            model_path=str(weights_dir / "dit.safetensors"),
            model_dtype="bf16"  # Must match your inference settings
        )

        # Create Ray actors for sharding
        sharding_actors = _create_sharding_actors(dit_factory, world_size)

        # Wait for all actors to initialize
        await _wait_for_actor_initialization(sharding_actors)

        # Extract shards from each actor
        await _extract_shards_from_actors(sharding_actors, shards_dir)
    finally:
        print(f"Shutting down Ray...")
        ray.shutdown()


def _create_sharding_actors(factory: ModelFactory, world_size: int) -> list:
    """Create Ray actors - only need DiT factory."""

    RemoteClass = ray.remote(ShardingContext)
    actors = [
        RemoteClass.options(num_gpus=1).remote(
            dit_factory=factory,  # Only pass the DiT factory
            world_size=world_size,
            device_id=0,  # Ray handles assignment
            local_rank=i,
        )
        for i in range(world_size)
    ]
    return actors


async def _wait_for_actor_initialization(actors: list) -> None:
    """Wait for all Ray actors to be ready - identical to MochiDualGPUPipeline."""
    print("Waiting for all Ray actors to initialize...")

    try:
        ready_refs = [ctx.__ray_ready__.remote() for ctx in actors]
        await asyncio.to_thread(ray.get, ready_refs, timeout=600)  # 10-minute timeout
        print("All Ray actors initialized successfully")
    except ray.exceptions.GetTimeoutError:
        print("Ray actor initialization timed out!")
        raise


async def _extract_shards_from_actors(actors: list, shards_dir: Path) -> None:
    """Extract distributed checkpoint from Ray actors."""
    print(f"Creating distributed checkpoint from {len(actors)} actors to {shards_dir}")

    try:
        # All actors participate in creating ONE distributed checkpoint
        # Pass the same directory to all actors
        checkpoint_dir = str(shards_dir)  # Same directory for all ranks

        shard_tasks = [
            actor.extract_dit_shard.remote(checkpoint_dir)
            for actor in actors
        ]

        print("Starting distributed checkpoint creation...")

        # All actors must complete together for the distributed checkpoint to be valid
        await asyncio.to_thread(ray.get, shard_tasks)

        print(f"Distributed checkpoint created!")

        # Validate the distributed checkpoint was created properly
        metadata_file = shards_dir / ".metadata"
        if not metadata_file.exists():
            raise FileNotFoundError(f"Distributed checkpoint metadata not found: {metadata_file}")

        print(f"Distributed checkpoint validated at {shards_dir}")

    except Exception as e:
        print(f"Error during distributed checkpoint creation: {e}")

        # Clean up the entire checkpoint directory on failure
        try:
            if shards_dir.exists():
                import shutil
                shutil.rmtree(shards_dir)
                print(f"Cleaned up failed checkpoint directory: {shards_dir}")
        except Exception as cleanup_error:
            print(f"Warning: Failed to clean up {shards_dir}: {cleanup_error}")

        raise
