from __future__ import annotations

import argparse
import csv
from pathlib import Path
import sys

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


BOARD_SIZE = 9
BOARD_OUTPUT_SIZE = 900
CELL_TILE_SIZE = 140
LABEL_BAR_HEIGHT = 34
GRID_TEXT_COLOR = (240, 240, 240)
GRID_LINE_COLOR = (60, 180, 255)
GRID_LINE_THICKNESS = 2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Preview board crop and generated cells for a dataset image")
    parser.add_argument("--id", required=True, help="image id without extension")
    parser.add_argument("--dataset-root", default=str(ROOT), help="dataset root directory")
    return parser.parse_args()


def load_rows(dataset_root: Path, image_id: str) -> list[dict[str, str]]:
    manifest_path = dataset_root / "manifests" / "cells.csv"
    if not manifest_path.exists():
        raise FileNotFoundError(f"manifest not found: {manifest_path}")

    with manifest_path.open(newline="", encoding="utf-8") as handle:
        rows = [row for row in csv.DictReader(handle) if row.get("image_id") == image_id]

    if len(rows) != BOARD_SIZE * BOARD_SIZE:
        raise ValueError(f"expected 81 rows for image {image_id}, found {len(rows)}")

    rows.sort(key=lambda row: (int(row["rank"]), -int(row["file"])))
    return rows


def load_image(path: Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(f"failed to load image: {path}")
    return image


def fit_to_tile(image: np.ndarray, tile_size: int) -> np.ndarray:
    height, width = image.shape[:2]
    scale = min((tile_size - 8) / max(width, 1), (tile_size - 8) / max(height, 1))
    new_width = max(1, int(round(width * scale)))
    new_height = max(1, int(round(height * scale)))
    resized = cv2.resize(image, (new_width, new_height), interpolation=cv2.INTER_AREA)
    canvas = np.full((tile_size, tile_size, 3), 245, dtype=np.uint8)
    x0 = (tile_size - new_width) // 2
    y0 = (tile_size - new_height) // 2
    canvas[y0 : y0 + new_height, x0 : x0 + new_width] = resized
    return canvas


def draw_text(image: np.ndarray, text: str, origin: tuple[int, int], scale: float = 0.45, color: tuple[int, int, int] = (0, 0, 0)) -> None:
    cv2.putText(image, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), 3, cv2.LINE_AA)
    cv2.putText(image, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, color, 1, cv2.LINE_AA)


def render_board_grid(board_crop_path: Path) -> np.ndarray:
    board = load_image(board_crop_path)
    board = cv2.resize(board, (BOARD_OUTPUT_SIZE, BOARD_OUTPUT_SIZE), interpolation=cv2.INTER_CUBIC)
    step = BOARD_OUTPUT_SIZE // BOARD_SIZE

    for i in range(BOARD_SIZE + 1):
        pos = i * step
        cv2.line(board, (pos, 0), (pos, BOARD_OUTPUT_SIZE - 1), GRID_LINE_COLOR, GRID_LINE_THICKNESS)
        cv2.line(board, (0, pos), (BOARD_OUTPUT_SIZE - 1, pos), GRID_LINE_COLOR, GRID_LINE_THICKNESS)

    for row in range(BOARD_SIZE):
        for col in range(BOARD_SIZE):
            file_num = 9 - col
            rank_num = row + 1
            x = col * step + 8
            y = row * step + 18
            draw_text(board, f"r{rank_num}_f{file_num}", (x, y), scale=0.42, color=GRID_TEXT_COLOR)

    return board


def render_cells_preview(dataset_root: Path, rows: list[dict[str, str]]) -> np.ndarray:
    tile_width = CELL_TILE_SIZE
    tile_height = CELL_TILE_SIZE + LABEL_BAR_HEIGHT
    canvas = np.full((BOARD_SIZE * tile_height, BOARD_SIZE * tile_width, 3), 250, dtype=np.uint8)

    for index, row in enumerate(rows):
        rank = int(row["rank"])
        file_num = int(row["file"])
        label = row["label"]
        cell_path = dataset_root / row["cell_path"]
        cell = load_image(cell_path)
        tile = fit_to_tile(cell, CELL_TILE_SIZE)

        row_index = rank - 1
        col_index = 9 - file_num
        y0 = row_index * tile_height
        x0 = col_index * tile_width
        canvas[y0 : y0 + CELL_TILE_SIZE, x0 : x0 + CELL_TILE_SIZE] = tile

        bar = canvas[y0 + CELL_TILE_SIZE : y0 + tile_height, x0 : x0 + CELL_TILE_SIZE]
        bar[:] = (235, 235, 235)
        draw_text(bar, f"r{rank} f{file_num}", (6, 13), scale=0.36, color=(20, 20, 20))
        draw_text(bar, label, (6, 29), scale=0.46, color=(0, 90, 180))

        cv2.rectangle(canvas, (x0, y0), (x0 + CELL_TILE_SIZE - 1, y0 + tile_height - 1), (200, 200, 200), 1)

    return canvas


def main() -> None:
    args = parse_args()
    dataset_root = Path(args.dataset_root)
    if not dataset_root.is_absolute():
        dataset_root = ROOT / dataset_root
    image_id = args.id

    rows = load_rows(dataset_root, image_id)
    board_crop_path = dataset_root / "board_crops" / f"{image_id}_board.png"
    if not board_crop_path.exists():
        raise FileNotFoundError(f"board crop not found: {board_crop_path}")

    reports_dir = dataset_root / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    board_grid = render_board_grid(board_crop_path)
    cells_preview = render_cells_preview(dataset_root, rows)

    board_grid_path = reports_dir / f"{image_id}_board_grid.png"
    cells_preview_path = reports_dir / f"{image_id}_cells_preview.png"

    if not cv2.imwrite(str(board_grid_path), board_grid):
        raise IOError(f"failed to write report image: {board_grid_path}")
    if not cv2.imwrite(str(cells_preview_path), cells_preview):
        raise IOError(f"failed to write report image: {cells_preview_path}")

    print(board_grid_path)
    print(cells_preview_path)


if __name__ == "__main__":
    main()
