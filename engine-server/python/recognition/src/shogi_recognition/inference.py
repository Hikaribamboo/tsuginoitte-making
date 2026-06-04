from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
from PIL import Image
from torchvision import transforms

from .board_crop import (
    DEFAULT_BOARD_OUTPUT_SIZE,
    _center_square_crop,
    _corners_to_crop_rect,
    _detect_board_corners,
    _is_nearly_square,
    _load_image,
    _normalize_crop_rect,
    _warp_to_square,
    load_metadata,
)
from .class_map import class_names as DEFAULT_CLASS_NAMES
from .model import build_resnet18_classifier
from .piece_validation import BOARD_SIZE, Thresholds, validate_predictions
from .train import resolve_device


CELL_MARGIN = 0.12
CELL_PREVIEW_SIZE = 140
CELL_LABEL_BAR_HEIGHT = 42
MODEL_INPUT_SIZE = 224


@dataclass(frozen=True)
class LoadedModel:
    model: torch.nn.Module
    class_names: list[str]
    device: torch.device


def load_model(model_path: Path, device: torch.device | None = None) -> LoadedModel:
    device = device or resolve_device()
    checkpoint = torch.load(model_path, map_location="cpu")
    class_names = list(checkpoint.get("class_names", DEFAULT_CLASS_NAMES))
    model = build_resnet18_classifier(num_classes=len(class_names), pretrained=False)
    state_dict = checkpoint.get("model_state_dict", checkpoint)
    model.load_state_dict(state_dict)
    model.to(device)
    model.eval()
    return LoadedModel(model=model, class_names=class_names, device=device)


def resolve_image_id(image_path: Path | None, image_id: str | None) -> str:
    if image_id:
        return image_id
    if image_path is None:
        raise ValueError("either image_id or image_path is required")
    return image_path.stem


def _image_size(image: np.ndarray) -> dict[str, int]:
    height, width = image.shape[:2]
    return {"width": int(width), "height": int(height)}


def _debug_paths(dataset_root: Path) -> dict[str, Path]:
    reports_dir = dataset_root / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    return {
        "inputOriginal": reports_dir / "debug_01_input_original.png",
        "cropRectOnOriginal": reports_dir / "debug_02_crop_rect_on_original.png",
        "croppedBoardRaw": reports_dir / "debug_03_cropped_board_raw.png",
        "croppedBoardWithGridRaw": reports_dir / "debug_04_cropped_board_with_9x9_grid_raw.png",
        "resizedBoard900": reports_dir / "debug_05_resized_board_900.png",
        "resizedBoard900WithGrid": reports_dir / "debug_06_resized_board_900_with_grid.png",
        "cellsMontage": reports_dir / "debug_07_cells_montage.png",
    }


def should_write_prediction_artifacts() -> bool:
    value = os.getenv("SHOGI_RECOGNITION_WRITE_ARTIFACTS", "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _draw_grid(image: np.ndarray, color: tuple[int, int, int] = (0, 200, 255), thickness: int = 1) -> np.ndarray:
    output = image.copy()
    height, width = output.shape[:2]
    for i in range(BOARD_SIZE + 1):
        x = min(max(int(round(width * i / BOARD_SIZE)), 0), width - 1)
        y = min(max(int(round(height * i / BOARD_SIZE)), 0), height - 1)
        cv2.line(output, (x, 0), (x, height - 1), color, thickness)
        cv2.line(output, (0, y), (width - 1, y), color, thickness)
    return output


def _write_debug_crop_images(
    dataset_root: Path,
    image: np.ndarray,
    crop_rect: dict[str, int],
    crop_raw: np.ndarray,
    board_resized: np.ndarray,
    write_artifacts: bool,
) -> dict[str, str]:
    if not write_artifacts:
        return {}

    paths = _debug_paths(dataset_root)
    if not cv2.imwrite(str(paths["inputOriginal"]), image):
        raise IOError(f"failed to write debug image: {paths['inputOriginal']}")

    annotated = image.copy()
    x = crop_rect["x"]
    y = crop_rect["y"]
    width = crop_rect["width"]
    height = crop_rect["height"]
    cv2.rectangle(annotated, (x, y), (x + width - 1, y + height - 1), (0, 0, 255), 2)
    if not cv2.imwrite(str(paths["cropRectOnOriginal"]), annotated):
        raise IOError(f"failed to write debug image: {paths['cropRectOnOriginal']}")
    if not cv2.imwrite(str(paths["croppedBoardRaw"]), crop_raw):
        raise IOError(f"failed to write debug image: {paths['croppedBoardRaw']}")

    crop_raw_grid = _draw_grid(crop_raw)
    if not cv2.imwrite(str(paths["croppedBoardWithGridRaw"]), crop_raw_grid):
        raise IOError(f"failed to write debug image: {paths['croppedBoardWithGridRaw']}")
    if not cv2.imwrite(str(paths["resizedBoard900"]), board_resized):
        raise IOError(f"failed to write debug image: {paths['resizedBoard900']}")

    resized_grid = _draw_grid(board_resized, color=(60, 180, 255), thickness=2)
    if not cv2.imwrite(str(paths["resizedBoard900WithGrid"]), resized_grid):
        raise IOError(f"failed to write debug image: {paths['resizedBoard900WithGrid']}")

    return {key: str(path) for key, path in paths.items() if key != "cellsMontage"}


def _center_square_crop_raw(image: np.ndarray) -> tuple[np.ndarray, dict[str, int]]:
    height, width = image.shape[:2]
    side = min(height, width)
    side = max(int(round(side * 0.88)), 1)
    x0 = max((width - side) // 2, 0)
    y0 = max((height - side) // 2, 0)
    crop = image[y0 : y0 + side, x0 : x0 + side]
    return crop, {"x": int(x0), "y": int(y0), "width": int(side), "height": int(side)}


def _metadata_source_image_size(dataset_root: Path, metadata_source_id: str | None) -> dict[str, int] | None:
    if not metadata_source_id:
        return None
    source_image_path = dataset_root / "raw" / f"{metadata_source_id}.png"
    if not source_image_path.exists():
        return None
    return _image_size(_load_image(source_image_path))


def _metadata_scale(
    input_size: dict[str, int],
    metadata_source_image_size: dict[str, int] | None,
) -> tuple[float, float] | None:
    if not metadata_source_image_size:
        return None

    source_width = metadata_source_image_size["width"]
    source_height = metadata_source_image_size["height"]
    if source_width <= 0 or source_height <= 0:
        return None

    scale_x = input_size["width"] / source_width
    scale_y = input_size["height"] / source_height
    if abs(scale_x - 1.0) < 0.001 and abs(scale_y - 1.0) < 0.001:
        return None

    return scale_x, scale_y


def _scale_crop_rect(crop_rect: dict[str, int], scale_x: float, scale_y: float) -> dict[str, int]:
    return {
        "x": int(round(crop_rect["x"] * scale_x)),
        "y": int(round(crop_rect["y"] * scale_y)),
        "width": int(round(crop_rect["width"] * scale_x)),
        "height": int(round(crop_rect["height"] * scale_y)),
    }


def _scale_board_corners(corners: np.ndarray, scale_x: float, scale_y: float) -> np.ndarray:
    scaled = corners.astype(np.float32).copy()
    scaled[:, 0] *= scale_x
    scaled[:, 1] *= scale_y
    return scaled


def _load_board_metadata(dataset_root: Path, image_id: str, fallback_source_id: str | None = None) -> tuple[Any | None, str | None]:
    if fallback_source_id:
        fallback_metadata_path = dataset_root / "metadata" / f"{fallback_source_id}.json"
        if not fallback_metadata_path.exists():
            raise FileNotFoundError(f"fallback metadata not found: {fallback_metadata_path}")
        fallback_metadata = load_metadata(fallback_metadata_path, fallback_source_id)
        if not fallback_metadata.cropRect:
            raise ValueError(f"fallback metadata does not contain cropRect: {fallback_metadata_path}")
        return fallback_metadata, fallback_source_id

    metadata_path = dataset_root / "metadata" / f"{image_id}.json"
    if metadata_path.exists():
        return load_metadata(metadata_path, image_id), image_id

    return None, None


def _cell_bounds(start: int, end: int, margin_ratio: float) -> tuple[int, int]:
    span = max(end - start, 1)
    inset = int(round(span * margin_ratio))
    left = min(max(start + inset, 0), end)
    right = max(min(end - inset, end), left + 1)
    return left, right


def _build_cell_rects(width: int, height: int, margin_ratio: float = CELL_MARGIN) -> list[dict[str, Any]]:
    rects: list[dict[str, Any]] = []
    for row_index in range(BOARD_SIZE):
        y0 = int(round(height * row_index / BOARD_SIZE))
        y1 = int(round(height * (row_index + 1) / BOARD_SIZE))
        inner_y0, inner_y1 = _cell_bounds(y0, y1, margin_ratio)

        for col_index in range(BOARD_SIZE):
            x0 = int(round(width * col_index / BOARD_SIZE))
            x1 = int(round(width * (col_index + 1) / BOARD_SIZE))
            inner_x0, inner_x1 = _cell_bounds(x0, x1, margin_ratio)
            rects.append(
                {
                    "index": row_index * BOARD_SIZE + col_index,
                    "row": row_index,
                    "col": col_index,
                    "file": 9 - col_index,
                    "rank": row_index + 1,
                    "x": x0,
                    "y": y0,
                    "w": x1 - x0,
                    "h": y1 - y0,
                    "innerX": inner_x0,
                    "innerY": inner_y0,
                    "innerW": inner_x1 - inner_x0,
                    "innerH": inner_y1 - inner_y0,
                }
            )
    return rects


def _crop_debug_payload(
    image_path: Path,
    input_size: dict[str, int],
    metadata_source_id: str | None,
    method: str,
    crop_rect: dict[str, int] | None,
    cropped_size: dict[str, int],
    resized_size: dict[str, int],
    metadata_source_image_size: dict[str, int] | None,
) -> dict[str, Any]:
    raw_width = cropped_size["width"]
    raw_height = cropped_size["height"]
    resized_width = resized_size["width"]
    resized_height = resized_size["height"]
    return {
        "inputImagePath": str(image_path),
        "inputSize": input_size,
        "metadataSource": metadata_source_id,
        "metadataSourceImageSize": metadata_source_image_size,
        "cropInfo": {
            "method": method,
            "cropRect": crop_rect,
        },
        "croppedSize": cropped_size,
        "resizedSize": resized_size,
        "rawGridCellWidth": raw_width / BOARD_SIZE,
        "rawGridCellHeight": raw_height / BOARD_SIZE,
        "resizedGridCellWidth": resized_width / BOARD_SIZE,
        "resizedGridCellHeight": resized_height / BOARD_SIZE,
        "modelInputCellSize": {"width": MODEL_INPUT_SIZE, "height": MODEL_INPUT_SIZE},
        "cellRectsRaw": _build_cell_rects(raw_width, raw_height, CELL_MARGIN),
        "cellRectsResized": _build_cell_rects(resized_width, resized_height, CELL_MARGIN),
    }


def _build_crop_result(
    *,
    method: str,
    metadata_source_id: str | None,
    metadata_source_image_size: dict[str, int] | None,
    crop_rect: dict[str, int],
    input_size: dict[str, int],
    cropped_size: dict[str, int],
    resized_size: dict[str, int],
    debug_images: dict[str, str],
    debug_log: dict[str, Any],
    write_artifacts: bool,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "method": method,
        "metadataSource": metadata_source_id,
        "metadataSourceImageSize": metadata_source_image_size,
        "cropRect": crop_rect,
        "inputSize": input_size,
        "croppedSize": cropped_size,
        "resizedSize": resized_size,
        "gridImageSize": resized_size,
        "debugImages": debug_images if write_artifacts else {},
        "debugLog": debug_log if write_artifacts else {},
    }
    if write_artifacts:
        result.update(
            {
                "rawGridCellWidth": debug_log["rawGridCellWidth"],
                "rawGridCellHeight": debug_log["rawGridCellHeight"],
                "resizedGridCellWidth": debug_log["resizedGridCellWidth"],
                "resizedGridCellHeight": debug_log["resizedGridCellHeight"],
                "modelInputCellSize": debug_log["modelInputCellSize"],
                "cellRectsRaw": debug_log["cellRectsRaw"],
                "cellRectsResized": debug_log["cellRectsResized"],
            }
        )
    return result


def crop_board_image(
    dataset_root: Path,
    image_path: Path,
    image_id: str,
    fallback_source_id: str | None = None,
    write_artifacts: bool = False,
) -> tuple[np.ndarray, dict[str, Any], str | None]:
    metadata, metadata_source_id = _load_board_metadata(dataset_root, image_id, fallback_source_id=fallback_source_id)
    image = _load_image(image_path)
    input_size = _image_size(image)
    metadata_image_size = _metadata_source_image_size(dataset_root, metadata_source_id)
    metadata_scale = _metadata_scale(input_size, metadata_image_size)

    if metadata and metadata.boardCorners:
        corners = np.array(metadata.boardCorners, dtype=np.float32)
        if corners.shape != (4, 2):
            raise ValueError("boardCorners must contain 4 points")
        if metadata_scale:
            corners = _scale_board_corners(corners, *metadata_scale)
        board = _warp_to_square(image, corners, output_size=DEFAULT_BOARD_OUTPUT_SIZE)
        equivalent = _corners_to_crop_rect(corners)
        x = max(equivalent["x"], 0)
        y = max(equivalent["y"], 0)
        width = min(equivalent["width"], image.shape[1] - x)
        height = min(equivalent["height"], image.shape[0] - y)
        raw_crop = image[y : y + height, x : x + width]
        crop_rect = {"x": x, "y": y, "width": width, "height": height}
        debug_log = _crop_debug_payload(
            image_path=image_path,
            input_size=input_size,
            metadata_source_id=metadata_source_id,
            method="boardCorners",
            crop_rect=crop_rect,
            cropped_size=_image_size(raw_crop),
            resized_size=_image_size(board),
            metadata_source_image_size=metadata_image_size,
        )
        return (
            board,
            _build_crop_result(
                method="boardCorners",
                metadata_source_id=metadata_source_id,
                metadata_source_image_size=metadata_image_size,
                crop_rect=crop_rect,
                input_size=input_size,
                cropped_size=_image_size(raw_crop),
                resized_size=_image_size(board),
                debug_images=_write_debug_crop_images(dataset_root, image, crop_rect, raw_crop, board, write_artifacts),
                debug_log=debug_log,
                write_artifacts=write_artifacts,
            ),
            metadata_source_id,
        )

    if metadata and metadata.cropRect:
        normalized = _normalize_crop_rect(metadata.cropRect)
        if metadata_scale:
            normalized = _scale_crop_rect(normalized, *metadata_scale)
        x = max(int(normalized["x"]), 0)
        y = max(int(normalized["y"]), 0)
        width = int(normalized["width"])
        height = int(normalized["height"])
        if width <= 0 or height <= 0:
            raise ValueError("cropRect must have positive width and height")
        crop = image[y : y + height, x : x + width]
        if crop.size == 0:
            raise ValueError("cropRect produced an empty crop")
        crop_rect = {"x": x, "y": y, "width": width, "height": height}
        board = cv2.resize(crop, (DEFAULT_BOARD_OUTPUT_SIZE, DEFAULT_BOARD_OUTPUT_SIZE), interpolation=cv2.INTER_CUBIC)
        debug_log = _crop_debug_payload(
            image_path=image_path,
            input_size=input_size,
            metadata_source_id=metadata_source_id,
            method="cropRect",
            crop_rect=crop_rect,
            cropped_size=_image_size(crop),
            resized_size=_image_size(board),
            metadata_source_image_size=metadata_image_size,
        )
        return (
            board,
            _build_crop_result(
                method="cropRect",
                metadata_source_id=metadata_source_id,
                metadata_source_image_size=metadata_image_size,
                crop_rect=crop_rect,
                input_size=input_size,
                cropped_size=_image_size(crop),
                resized_size=_image_size(board),
                debug_images=_write_debug_crop_images(dataset_root, image, crop_rect, crop, board, write_artifacts),
                debug_log=debug_log,
                write_artifacts=write_artifacts,
            ),
            metadata_source_id,
        )

    corners = _detect_board_corners(image)
    if corners is not None:
        equivalent = _corners_to_crop_rect(corners)
        if _is_nearly_square(equivalent["width"], equivalent["height"]):
            board = _warp_to_square(image, corners, output_size=DEFAULT_BOARD_OUTPUT_SIZE)
            x = max(equivalent["x"], 0)
            y = max(equivalent["y"], 0)
            width = min(equivalent["width"], image.shape[1] - x)
            height = min(equivalent["height"], image.shape[0] - y)
            raw_crop = image[y : y + height, x : x + width]
            crop_rect = {"x": x, "y": y, "width": width, "height": height}
            debug_log = _crop_debug_payload(
                image_path=image_path,
                input_size=input_size,
                metadata_source_id=metadata_source_id,
                method="autoDetectedCorners",
                crop_rect=crop_rect,
                cropped_size=_image_size(raw_crop),
                resized_size=_image_size(board),
                metadata_source_image_size=metadata_image_size,
            )
            return (
                board,
                _build_crop_result(
                    method="autoDetectedCorners",
                    metadata_source_id=metadata_source_id,
                    metadata_source_image_size=metadata_image_size,
                    crop_rect=crop_rect,
                    input_size=input_size,
                    cropped_size=_image_size(raw_crop),
                    resized_size=_image_size(board),
                    debug_images=_write_debug_crop_images(dataset_root, image, crop_rect, raw_crop, board, write_artifacts),
                    debug_log=debug_log,
                    write_artifacts=write_artifacts,
                ),
                metadata_source_id,
            )

    crop, crop_rect = _center_square_crop_raw(image)
    board = cv2.resize(crop, (DEFAULT_BOARD_OUTPUT_SIZE, DEFAULT_BOARD_OUTPUT_SIZE), interpolation=cv2.INTER_CUBIC)
    debug_log = _crop_debug_payload(
        image_path=image_path,
        input_size=input_size,
        metadata_source_id=metadata_source_id,
        method="centerSquare",
        crop_rect=crop_rect,
        cropped_size=_image_size(crop),
        resized_size=_image_size(board),
        metadata_source_image_size=metadata_image_size,
    )
    return (
        board,
        _build_crop_result(
            method="centerSquare",
            metadata_source_id=metadata_source_id,
            metadata_source_image_size=metadata_image_size,
            crop_rect=crop_rect,
            input_size=input_size,
            cropped_size=_image_size(crop),
            resized_size=_image_size(board),
            debug_images=_write_debug_crop_images(dataset_root, image, crop_rect, crop, board, write_artifacts),
            debug_log=debug_log,
            write_artifacts=write_artifacts,
        ),
        metadata_source_id,
    )


def split_board_cells(board_image: np.ndarray, margin_ratio: float = CELL_MARGIN) -> list[dict[str, Any]]:
    height, width = board_image.shape[:2]
    rows: list[dict[str, Any]] = []

    for rect in _build_cell_rects(width, height, margin_ratio):
        inner_x0 = rect["innerX"]
        inner_y0 = rect["innerY"]
        inner_x1 = inner_x0 + rect["innerW"]
        inner_y1 = inner_y0 + rect["innerH"]
        cell = board_image[inner_y0:inner_y1, inner_x0:inner_x1]
        if cell.size == 0:
            raise ValueError(f"empty cell crop at row {rect['rank']}, file {rect['file']}")

        rows.append({
            "index": rect["index"],
            "row": rect["row"],
            "col": rect["col"],
            "file": rect["file"],
            "rank": rect["rank"],
            "rect": {
                "x": rect["x"],
                "y": rect["y"],
                "w": rect["w"],
                "h": rect["h"],
            },
            "innerRect": {
                "x": rect["innerX"],
                "y": rect["innerY"],
                "w": rect["innerW"],
                "h": rect["innerH"],
            },
            "image": cell,
        })

    return rows


def predict_cells(
    model: torch.nn.Module,
    class_names: list[str],
    board_cells: list[dict[str, Any]],
    device: torch.device,
) -> list[dict[str, Any]]:
    transform = transforms.Compose(
        [
            transforms.Resize((MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )

    batch: list[torch.Tensor] = []
    for cell in board_cells:
        rgb = cv2.cvtColor(cell["image"], cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(rgb)
        batch.append(transform(pil_image))

    input_tensor = torch.stack(batch, dim=0).to(device)
    with torch.no_grad():
        logits = model(input_tensor)
        probabilities = torch.softmax(logits, dim=1)
        top_confidences, top_indices = torch.topk(probabilities, k=2, dim=1)

    predictions: list[dict[str, Any]] = []
    for index, cell in enumerate(board_cells):
        top1_idx = int(top_indices[index, 0].item())
        top2_idx = int(top_indices[index, 1].item())
        top1_conf = float(top_confidences[index, 0].item())
        top2_conf = float(top_confidences[index, 1].item())
        top1_label = class_names[top1_idx]
        top2_label = class_names[top2_idx]

        predictions.append(
            {
                "index": cell["index"],
                "row": cell["row"],
                "col": cell["col"],
                "file": cell["file"],
                "rank": cell["rank"],
                "rect": cell["rect"],
                "innerRect": cell["innerRect"],
                "piece": top1_label,
                "confidence": top1_conf,
                "topCandidates": [
                    {"piece": top1_label, "confidence": top1_conf},
                    {"piece": top2_label, "confidence": top2_conf},
                ],
            }
        )

    return predictions


def run_prediction(
    dataset_root: Path,
    image_id: str,
    image_path: Path,
    model_path: Path,
    fallback_source_id: str | None = None,
    thresholds: Thresholds | None = None,
    write_artifacts: bool = False,
) -> dict[str, Any]:
    loaded_model = load_model(model_path)
    board_image, crop_info, metadata_source_id = crop_board_image(
        dataset_root,
        image_path,
        image_id,
        fallback_source_id=fallback_source_id,
        write_artifacts=write_artifacts,
    )

    board_crop_path = dataset_root / "board_crops" / f"{image_id}_board.png"
    if write_artifacts:
        board_crop_path.parent.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(str(board_crop_path), board_image):
            raise IOError(f"failed to write board crop: {board_crop_path}")

    board_cells = split_board_cells(board_image)
    predictions = predict_cells(loaded_model.model, loaded_model.class_names, board_cells, loaded_model.device)
    validated = validate_predictions(predictions, thresholds=thresholds)

    return {
        **validated,
        "imageId": image_id,
        "imagePath": str(image_path),
        "modelPath": str(model_path),
        "boardCropPath": str(board_crop_path) if write_artifacts else None,
        "cropInfo": crop_info,
        "inputSize": crop_info.get("inputSize"),
        "croppedSize": crop_info.get("croppedSize"),
        "resizedSize": crop_info.get("resizedSize"),
        "gridImageSize": crop_info.get("gridImageSize"),
        "debugImages": crop_info.get("debugImages", {}),
        "debugLog": crop_info.get("debugLog", {}),
        "metadataSourceId": metadata_source_id,
    }


def _tile_cell(cell: np.ndarray, tile_size: int = CELL_PREVIEW_SIZE) -> np.ndarray:
    height, width = cell.shape[:2]
    scale = min((tile_size - 10) / max(width, 1), (tile_size - 10) / max(height, 1))
    new_width = max(1, int(round(width * scale)))
    new_height = max(1, int(round(height * scale)))
    resized = cv2.resize(cell, (new_width, new_height), interpolation=cv2.INTER_AREA)
    canvas = np.full((tile_size, tile_size, 3), 246, dtype=np.uint8)
    x0 = (tile_size - new_width) // 2
    y0 = (tile_size - new_height) // 2
    canvas[y0 : y0 + new_height, x0 : x0 + new_width] = resized
    return canvas


def _draw_text(image: np.ndarray, text: str, origin: tuple[int, int], color: tuple[int, int, int], scale: float = 0.42) -> None:
    cv2.putText(image, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), 3, cv2.LINE_AA)
    cv2.putText(image, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, color, 1, cv2.LINE_AA)


def render_board_grid(board_image: np.ndarray, squares: list[dict[str, Any]], output_size: int = DEFAULT_BOARD_OUTPUT_SIZE) -> np.ndarray:
    canvas = cv2.resize(board_image, (output_size, output_size), interpolation=cv2.INTER_CUBIC)
    step = output_size // BOARD_SIZE

    for i in range(BOARD_SIZE + 1):
        pos = i * step
        cv2.line(canvas, (pos, 0), (pos, output_size - 1), (60, 180, 255), 2)
        cv2.line(canvas, (0, pos), (output_size - 1, pos), (60, 180, 255), 2)

    by_square = {(square["file"], square["rank"]): square for square in squares}
    for row in range(BOARD_SIZE):
        for col in range(BOARD_SIZE):
            file_num = 9 - col
            rank_num = row + 1
            square = by_square[(file_num, rank_num)]
            label = square["piece"]
            confidence = square["confidence"]
            status = square["status"]
            x = col * step + 8
            y = row * step + 20
            color = (40, 150, 40) if status == "confirmed" else (40, 110, 210) if status == "uncertain" else (30, 30, 30)
            if status == "moved_to_box":
                color = (160, 90, 30)
            _draw_text(canvas, f"{label} {confidence:.2f}", (x, y), color=color, scale=0.38)

    return canvas


def render_cells_preview(board_cells: list[dict[str, Any]], squares: list[dict[str, Any]]) -> np.ndarray:
    tile_width = CELL_PREVIEW_SIZE
    tile_height = CELL_PREVIEW_SIZE + CELL_LABEL_BAR_HEIGHT
    canvas = np.full((BOARD_SIZE * tile_height, BOARD_SIZE * tile_width, 3), 250, dtype=np.uint8)

    square_lookup = {(square["file"], square["rank"]): square for square in squares}
    for cell in board_cells:
        square = square_lookup[(cell["file"], cell["rank"])]
        tile = _tile_cell(cell["image"], CELL_PREVIEW_SIZE)
        row_index = cell["rank"] - 1
        col_index = 9 - cell["file"]
        y0 = row_index * tile_height
        x0 = col_index * tile_width
        canvas[y0 : y0 + CELL_PREVIEW_SIZE, x0 : x0 + CELL_PREVIEW_SIZE] = tile

        bar = canvas[y0 + CELL_PREVIEW_SIZE : y0 + tile_height, x0 : x0 + CELL_PREVIEW_SIZE]
        bar[:] = (235, 235, 235)
        _draw_text(bar, f"#{cell['index']:02d} f{cell['file']} r{cell['rank']}", (6, 16), color=(20, 20, 20), scale=0.34)
        _draw_text(bar, f"{square['piece']} {square['confidence']:.2f}", (6, 34), color=(0, 90, 180), scale=0.40)
        cv2.rectangle(canvas, (x0, y0), (x0 + CELL_PREVIEW_SIZE - 1, y0 + tile_height - 1), (200, 200, 200), 1)

    return canvas
