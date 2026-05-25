from __future__ import annotations

from collections import defaultdict

import torch


def resolve_device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def train_one_epoch(model, loader, optimizer, criterion, device: torch.device) -> tuple[float, float]:
    model.train()
    total_loss = 0.0
    total_correct = 0
    total_count = 0

    for images, labels, _indices in loader:
        images = images.to(device)
        labels = labels.to(device)

        optimizer.zero_grad(set_to_none=True)
        logits = model(images)
        loss = criterion(logits, labels)
        loss.backward()
        optimizer.step()

        batch_size = labels.size(0)
        total_loss += loss.item() * batch_size
        total_correct += (logits.argmax(dim=1) == labels).sum().item()
        total_count += batch_size

    avg_loss = total_loss / max(total_count, 1)
    avg_acc = total_correct / max(total_count, 1)
    return avg_loss, avg_acc


@torch.no_grad()
def evaluate(model, loader, criterion, device: torch.device) -> tuple[float, float]:
    model.eval()
    total_loss = 0.0
    total_correct = 0
    total_count = 0

    for images, labels, _indices in loader:
        images = images.to(device)
        labels = labels.to(device)
        logits = model(images)
        loss = criterion(logits, labels)

        batch_size = labels.size(0)
        total_loss += loss.item() * batch_size
        total_correct += (logits.argmax(dim=1) == labels).sum().item()
        total_count += batch_size

    avg_loss = total_loss / max(total_count, 1)
    avg_acc = total_correct / max(total_count, 1)
    return avg_loss, avg_acc


@torch.no_grad()
def evaluate_with_predictions(model, loader, dataset, idx_to_class: dict[int, str], device: torch.device):
    model.eval()
    predictions: list[dict] = []
    class_totals = defaultdict(int)
    class_correct = defaultdict(int)

    for images, labels, indices in loader:
        images = images.to(device)
        labels = labels.to(device)
        logits = model(images)
        probs = torch.softmax(logits, dim=1)
        confidence, pred_indices = probs.max(dim=1)

        for i in range(labels.size(0)):
            sample = dataset.samples[int(indices[i])]
            true_idx = int(labels[i].item())
            pred_idx = int(pred_indices[i].item())
            conf = float(confidence[i].item())

            true_label = idx_to_class[true_idx]
            pred_label = idx_to_class[pred_idx]

            class_totals[true_label] += 1
            if true_idx == pred_idx:
                class_correct[true_label] += 1

            predictions.append(
                {
                    "image_id": sample.image_id,
                    "rank": sample.rank,
                    "file": sample.file,
                    "true_label": true_label,
                    "pred_label": pred_label,
                    "confidence": conf,
                    "cell_path": str(sample.cell_path),
                }
            )

    return predictions, class_totals, class_correct
