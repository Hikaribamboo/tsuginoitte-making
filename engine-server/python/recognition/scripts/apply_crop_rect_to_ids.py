from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Apply a source cropRect to multiple dataset image IDs")
    parser.add_argument("--limit", type=int, default=5, help="maximum number of target ids to process")
    parser.add_argument("--source-id", required=True, help="source image id whose cropRect will be copied")
    return parser.parse_args()


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_crop_rect(crop_rect: object) -> dict[str, int]:
    if not isinstance(crop_rect, dict):
        raise ValueError("cropRect must be an object")
    x = int(crop_rect.get("x", 0))
    y = int(crop_rect.get("y", 0))
    width = int(crop_rect.get("width", crop_rect.get("w", 0)))
    height = int(crop_rect.get("height", crop_rect.get("h", 0)))
    if width <= 0 or height <= 0:
        raise ValueError("cropRect must have positive width and height")
    return {"x": x, "y": y, "width": width, "height": height}


def format_metadata(image_id: str, crop_rect: dict[str, int], previous: dict[str, object]) -> dict[str, object]:
    next_data = {
        "id": image_id,
        "source": previous.get("source", "screenshot"),
        "theme": previous.get("theme", "default"),
        "orientation": previous.get("orientation", "normal"),
        "sideToMove": previous.get("sideToMove", "b"),
        "hasHands": previous.get("hasHands", False),
        "cropRect": crop_rect,
        "boardCorners": previous.get("boardCorners", None),
        "note": previous.get("note", ""),
    }
    return next_data


def write_metadata(path: Path, data: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def list_candidate_ids(root: Path, source_id: str) -> list[str]:
    raw_dir = root / "raw"
    labels_dir = root / "labels"
    candidates: list[str] = []
    for raw_path in sorted(raw_dir.glob("*.png")):
        image_id = raw_path.stem
        if image_id == source_id:
            continue
        if not (labels_dir / f"{image_id}.sfen").exists():
            continue
        candidates.append(image_id)
    return candidates


def run_command(command: list[str]) -> tuple[bool, str]:
    result = subprocess.run(command, cwd=ROOT, text=True)
    if result.returncode == 0:
        return True, ""
    return False, f"command failed with exit code {result.returncode}: {' '.join(command)}"


def main() -> None:
    args = parse_args()
    source_metadata_path = ROOT / "metadata" / f"{args.source_id}.json"
    source_metadata = load_json(source_metadata_path)
    source_crop_rect = source_metadata.get("cropRect")
    if source_crop_rect is None:
        raise ValueError(f"source metadata does not have cropRect: {source_metadata_path}")

    crop_rect = normalize_crop_rect(source_crop_rect)
    candidates = list_candidate_ids(ROOT, args.source_id)
    target_ids = candidates[: max(args.limit, 0)]

    print(json.dumps({"sourceId": args.source_id, "cropRect": crop_rect, "targets": target_ids}, ensure_ascii=False, indent=2))

    results: list[dict[str, object]] = []
    for image_id in target_ids:
        metadata_path = ROOT / "metadata" / f"{image_id}.json"
        existing = load_json(metadata_path)
        next_metadata = format_metadata(image_id, crop_rect, existing)
        note = str(next_metadata.get("note", ""))
        if args.source_id not in note:
            next_metadata["note"] = (note + " / " if note else "") + f"{args.source_id}と同じcropRectを適用"
        write_metadata(metadata_path, next_metadata)

        board_ok, board_error = run_command([sys.executable, str(ROOT / "scripts" / "crop_board.py"), "--id", image_id])
        cells_ok = False
        cells_error = ""
        preview_ok = False
        preview_error = ""

        if board_ok:
            cells_ok, cells_error = run_command([sys.executable, str(ROOT / "scripts" / "create_cells_from_sfen.py"), "--id", image_id])
        if board_ok and cells_ok:
            preview_ok, preview_error = run_command([sys.executable, str(ROOT / "scripts" / "preview_cells.py"), "--id", image_id])

        status = "success" if board_ok and cells_ok and preview_ok else "failed"
        error_message = board_error or cells_error or preview_error
        results.append(
            {
                "id": image_id,
                "status": status,
                "boardCrop": str(ROOT / "board_crops" / f"{image_id}_board.png"),
                "cellsPreview": str(ROOT / "reports" / f"{image_id}_cells_preview.png"),
                "boardGrid": str(ROOT / "reports" / f"{image_id}_board_grid.png"),
                "error": error_message,
            }
        )

        if not board_ok:
            print(f"[ERROR] {image_id}: {board_error}", file=sys.stderr)
            continue
        if not cells_ok:
            print(f"[ERROR] {image_id}: {cells_error}", file=sys.stderr)
            continue
        if not preview_ok:
            print(f"[ERROR] {image_id}: {preview_error}", file=sys.stderr)
            continue

    print(json.dumps({"results": results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
