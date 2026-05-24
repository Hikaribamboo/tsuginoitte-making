# Shogi Position Recognition Dataset

Utilities for turning raw shogi board images and SFEN labels into a cell-level dataset.

## Layout

- `raw/`: source images
- `labels/`: SFEN labels for each image
- `metadata/`: per-image crop and orientation metadata
- `board_crops/`: normalized board crops
- `cells/`: cell images grouped by split and class
- `manifests/`: CSV manifests
- `scripts/`: CLI entry points
- `src/shogi_recognition/`: reusable library code

## Quick start

```bash
cd shogi-position-recognition-dataset
python scripts/crop_board.py --id 001
python scripts/create_cells_from_sfen.py --id 001
```

## Notes

- Class order is fixed in `src/shogi_recognition/class_map.py`.
- The first PoC keeps all samples in `cells/train/`.
- `boardCorners` takes precedence over `cropRect`.
- If neither is set, the cropper tries to detect the board automatically and falls back to a centered square crop.
