from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


BOARD_SIZE = 9
GRID_COLOR = (0, 200, 255)
GRID_THICKNESS = 1
RECT_COLOR = (0, 255, 255)
TEXT_COLOR = (245, 245, 245)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Preview a cropRect overlay with a 9x9 grid")
    parser.add_argument("--id", required=True, help="image id without extension")
    parser.add_argument("--x", type=int, help="cropRect x")
    parser.add_argument("--y", type=int, help="cropRect y")
    parser.add_argument("--width", type=int, help="cropRect width")
    parser.add_argument("--height", type=int, help="cropRect height")
    parser.add_argument("--size", type=int, help="square crop size (backward compatible)")
    return parser.parse_args()


def load_image(image_path: Path) -> np.ndarray:
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(f"failed to load image: {image_path}")
    return image


def load_metadata(metadata_path: Path) -> dict:
    if not metadata_path.exists():
        return {}
    return json.loads(metadata_path.read_text(encoding="utf-8"))


def corners_to_crop_rect(corners: list[list[float]]) -> tuple[int, int, int, int]:
    points = np.array(corners, dtype=np.float32)
    x_min = int(np.floor(float(np.min(points[:, 0]))))
    y_min = int(np.floor(float(np.min(points[:, 1]))))
    x_max = int(np.ceil(float(np.max(points[:, 0]))))
    y_max = int(np.ceil(float(np.max(points[:, 1]))))
    return x_min, y_min, x_max - x_min, y_max - y_min


def resolve_crop_rect(args: argparse.Namespace, image_id: str) -> tuple[int, int, int, int]:
    if args.size is not None:
        if args.x is None or args.y is None:
            raise ValueError("--size requires both --x and --y")
        return args.x, args.y, args.size, args.size

    if args.x is not None or args.y is not None or args.width is not None or args.height is not None:
        if None in (args.x, args.y, args.width, args.height):
            raise ValueError("when specifying coordinates, provide --x --y --width --height")
        return args.x, args.y, args.width, args.height

    metadata = load_metadata(ROOT / "metadata" / f"{image_id}.json")
    crop_rect = metadata.get("cropRect")
    if isinstance(crop_rect, dict):
        x = int(crop_rect.get("x", 0))
        y = int(crop_rect.get("y", 0))
        width = int(crop_rect.get("width", crop_rect.get("w", 0)))
        height = int(crop_rect.get("height", crop_rect.get("h", 0)))
        return x, y, width, height

    board_corners = metadata.get("boardCorners")
    if isinstance(board_corners, list) and len(board_corners) == 4:
        return corners_to_crop_rect(board_corners)

    raise ValueError("could not resolve crop rectangle; pass --x --y --width --height")


def draw_text(image: np.ndarray, text: str, origin: tuple[int, int], scale: float = 0.5, color: tuple[int, int, int] = (0, 0, 0)) -> None:
    cv2.putText(image, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), 3, cv2.LINE_AA)
    cv2.putText(image, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, color, 1, cv2.LINE_AA)


def render_preview(image: np.ndarray, x: int, y: int, width_rect: int, height_rect: int) -> np.ndarray:
    output = image.copy()
    image_height, image_width = output.shape[:2]
    x2 = min(x + width_rect, image_width)
    y2 = min(y + height_rect, image_height)

    cv2.rectangle(output, (x, y), (x2 - 1, y2 - 1), RECT_COLOR, 1)

    if x2 <= x or y2 <= y:
        raise ValueError("cropRect is outside the image bounds")

    # Draw a 9x9 grid inside the selected cropRect area.
    for i in range(1, BOARD_SIZE):
        px = x + int(round((x2 - x) * i / BOARD_SIZE))
        py = y + int(round((y2 - y) * i / BOARD_SIZE))
        cv2.line(output, (px, y), (px, y2), GRID_COLOR, GRID_THICKNESS)
        cv2.line(output, (x, py), (x2, py), GRID_COLOR, GRID_THICKNESS)

    draw_text(output, f"cropRect x={x} y={y} width={x2 - x} height={y2 - y}", (8, 18), scale=0.48, color=TEXT_COLOR)
    return output


def main() -> None:
    args = parse_args()
    source_image_path = ROOT / "raw" / f"{args.id}.png"
    reports_dir = ROOT / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    image = load_image(source_image_path)
    x, y, width_rect, height_rect = resolve_crop_rect(args, args.id)
    preview = render_preview(image, x, y, width_rect, height_rect)
    output_path = reports_dir / f"{args.id}_crop_rect_preview.png"

    if not cv2.imwrite(str(output_path), preview):
        raise IOError(f"failed to write preview image: {output_path}")

    print(output_path)


if __name__ == "__main__":
    main()
