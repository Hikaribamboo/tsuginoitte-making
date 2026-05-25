from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def main() -> None:
    val_predictions_path = ROOT / "reports" / "val_predictions.csv"
    class_accuracy_path = ROOT / "reports" / "class_accuracy.csv"

    predictions = read_csv(val_predictions_path)
    class_rows = read_csv(class_accuracy_path)

    misclassified = [row for row in predictions if row["true_label"] != row["pred_label"]]
    class_accuracy = []
    for row in class_rows:
        total = int(row["total"])
        correct = int(row["correct"])
        accuracy = float(row["accuracy"])
        class_accuracy.append({
            "label": row["label"],
            "total": total,
            "correct": correct,
            "accuracy": accuracy,
        })

    low_accuracy = [row for row in class_accuracy if row["total"] > 0 and row["accuracy"] < 0.999]
    low_sample = [row for row in class_accuracy if row["total"] <= 5]
    next_candidates = sorted(
        [row for row in class_accuracy if row["total"] == 0],
        key=lambda row: row["label"],
    )

    print(f"misclassified_count: {len(misclassified)}")
    for row in misclassified:
        print(
            f"MIS {row['image_id']} r{row['rank']} f{row['file']} true={row['true_label']} pred={row['pred_label']} conf={row['confidence']} {row['cell_path']}"
        )

    print("low_accuracy_classes:")
    for row in sorted(low_accuracy, key=lambda row: (row["accuracy"], row["total"])):
        print(f"  {row['label']}: total={row['total']} correct={row['correct']} accuracy={row['accuracy']:.6f}")

    print("low_sample_classes:")
    for row in sorted(low_sample, key=lambda row: (row["total"], row["label"])):
        print(f"  {row['label']}: total={row['total']} correct={row['correct']} accuracy={row['accuracy']:.6f}")

    next_piece_candidates = [
        row["label"] for row in next_candidates if row["label"] != "empty"
    ]
    print(f"next_piece_candidates: {next_piece_candidates[:10]}")

    summary_path = ROOT / "reports" / "training_analysis.json"
    summary_path.write_text(
        "{\n"
        f"  \"misclassified_count\": {len(misclassified)},\n"
        f"  \"low_accuracy_classes\": {len(low_accuracy)},\n"
        f"  \"low_sample_classes\": {len(low_sample)},\n"
        f"  \"next_piece_candidates\": {next_piece_candidates[:10]}\n"
        "}\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
