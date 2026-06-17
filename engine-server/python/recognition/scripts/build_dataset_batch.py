from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build board/cell/preview dataset artifacts in batch")
    parser.add_argument("--from-id", required=True, help="start image id, e.g. 002")
    parser.add_argument("--to-id", required=True, help="end image id, e.g. 025")
    parser.add_argument("--source-id", required=True, help="source image id for cropRect reference")
    parser.add_argument("--dataset-root", default=str(ROOT), help="dataset root directory")
    parser.add_argument("--inner-margin", type=float, default=0.12, help="cell inset ratio passed to create_cells_from_sfen.py")
    return parser.parse_args()


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def id_to_int(image_id: str) -> int:
    return int(image_id)


def int_to_id(n: int) -> str:
    return f"{n:03d}"


def normalize_crop_rect(crop_rect: dict) -> dict[str, int]:
    x = int(crop_rect.get("x", 0))
    y = int(crop_rect.get("y", 0))
    width = int(crop_rect.get("width", crop_rect.get("w", 0)))
    height = int(crop_rect.get("height", crop_rect.get("h", 0)))
    if width <= 0 or height <= 0:
        raise ValueError("cropRect must have positive width and height")

    return {"x": x, "y": y, "width": width, "height": height}


def corners_to_crop_rect(corners: list[list[float]]) -> dict[str, int]:
    points = np.array(corners, dtype=np.float32)
    x_min = int(np.floor(float(np.min(points[:, 0]))))
    y_min = int(np.floor(float(np.min(points[:, 1]))))
    x_max = int(np.ceil(float(np.max(points[:, 0]))))
    y_max = int(np.ceil(float(np.max(points[:, 1]))))
    width = x_max - x_min
    height = y_max - y_min
    return {"x": x_min, "y": y_min, "width": width, "height": height}


def resolve_source_crop_rect(dataset_root: Path, source_id: str) -> tuple[dict[str, int], str]:
    source_path = dataset_root / "metadata" / f"{source_id}.json"
    source_meta = load_json(source_path)

    source_crop_rect = source_meta.get("cropRect")
    if isinstance(source_crop_rect, dict):
        return normalize_crop_rect(source_crop_rect), "cropRect"

    source_corners = source_meta.get("boardCorners")
    if isinstance(source_corners, list) and len(source_corners) == 4:
        return corners_to_crop_rect(source_corners), "boardCorners"

    raise ValueError(f"source metadata has neither cropRect nor boardCorners: {source_path}")


def run_command(command: list[str], dataset_root: Path) -> tuple[bool, str]:
    result = subprocess.run(command, cwd=dataset_root, text=True)
    if result.returncode == 0:
        return True, ""
    return False, f"exit code {result.returncode}: {' '.join(command)}"


def build_metadata_for_target(image_id: str, existing: dict, source_crop_rect: dict[str, int], source_id: str) -> dict:
    return {
        "id": image_id,
        "source": existing.get("source", "screenshot"),
        "theme": existing.get("theme", "default"),
        "orientation": existing.get("orientation", "normal"),
        "sideToMove": existing.get("sideToMove", "b"),
        "hasHands": existing.get("hasHands", False),
        "cropRect": source_crop_rect,
        "boardCorners": None,
        "note": f"{source_id}と同じcropRectを適用",
    }


def count_manifest_rows_for_ids(dataset_root: Path, image_ids: list[str]) -> int:
    manifest_path = dataset_root / "manifests" / "cells.csv"
    if not manifest_path.exists():
        return 0
    id_set = set(image_ids)
    with manifest_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return sum(1 for row in reader if row.get("image_id") in id_set)


def main() -> None:
    args = parse_args()
    dataset_root = Path(args.dataset_root)
    if not dataset_root.is_absolute():
        dataset_root = ROOT / dataset_root

    start = id_to_int(args.from_id)
    end = id_to_int(args.to_id)
    if end < start:
        raise ValueError("--to-id must be >= --from-id")

    source_crop_rect, source_rect_origin = resolve_source_crop_rect(dataset_root, args.source_id)

    processed_ids: list[str] = []
    skipped_ids: list[dict[str, str]] = []
    failed_ids: list[dict[str, str]] = []
    succeeded_ids: list[str] = []

    for n in range(start, end + 1):
        image_id = int_to_id(n)
        raw_path = dataset_root / "raw" / f"{image_id}.png"
        label_path = dataset_root / "labels" / f"{image_id}.sfen"
        if not raw_path.exists() or not label_path.exists():
            reason = []
            if not raw_path.exists():
                reason.append("raw missing")
            if not label_path.exists():
                reason.append("label missing")
            skipped_ids.append({"id": image_id, "reason": ", ".join(reason)})
            continue

        processed_ids.append(image_id)

        metadata_path = dataset_root / "metadata" / f"{image_id}.json"
        existing = load_json(metadata_path)
        updated = build_metadata_for_target(image_id, existing, source_crop_rect, args.source_id)
        write_json(metadata_path, updated)

        commands = [
            [sys.executable, str(ROOT / "scripts" / "crop_board.py"), "--id", image_id, "--dataset-root", str(dataset_root)],
            [
                sys.executable,
                str(ROOT / "scripts" / "create_cells_from_sfen.py"),
                "--id",
                image_id,
                "--dataset-root",
                str(dataset_root),
                "--inner-margin",
                str(args.inner_margin),
            ],
            [sys.executable, str(ROOT / "scripts" / "preview_cells.py"), "--id", image_id, "--dataset-root", str(dataset_root)],
            [sys.executable, str(ROOT / "scripts" / "preview_crop_rect.py"), "--id", image_id, "--dataset-root", str(dataset_root)],
        ]

        failed = False
        for command in commands:
            ok, err = run_command(command, dataset_root)
            if not ok:
                failed_ids.append({"id": image_id, "error": err})
                failed = True
                break

        if not failed:
            succeeded_ids.append(image_id)

    total_generated_cell_rows = count_manifest_rows_for_ids(dataset_root, succeeded_ids)
    report_targets = [
        {
            "id": image_id,
            "board_grid": str(dataset_root / "reports" / f"{image_id}_board_grid.png"),
            "cells_preview": str(dataset_root / "reports" / f"{image_id}_cells_preview.png"),
            "crop_rect_preview": str(dataset_root / "reports" / f"{image_id}_crop_rect_preview.png"),
        }
        for image_id in succeeded_ids
    ]

    summary = {
        "source_id": args.source_id,
        "source_crop_rect_origin": source_rect_origin,
        "source_crop_rect": source_crop_rect,
        "processed_ids": processed_ids,
        "skipped_ids": skipped_ids,
        "failed_ids": failed_ids,
        "total_generated_cell_rows": total_generated_cell_rows,
        "reports": report_targets,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
