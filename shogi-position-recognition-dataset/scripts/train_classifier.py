from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import random
import sys

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader
from torchvision import transforms


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from shogi_recognition.class_map import class_names, idx_to_class  # noqa: E402
from shogi_recognition.dataset import (  # noqa: E402
    ShogiCellDataset,
    filter_samples_by_image_ids,
    load_cell_samples,
    split_image_ids,
)
from shogi_recognition.model import build_resnet18_classifier  # noqa: E402
from shogi_recognition.train import (  # noqa: E402
    evaluate,
    evaluate_with_predictions,
    resolve_device,
    train_one_epoch,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a shogi piece classifier from generated cell crops")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--min-val-ids", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--manifest", default=str(ROOT / "manifests" / "cells.csv"), help="path to cells manifest CSV")
    return parser.parse_args()


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_predictions_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["image_id", "rank", "file", "true_label", "pred_label", "confidence", "cell_path"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def write_class_accuracy_csv(path: Path, totals: dict[str, int], correct: dict[str, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["label", "total", "correct", "accuracy"])
        for label in class_names:
            total = int(totals.get(label, 0))
            ok = int(correct.get(label, 0))
            acc = (ok / total) if total > 0 else 0.0
            writer.writerow([label, total, ok, f"{acc:.6f}"])


def main() -> None:
    args = parse_args()
    set_seed(args.seed)

    manifest_path = Path(args.manifest)
    if not manifest_path.is_absolute():
        manifest_path = ROOT / manifest_path
    samples = load_cell_samples(ROOT, manifest_path)
    if len(samples) == 0:
        raise RuntimeError("no training samples found in manifests/cells.csv")

    all_image_ids = sorted({sample.image_id for sample in samples})
    train_ids, val_ids = split_image_ids(
        all_image_ids,
        val_ratio=args.val_ratio,
        min_val_ids=args.min_val_ids,
        seed=args.seed,
    )

    train_samples = filter_samples_by_image_ids(samples, set(train_ids))
    val_samples = filter_samples_by_image_ids(samples, set(val_ids))
    if len(train_samples) == 0 or len(val_samples) == 0:
        raise RuntimeError("train/val split produced empty split")

    train_transform = transforms.Compose(
        [
            transforms.Resize((224, 224)),
            transforms.RandomRotation(5),
            transforms.ColorJitter(brightness=0.12, contrast=0.12, saturation=0.08),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )
    val_transform = transforms.Compose(
        [
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )

    train_dataset = ShogiCellDataset(train_samples, transform=train_transform)
    val_dataset = ShogiCellDataset(val_samples, transform=val_transform)

    train_loader = DataLoader(
        train_dataset,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        pin_memory=False,
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        pin_memory=False,
    )

    device = resolve_device()
    model = build_resnet18_classifier(num_classes=len(class_names), pretrained=True).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)

    epoch_logs: list[dict] = []
    best_val_acc = -1.0
    best_state = None

    for epoch in range(1, args.epochs + 1):
        train_loss, train_acc = train_one_epoch(model, train_loader, optimizer, criterion, device)
        val_loss, val_acc = evaluate(model, val_loader, criterion, device)
        epoch_log = {
            "epoch": epoch,
            "train_loss": train_loss,
            "train_acc": train_acc,
            "val_loss": val_loss,
            "val_acc": val_acc,
        }
        epoch_logs.append(epoch_log)
        print(
            f"epoch={epoch:02d} train_loss={train_loss:.4f} train_acc={train_acc:.4f} "
            f"val_loss={val_loss:.4f} val_acc={val_acc:.4f}"
        )

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_state = {k: v.detach().cpu() for k, v in model.state_dict().items()}

    if best_state is None:
        best_state = {k: v.detach().cpu() for k, v in model.state_dict().items()}

    model_path = ROOT / "models" / "resnet18_shogi_piece_classifier.pt"
    model_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model_state_dict": best_state,
            "class_names": class_names,
            "train_image_ids": train_ids,
            "val_image_ids": val_ids,
            "best_val_acc": best_val_acc,
            "input_size": [224, 224],
        },
        model_path,
    )

    model.load_state_dict(best_state)
    predictions, class_totals, class_correct = evaluate_with_predictions(
        model,
        val_loader,
        val_dataset,
        idx_to_class,
        device,
    )

    reports_dir = ROOT / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    train_log = {
        "epochs": epoch_logs,
        "class_count": len(class_names),
        "train_image_ids": train_ids,
        "val_image_ids": val_ids,
        "train_sample_count": len(train_samples),
        "val_sample_count": len(val_samples),
        "device": str(device),
        "model_path": str(model_path),
        "best_val_acc": best_val_acc,
    }
    write_json(reports_dir / "train_log.json", train_log)
    write_predictions_csv(reports_dir / "val_predictions.csv", predictions)
    write_class_accuracy_csv(reports_dir / "class_accuracy.csv", class_totals, class_correct)

    final_train_acc = epoch_logs[-1]["train_acc"]
    final_val_acc = epoch_logs[-1]["val_acc"]
    print(f"final_train_acc={final_train_acc:.4f}")
    print(f"final_val_acc={final_val_acc:.4f}")
    print(model_path)


if __name__ == "__main__":
    main()
