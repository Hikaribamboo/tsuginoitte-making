from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any
import warnings

import cv2
import numpy as np


DEFAULT_BOARD_OUTPUT_SIZE = 900


@dataclass(frozen=True)
class CropMetadata:
    id: str
    source: str = "screenshot"
    theme: str = "default"
    orientation: str = "normal"
    sideToMove: str = "b"
    hasHands: bool = False
    cropRect: dict[str, int] | list[int] | None = None
    boardCorners: list[list[int]] | None = None
    note: str = ""


@dataclass(frozen=True)
class BoardCropResult:
    output_path: Path
    method: str
    crop_rect: dict[str, int] | None
    board_corners: list[list[float]] | None
    crop_rect_equivalent: dict[str, int] | None


def load_metadata(metadata_path: Path, image_id: str) -> CropMetadata:
    if metadata_path.exists():
        raw = json.loads(metadata_path.read_text(encoding="utf-8"))
    else:
        raw = {
            "id": image_id,
            "source": "screenshot",
            "theme": "default",
            "orientation": "normal",
            "sideToMove": "b",
            "hasHands": False,
            "cropRect": None,
            "boardCorners": None,
            "note": "",
        }
        metadata_path.parent.mkdir(parents=True, exist_ok=True)
        metadata_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return CropMetadata(
        id=str(raw.get("id", image_id)),
        source=str(raw.get("source", "screenshot")),
        theme=str(raw.get("theme", "default")),
        orientation=str(raw.get("orientation", "normal")),
        sideToMove=str(raw.get("sideToMove", "b")),
        hasHands=bool(raw.get("hasHands", False)),
        cropRect=raw.get("cropRect"),
        boardCorners=raw.get("boardCorners"),
        note=str(raw.get("note", "")),
    )


def _load_image(image_path: Path) -> np.ndarray:
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(f"failed to read image: {image_path}")
    return image


def _normalize_crop_rect(crop_rect: dict[str, Any] | list[Any]) -> dict[str, int]:
    if isinstance(crop_rect, dict):
        x = int(crop_rect.get("x", 0))
        y = int(crop_rect.get("y", 0))
        width = int(crop_rect.get("width", crop_rect.get("w", 0)))
        height = int(crop_rect.get("height", crop_rect.get("h", 0)))
        return {"x": x, "y": y, "width": width, "height": height}
    if isinstance(crop_rect, list) and len(crop_rect) == 4:
        x, y, width, height = (int(v) for v in crop_rect)
        return {"x": x, "y": y, "width": width, "height": height}
    raise ValueError("cropRect must be an object with x/y/width/height or x/y/w/h, or a 4-item array")


def _order_points(points: np.ndarray) -> np.ndarray:
    if points.shape != (4, 2):
        raise ValueError("expected 4 points")
    ordered = np.zeros((4, 2), dtype=np.float32)
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1)
    ordered[0] = points[np.argmin(sums)]
    ordered[2] = points[np.argmax(sums)]
    ordered[1] = points[np.argmin(diffs)]
    ordered[3] = points[np.argmax(diffs)]
    return ordered


def _warp_to_square(image: np.ndarray, corners: np.ndarray, output_size: int = DEFAULT_BOARD_OUTPUT_SIZE) -> np.ndarray:
    ordered = _order_points(corners.astype(np.float32))
    width_a = np.linalg.norm(ordered[2] - ordered[3])
    width_b = np.linalg.norm(ordered[1] - ordered[0])
    height_a = np.linalg.norm(ordered[1] - ordered[2])
    height_b = np.linalg.norm(ordered[0] - ordered[3])
    side = max(int(round(max(width_a, width_b, height_a, height_b))), 1)
    side = max(side, output_size)
    destination = np.array(
        [[0, 0], [side - 1, 0], [side - 1, side - 1], [0, side - 1]],
        dtype=np.float32,
    )
    transform = cv2.getPerspectiveTransform(ordered, destination)
    warped = cv2.warpPerspective(image, transform, (side, side), flags=cv2.INTER_CUBIC)
    if side != output_size:
        warped = cv2.resize(warped, (output_size, output_size), interpolation=cv2.INTER_CUBIC)
    return warped


def _detect_board_corners(image: np.ndarray) -> np.ndarray | None:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    kernel = np.ones((5, 5), np.uint8)
    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    image_area = image.shape[0] * image.shape[1]
    for contour in contours[:10]:
        area = cv2.contourArea(contour)
        if area < image_area * 0.1:
            continue
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approx) == 4:
            return approx.reshape(4, 2).astype(np.float32)

    rect = cv2.minAreaRect(contours[0])
    box = cv2.boxPoints(rect)
    return box.astype(np.float32)


def _center_square_crop(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    side = min(height, width)
    side = max(int(round(side * 0.88)), 1)
    x0 = max((width - side) // 2, 0)
    y0 = max((height - side) // 2, 0)
    crop = image[y0 : y0 + side, x0 : x0 + side]
    return cv2.resize(crop, (DEFAULT_BOARD_OUTPUT_SIZE, DEFAULT_BOARD_OUTPUT_SIZE), interpolation=cv2.INTER_CUBIC)


def _corners_to_crop_rect(corners: np.ndarray) -> dict[str, int]:
    x_min = int(np.floor(float(np.min(corners[:, 0]))))
    y_min = int(np.floor(float(np.min(corners[:, 1]))))
    x_max = int(np.ceil(float(np.max(corners[:, 0]))))
    y_max = int(np.ceil(float(np.max(corners[:, 1]))))
    return {"x": x_min, "y": y_min, "width": x_max - x_min, "height": y_max - y_min}


def _is_nearly_square(width: int, height: int, tolerance: float = 0.05) -> bool:
    if width <= 0 or height <= 0:
        return False
    ratio = width / height
    return (1.0 - tolerance) <= ratio <= (1.0 + tolerance)


def save_board_crop(dataset_root: Path, image_id: str) -> BoardCropResult:
    source_image_path = dataset_root / "raw" / f"{image_id}.png"
    metadata_path = dataset_root / "metadata" / f"{image_id}.json"
    output_path = dataset_root / "board_crops" / f"{image_id}_board.png"

    if not source_image_path.exists():
        raise FileNotFoundError(f"source image not found: {source_image_path}")

    metadata = load_metadata(metadata_path, image_id)
    image = _load_image(source_image_path)
    method = "centerSquare"
    crop_rect: dict[str, int] | None = None
    board_corners: list[list[float]] | None = None
    crop_rect_equivalent: dict[str, int] | None = None

    if metadata.boardCorners:
        corners = np.array(metadata.boardCorners, dtype=np.float32)
        if corners.shape != (4, 2):
            raise ValueError("boardCorners must contain 4 points")
        board = _warp_to_square(image, corners)
        method = "boardCorners"
        board_corners = [[float(x), float(y)] for x, y in corners.tolist()]
        crop_rect_equivalent = _corners_to_crop_rect(corners)
    elif metadata.cropRect:
        normalized = _normalize_crop_rect(metadata.cropRect)
        x = normalized["x"]
        y = normalized["y"]
        width = normalized["width"]
        height = normalized["height"]
        if width <= 0 or height <= 0:
            raise ValueError("cropRect must have positive width and height")
        if width != height:
            warnings.warn(
                f"cropRect is not square for {image_id}: width={width}, height={height}; using square side={max(width, height)}",
                stacklevel=2,
            )
            side = max(width, height)
        else:
            side = width
        x = max(x, 0)
        y = max(y, 0)
        crop = image[y : y + side, x : x + side]
        if crop.size == 0:
            raise ValueError("cropRect produced an empty crop")
        board = cv2.resize(crop, (DEFAULT_BOARD_OUTPUT_SIZE, DEFAULT_BOARD_OUTPUT_SIZE), interpolation=cv2.INTER_CUBIC)
        method = "cropRect"
        crop_rect = {"x": x, "y": y, "width": side, "height": side}
    else:
        corners = _detect_board_corners(image)
        if corners is not None:
            equivalent = _corners_to_crop_rect(corners)
            if _is_nearly_square(equivalent["width"], equivalent["height"]):
                board = _warp_to_square(image, corners)
                method = "autoDetectedCorners"
                board_corners = [[float(x), float(y)] for x, y in corners.tolist()]
                crop_rect_equivalent = equivalent
            else:
                warnings.warn(
                    f"auto-detected board bbox is not square for {image_id}: width={equivalent['width']}, height={equivalent['height']}; falling back to centered square crop",
                    stacklevel=2,
                )
                board = _center_square_crop(image)
                method = "centerSquare"
        else:
            board = _center_square_crop(image)
            method = "centerSquare"
            crop_rect_equivalent = {"x": 0, "y": 0, "w": int(image.shape[1]), "h": int(image.shape[0])}

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(output_path), board):
        raise IOError(f"failed to write board crop: {output_path}")

    return BoardCropResult(
        output_path=output_path,
        method=method,
        crop_rect=crop_rect,
        board_corners=board_corners,
        crop_rect_equivalent=crop_rect_equivalent,
    )


def read_board_crop(dataset_root: Path, image_id: str) -> np.ndarray:
    board_crop_path = dataset_root / "board_crops" / f"{image_id}_board.png"
    board = cv2.imread(str(board_crop_path), cv2.IMREAD_COLOR)
    if board is None:
        raise FileNotFoundError(f"board crop not found: {board_crop_path}")
    return board
