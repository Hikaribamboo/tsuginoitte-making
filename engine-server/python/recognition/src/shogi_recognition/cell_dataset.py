from __future__ import annotations

from dataclasses import dataclass
import csv
from pathlib import Path

import cv2

from .class_map import class_to_idx
from .sfen import expand_sfen_to_board_labels, SfenError


BOARD_SIZE = 9
DEFAULT_INNER_MARGIN = 0.12


@dataclass(frozen=True)
class CellRecord:
    image_id: str
    rank: int
    file: int
    label: str
    split: str
    cell_path: str
    source_image: str
    board_crop_path: str


def _load_image(image_path: Path):
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(f"failed to read image: {image_path}")
    return image


def _cell_inner_bounds(start: int, end: int, margin_ratio: float) -> tuple[int, int]:
    span = max(end - start, 1)
    inset = int(round(span * margin_ratio))
    left = min(max(start + inset, 0), end)
    right = max(min(end - inset, end), left + 1)
    return left, right


def _write_csv(csv_path: Path, records: list[CellRecord]) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    existing_rows: list[dict[str, str]] = []
    if csv_path.exists():
        with csv_path.open(newline="", encoding="utf-8") as handle:
            existing_rows = list(csv.DictReader(handle))

    current_image_ids = {record.image_id for record in records}
    merged_rows = [row for row in existing_rows if row.get("image_id") not in current_image_ids]
    merged_rows.extend(
        {
            "image_id": record.image_id,
            "rank": str(record.rank),
            "file": str(record.file),
            "label": record.label,
            "split": record.split,
            "cell_path": record.cell_path,
            "source_image": record.source_image,
            "board_crop_path": record.board_crop_path,
        }
        for record in records
    )

    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow([
            "image_id",
            "rank",
            "file",
            "label",
            "split",
            "cell_path",
            "source_image",
            "board_crop_path",
        ])
        for row in merged_rows:
            writer.writerow([
                row["image_id"],
                row["rank"],
                row["file"],
                row["label"],
                row["split"],
                row["cell_path"],
                row["source_image"],
                row["board_crop_path"],
            ])


def create_cell_dataset(
    dataset_root: Path,
    image_id: str,
    split: str = "train",
    inner_margin: float = DEFAULT_INNER_MARGIN,
) -> list[CellRecord]:
    sfen_path = dataset_root / "labels" / f"{image_id}.sfen"
    board_crop_path = dataset_root / "board_crops" / f"{image_id}_board.png"
    source_image_path = dataset_root / "raw" / f"{image_id}.png"

    if not sfen_path.exists():
        raise FileNotFoundError(f"SFEN label not found: {sfen_path}")
    if not board_crop_path.exists():
        raise FileNotFoundError(f"board crop not found: {board_crop_path}")
    if not source_image_path.exists():
        raise FileNotFoundError(f"source image not found: {source_image_path}")

    sfen_text = sfen_path.read_text(encoding="utf-8").strip()
    board = expand_sfen_to_board_labels(sfen_text)
    labels = board.rows

    board_image = _load_image(board_crop_path)
    height, width = board_image.shape[:2]
    if height <= 0 or width <= 0:
        raise ValueError(f"invalid board crop size: {board_crop_path}")

    records: list[CellRecord] = []
    for row_index, row_labels in enumerate(labels):
        if len(row_labels) != BOARD_SIZE:
            raise SfenError(f"row {row_index + 1} does not have {BOARD_SIZE} labels")
        y0 = int(round(height * row_index / BOARD_SIZE))
        y1 = int(round(height * (row_index + 1) / BOARD_SIZE))
        inner_y0, inner_y1 = _cell_inner_bounds(y0, y1, inner_margin)

        for col_index, label in enumerate(row_labels):
            if label not in class_to_idx:
                raise SfenError(f"unsupported class label: {label}")
            x0 = int(round(width * col_index / BOARD_SIZE))
            x1 = int(round(width * (col_index + 1) / BOARD_SIZE))
            inner_x0, inner_x1 = _cell_inner_bounds(x0, x1, inner_margin)

            cell = board_image[inner_y0:inner_y1, inner_x0:inner_x1]
            if cell.size == 0:
                raise ValueError(f"empty cell crop at row {row_index + 1}, file {9 - col_index}")

            rank = row_index + 1
            file_num = 9 - col_index
            output_dir = dataset_root / "cells" / split / label
            output_dir.mkdir(parents=True, exist_ok=True)
            output_name = f"{image_id}_r{rank}_f{file_num}.png"
            output_path = output_dir / output_name
            if not cv2.imwrite(str(output_path), cell):
                raise IOError(f"failed to write cell image: {output_path}")

            records.append(
                CellRecord(
                    image_id=image_id,
                    rank=rank,
                    file=file_num,
                    label=label,
                    split=split,
                    cell_path=str(output_path.relative_to(dataset_root)),
                    source_image=str(source_image_path.relative_to(dataset_root)),
                    board_crop_path=str(board_crop_path.relative_to(dataset_root)),
                )
            )

    manifest_path = dataset_root / "manifests" / "cells.csv"
    _write_csv(manifest_path, records)
    return records
