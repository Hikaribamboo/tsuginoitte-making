from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import cv2


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from shogi_recognition.inference import render_board_grid, render_cells_preview, run_prediction, split_board_cells  # noqa: E402
from shogi_recognition.piece_validation import LOW_CONFIDENCE_THRESHOLD, TOP2_MARGIN_THRESHOLD, Thresholds  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Predict a shogi SFEN from a raw board image")
    parser.add_argument("--id", help="image id without extension")
    parser.add_argument("--image", help="path to a raw image")
    parser.add_argument("--model", default=str(ROOT / "models" / "resnet18_shogi_piece_classifier.pt"), help="path to the trained model checkpoint")
    parser.add_argument("--fallback-source-id", default=None, help="metadata source id used when the image metadata is missing")
    parser.add_argument("--low-confidence-threshold", type=float, default=LOW_CONFIDENCE_THRESHOLD)
    parser.add_argument("--top2-margin-threshold", type=float, default=TOP2_MARGIN_THRESHOLD)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    image_path = Path(args.image) if args.image else ROOT / "raw" / f"{args.id}.png"
    image_id = args.id or image_path.stem
    model_path = Path(args.model)
    if not model_path.is_absolute():
        model_path = ROOT / model_path
    if not image_path.is_absolute():
        image_path = ROOT / image_path

    thresholds = Thresholds(
        low_confidence=args.low_confidence_threshold,
        top2_margin=args.top2_margin_threshold,
    )
    fallback_source_id = args.fallback_source_id
    if args.id and not args.image and fallback_source_id is None:
        fallback_source_id = "002"

    result = run_prediction(
        dataset_root=ROOT,
        image_id=image_id,
        image_path=image_path,
        model_path=model_path,
        fallback_source_id=fallback_source_id,
        thresholds=thresholds,
    )

    board_crop_path = Path(result["boardCropPath"])
    board_image = cv2.imread(str(board_crop_path))
    if board_image is None:
        raise FileNotFoundError(f"failed to read board crop: {board_crop_path}")

    board_grid = render_board_grid(board_image, result["squares"])
    board_cells = split_board_cells(board_image)
    cells_preview = render_cells_preview(board_cells, result["squares"])

    board_grid_path = ROOT / "reports" / f"{image_id}_prediction_board_grid.png"
    cells_preview_path = ROOT / "reports" / f"{image_id}_prediction_cells_preview.png"
    debug_board_grid_path = ROOT / "reports" / "debug_prediction_board_grid.png"
    debug_cells_montage_path = ROOT / "reports" / "debug_07_cells_montage.png"
    board_grid_path.parent.mkdir(parents=True, exist_ok=True)

    if not cv2.imwrite(str(board_grid_path), board_grid):
        raise IOError(f"failed to write report image: {board_grid_path}")
    if not cv2.imwrite(str(debug_board_grid_path), board_grid):
        raise IOError(f"failed to write report image: {debug_board_grid_path}")
    if not cv2.imwrite(str(cells_preview_path), cells_preview):
        raise IOError(f"failed to write report image: {cells_preview_path}")
    if not cv2.imwrite(str(debug_cells_montage_path), cells_preview):
        raise IOError(f"failed to write report image: {debug_cells_montage_path}")

    result["boardGridPath"] = str(board_grid_path)
    result["cellsPreviewPath"] = str(cells_preview_path)
    result["debugImages"] = {
        **result.get("debugImages", {}),
        "predictionBoardGrid": str(debug_board_grid_path),
        "cellsMontage": str(debug_cells_montage_path),
    }

    prediction_json_path = ROOT / "reports" / f"{image_id}_prediction.json"
    result["predictionJsonPath"] = str(prediction_json_path)
    prediction_json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
