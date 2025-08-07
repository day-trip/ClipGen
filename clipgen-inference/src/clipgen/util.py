import os
from pathlib import Path
from typing import Dict, List, Tuple

def dump_mochi_weights_info(base_dir: Path) -> None:
    """Print detailed information about all files in the mochi models directory."""

    print("=" * 80)
    print(f"MOCHI MODELS DIRECTORY ANALYSIS: {base_dir}")
    print("=" * 80)

    if not base_dir.exists():
        print(f"❌ Directory does not exist: {base_dir}")
        return

    # Collect all files recursively
    all_files: List[Tuple[Path, int]] = []
    dir_sizes: Dict[str, int] = {}

    for root, dirs, files in os.walk(base_dir):
        root_path = Path(root)
        dir_size = 0

        print(f"\n📁 {root_path}")
        print("-" * 60)

        if not files:
            print("   (empty directory)")
            continue

        # Sort files by size (largest first)
        file_info = []
        for filename in files:
            filepath = root_path / filename
            try:
                size = filepath.stat().st_size
                file_info.append((filename, size))
                all_files.append((filepath, size))
                dir_size += size
            except (OSError, FileNotFoundError) as e:
                print(f"   ❌ {filename} - Error: {e}")

        # Sort by size descending
        file_info.sort(key=lambda x: x[1], reverse=True)

        for filename, size in file_info:
            print(f"   📄 {filename:<40} {format_size(size):>12}")

        if dir_size > 0:
            print(f"   {'Subtotal:':<40} {format_size(dir_size):>12}")
            dir_sizes[str(root_path)] = dir_size

    # Summary section
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)

    # Overall totals
    total_files = len(all_files)
    total_size = sum(size for _, size in all_files)

    print(f"\n📈 TOTALS:")
    print(f"   Total files: {total_files:,}")
    print(f"   Total size:  {format_size(total_size)}")

    # Disk usage check
    try:
        import shutil
        total, used, free = shutil.disk_usage(base_dir)
        print(f"\n💾 DISK USAGE (partition containing {base_dir}):")
        print(f"   Total space: {format_size(total)}")
        print(f"   Used space:  {format_size(used)}")
        print(f"   Free space:  {format_size(free)}")
        print(f"   Mochi %:     {(total_size / total * 100):.2f}% of partition")
    except Exception as e:
        print(f"   ❌ Could not get disk usage: {e}")

    print("=" * 80)


def format_size(size_bytes: int) -> str:
    """Format file size in human readable format."""
    if size_bytes == 0:
        return "0 B"

    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_bytes < 1024.0:
            if unit == 'B':
                return f"{size_bytes} {unit}"
            else:
                return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024.0

    return f"{size_bytes:.1f} PB"
