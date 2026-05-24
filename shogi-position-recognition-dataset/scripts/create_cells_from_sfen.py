from __future__ import annotations

import argparse
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from shogi_recognition.cell_dataset import create_cell_dataset  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create cell crops from a board crop and SFEN label")
    parser.add_argument("--id", required=True, help="image id without extension")
    parser.add_argument("--split", default="train", choices=["train", "val", "test"], help="dataset split")
    parser.add_argument("--inner-margin", type=float, default=0.12, help="cell inset ratio to avoid grid lines")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    records = create_cell_dataset(ROOT, args.id, split=args.split, inner_margin=args.inner_margin)
    print(f"generated {len(records)} cell images")


if __name__ == "__main__":
    main()
