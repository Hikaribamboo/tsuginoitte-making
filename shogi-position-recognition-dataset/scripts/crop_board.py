from __future__ import annotations

import argparse
from pathlib import Path
import sys
import json


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from shogi_recognition.board_crop import save_board_crop  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Crop a shogi board image from a raw screenshot")
    parser.add_argument("--id", required=True, help="image id without extension")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = save_board_crop(ROOT, args.id)
    print(result.output_path)
    print(json.dumps(
        {
            "method": result.method,
            "cropRect": result.crop_rect,
            "boardCorners": result.board_corners,
            "cropRectEquivalent": result.crop_rect_equivalent,
        },
        ensure_ascii=False,
        indent=2,
    ))


if __name__ == "__main__":
    main()
