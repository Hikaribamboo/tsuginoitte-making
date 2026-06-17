from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from shogi_recognition.class_map import dir_name_to_class  # noqa: E402


CELL_NAME_RE = re.compile(r"^(?P<image_id>\d{3})_r(?P<rank>[1-9])_f(?P<file>[1-9])\.png$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rebuild cells manifest from manually sorted class folders")
    parser.add_argument("--dataset-root", default=str(ROOT), help="dataset root directory")
    parser.add_argument("--split", default="train", choices=["train", "val", "test"], help="cell split to scan")
    parser.add_argument("--output", default="manifests/cells.csv", help="manifest output path")
    return parser.parse_args()


def write_manifest(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["image_id", "rank", "file", "label", "split", "cell_path", "source_image", "board_crop_path"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def main() -> None:
    args = parse_args()
    dataset_root = Path(args.dataset_root)
    if not dataset_root.is_absolute():
        dataset_root = ROOT / dataset_root

    cells_root = dataset_root / "cells" / args.split
    if not cells_root.exists():
        raise FileNotFoundError(f"cells split directory not found: {cells_root}")

    rows: list[dict[str, str]] = []
    warnings: list[str] = []
    seen: dict[tuple[str, str, str], str] = {}

    for dir_name, label in sorted(dir_name_to_class.items()):
        class_dir = cells_root / dir_name
        if not class_dir.exists():
            continue
        for cell_path in sorted(class_dir.glob("*.png")):
            match = CELL_NAME_RE.match(cell_path.name)
            if not match:
                warnings.append(f"ignored unexpected file name: {cell_path.relative_to(dataset_root)}")
                continue

            image_id = match.group("image_id")
            rank = match.group("rank")
            file_num = match.group("file")
            key = (image_id, rank, file_num)
            relative_cell_path = str(cell_path.relative_to(dataset_root))
            if key in seen:
                warnings.append(f"duplicate square {image_id} r{rank} f{file_num}: {seen[key]} and {relative_cell_path}")
                continue
            seen[key] = relative_cell_path
            rows.append(
                {
                    "image_id": image_id,
                    "rank": rank,
                    "file": file_num,
                    "label": label,
                    "split": args.split,
                    "cell_path": relative_cell_path,
                    "source_image": f"raw/{image_id}.png",
                    "board_crop_path": f"board_crops/{image_id}_board.png",
                }
            )

    rows.sort(key=lambda row: (row["image_id"], int(row["rank"]), -int(row["file"])))

    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = dataset_root / output_path
    write_manifest(output_path, rows)

    image_counts: dict[str, int] = {}
    for row in rows:
        image_counts[row["image_id"]] = image_counts.get(row["image_id"], 0) + 1
    incomplete = {image_id: count for image_id, count in sorted(image_counts.items()) if count != 81}

    print(f"manifest written: {output_path}")
    print(f"rows: {len(rows)}")
    print(f"images: {len(image_counts)}")
    if incomplete:
        print(f"incomplete images: {incomplete}")
    if warnings:
        print("warnings:")
        for warning in warnings:
            print(f"- {warning}")


if __name__ == "__main__":
    main()
