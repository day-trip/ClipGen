import asyncio
import fcntl
from pathlib import Path
from typing import Callable, Awaitable

async def coordinate_pod_work(
        work_dir: Path,
        is_work_complete: Callable[[], bool],
        do_work: Callable[[], Awaitable[None]],
        *,
        lock_name: str = "work",
        work_description: str = "work",
        max_wait_seconds: int = 1800,
        check_interval_seconds: int = 30
) -> None:
    """
    Coordinate exclusive work across Kubernetes pods with file-based locking.

    Args:
        work_dir: Directory to store lock file
        is_work_complete: Function that returns True if work is already done
        do_work: Async function that performs the actual work
        lock_name: Name for the lock file (creates .{lock_name}.lock)
        work_description: Description for logging
        max_wait_seconds: Maximum time to wait for other pods
        check_interval_seconds: How often to check if work is complete
    """
    print(f"Checking if {work_description} is needed in {work_dir}")
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    # FAST PATH: Check if work already complete
    if is_work_complete():
        print(f"✅ {work_description} already complete, skipping")
        return

    # SLOW PATH: Work needed, coordinate across pods
    print(f"⏳ {work_description} needed, coordinating across pods...")
    lock_file = work_dir / f".{lock_name}.lock"

    try:
        with open(lock_file, 'w') as f:
            try:
                # Try to acquire exclusive lock (non-blocking)
                fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                print(f"🔒 Acquired lock, performing {work_description}...")

                # Double-check work isn't complete (race condition protection)
                if not is_work_complete():
                    await do_work()
                    print(f"✅ {work_description} completed successfully")
                else:
                    print(f"✅ {work_description} was completed by another pod during lock acquisition")

            except IOError:
                # Another pod has the lock, wait for completion
                print(f"⏳ Another pod is performing {work_description}, waiting...")
                await _wait_for_pod_work_completion(
                    work_dir, is_work_complete, work_description,
                    lock_name, max_wait_seconds, check_interval_seconds
                )

    except Exception as e:
        print(f"❌ Error during {work_description}: {e}")
        raise
    finally:
        # Clean up lock file
        try:
            lock_file.unlink()
        except FileNotFoundError:
            pass  # Already cleaned up
        except Exception as e:
            print(f"Failed to clean up lock file: {e}")


async def _wait_for_pod_work_completion(
        work_dir: Path,
        is_complete: Callable[[], bool],
        work_description: str,
        lock_name: str,
        max_wait_seconds: int,
        check_interval_seconds: int
) -> None:
    """Wait for another pod to complete the work."""
    lock_file = work_dir / f".{lock_name}.lock"
    waited = 0

    while waited < max_wait_seconds:
        if is_complete():
            print(f"✅ {work_description} completed by another pod")
            return

        # Check if lock still exists
        if not lock_file.exists():
            print(f"⚠️ Lock file gone but {work_description} incomplete, will retry")
            break

        print(f"⏳ Still waiting for {work_description}... ({waited}s/{max_wait_seconds}s)")
        await asyncio.sleep(check_interval_seconds)
        waited += check_interval_seconds

    if waited >= max_wait_seconds:
        raise TimeoutError(f"Timeout waiting for {work_description} to complete")