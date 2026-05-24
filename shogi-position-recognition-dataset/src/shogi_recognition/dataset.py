from __future__ import annotations

from dataclasses import dataclass
import csv
import random
from pathlib import Path

from PIL import Image
import torch
from torch.utils.data import Dataset

from .class_map import class_to_idx


@dataclass(frozen=True)
class CellSample:
    image_id: str
    rank: int
    file: int
    label: str
    label_idx: int
    cell_path: Path


def load_cell_samples(dataset_root: Path, manifest_path: Path) -> list[CellSample]:
    if not manifest_path.exists():
        raise FileNotFoundError(f"manifest not found: {manifest_path}")

    samples: list[CellSample] = []
    with manifest_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            label = row["label"]
            if label not in class_to_idx:
                continue

            cell_path = dataset_root / row["cell_path"]
            if not cell_path.exists():
                continue

            sample = CellSample(
                image_id=row["image_id"],
                rank=int(row["rank"]),
                file=int(row["file"]),
                label=label,
                label_idx=class_to_idx[label],
                cell_path=cell_path,
            )
            samples.append(sample)
    return samples


def split_image_ids(
    image_ids: list[str],
    val_ratio: float = 0.2,
    min_val_ids: int = 3,
    seed: int = 42,
) -> tuple[list[str], list[str]]:
    unique_ids = sorted(set(image_ids))
    if len(unique_ids) < 2:
        raise ValueError("at least 2 image_ids are required for train/val split")

    rng = random.Random(seed)
    shuffled = unique_ids[:]
    rng.shuffle(shuffled)

    val_count = max(min_val_ids, int(round(len(shuffled) * val_ratio)))
    val_count = min(max(1, val_count), len(shuffled) - 1)
    val_ids = sorted(shuffled[:val_count])
    train_ids = sorted(shuffled[val_count:])
    return train_ids, val_ids


def filter_samples_by_image_ids(samples: list[CellSample], image_ids: set[str]) -> list[CellSample]:
    return [sample for sample in samples if sample.image_id in image_ids]


class ShogiCellDataset(Dataset):
    def __init__(self, samples: list[CellSample], transform=None):
        self.samples = samples
        self.transform = transform

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int):
        sample = self.samples[index]
        image = Image.open(sample.cell_path).convert("RGB")
        if self.transform is not None:
            image = self.transform(image)
        label = torch.tensor(sample.label_idx, dtype=torch.long)
        return image, label, index
