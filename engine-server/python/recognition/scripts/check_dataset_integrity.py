from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from shogi_recognition.sfen import SfenError, expand_sfen_to_board_labels  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check manifest and dataset file integrity")
    parser.add_argument("--write-clean-manifest", action="store_true", help="write a filtered clean manifest CSV")
    parser.add_argument("--clean-manifest-path", default=str(ROOT / "manifests" / "cells.clean.csv"), help="output path for the clean manifest")
    parser.add_argument("--exclude-ids", default="001,005", help="comma-separated image IDs to exclude when building a clean manifest")
    return parser.parse_args()


def load_rows(manifest_path: Path) -> list[dict[str, str]]:
    with manifest_path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def write_manifest(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["image_id", "rank", "file", "label", "split", "cell_path", "source_image", "board_crop_path"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})


def main() -> None:
    args = parse_args()
    manifest_path = ROOT / "manifests" / "cells.csv"
    rows = load_rows(manifest_path)
    image_counts = Counter(row["image_id"] for row in rows)
    all_image_ids = sorted(image_counts)
    exclude_ids = {item.strip() for item in args.exclude_ids.split(",") if item.strip()}

    missing_raw_ids: list[str] = []
    missing_label_ids: list[str] = []
    missing_metadata_ids: list[str] = []
    missing_cell_rows: list[dict[str, str]] = []
    invalid_sfen_ids: list[str] = []
    wrong_row_count_ids: list[dict[str, int]] = []

    for image_id in all_image_ids:
        if image_counts[image_id] != 81:
            wrong_row_count_ids.append({"image_id": image_id, "rows": image_counts[image_id]})

        raw_path = ROOT / "raw" / f"{image_id}.png"
        label_path = ROOT / "labels" / f"{image_id}.sfen"
        metadata_path = ROOT / "metadata" / f"{image_id}.json"
        if not raw_path.exists():
            missing_raw_ids.append(image_id)
        if not label_path.exists():
            missing_label_ids.append(image_id)
        if not metadata_path.exists():
            missing_metadata_ids.append(image_id)

        cell_rows = [row for row in rows if row["image_id"] == image_id]
        missing_for_image = [row for row in cell_rows if not (ROOT / row["cell_path"]).exists()]
        missing_cell_rows.extend(missing_for_image)

        if label_path.exists() and raw_path.exists():
            try:
                label_text = label_path.read_text(encoding="utf-8").strip()
                expand_sfen_to_board_labels(label_text)
            except SfenError:
                invalid_sfen_ids.append(image_id)

    recommended_excludes = sorted(
        set(exclude_ids)
        | set(missing_raw_ids)
        | set(missing_label_ids)
        | set(missing_metadata_ids)
        | set(invalid_sfen_ids)
        | {row["image_id"] for row in missing_cell_rows}
        | {entry["image_id"] for entry in wrong_row_count_ids}
    )

    clean_rows = [row for row in rows if row["image_id"] not in recommended_excludes and (ROOT / row["cell_path"]).exists()]

    print(f"total rows: {len(rows)}")
    print("image_id row count:")
    for image_id in all_image_ids:
        print(f"  {image_id}: {image_counts[image_id]}")
    print(f"81行ではない image_id: {[entry['image_id'] for entry in wrong_row_count_ids]}")
    print(f"raw/{{id}}.png がない image_id: {missing_raw_ids}")
    print(f"labels/{{id}}.sfen がない image_id: {missing_label_ids}")
    print(f"metadata/{{id}}.json がない image_id: {missing_metadata_ids}")
    print(f"cell_path が存在しない行数: {len(missing_cell_rows)}")
    if missing_cell_rows:
        preview = [f"{row['image_id']} r{row['rank']} f{row['file']}" for row in missing_cell_rows[:10]]
        print(f"cell_path missing preview: {preview}")
    print(f"SFEN不整合 image_id: {invalid_sfen_ids}")
    print(f"除外推奨ID: {recommended_excludes}")

    clean_manifest_path = Path(args.clean_manifest_path)
    if not clean_manifest_path.is_absolute():
        clean_manifest_path = ROOT / clean_manifest_path
    print(f"clean manifest候補: {clean_manifest_path}")
    print(f"clean manifest候補 rows: {len(clean_rows)}")

    if args.write_clean_manifest:
        write_manifest(clean_manifest_path, clean_rows)
        print(f"clean manifest written: {clean_manifest_path}")

    summary_path = ROOT / "reports" / "dataset_integrity.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(
        json.dumps(
            {
                "total_rows": len(rows),
                "image_id_row_count": dict(image_counts),
                "wrong_row_count_ids": wrong_row_count_ids,
                "missing_raw_ids": missing_raw_ids,
                "missing_label_ids": missing_label_ids,
                "missing_metadata_ids": missing_metadata_ids,
                "missing_cell_rows": missing_cell_rows,
                "invalid_sfen_ids": invalid_sfen_ids,
                "recommended_excludes": recommended_excludes,
                "clean_manifest_candidate": str(clean_manifest_path),
                "clean_manifest_rows": len(clean_rows),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
