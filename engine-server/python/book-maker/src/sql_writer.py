from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _tsv_fieldnames() -> list[str]:
    return [
        "name",
        "rootSfen",
        "rootTurn",
        "afterTurn",
        "positionIndex",
        "scannedPositionAttempt",
        "correctUsi",
        "correctLabel",
        "correctEvalCp",
        "correctRawScoreCp",
        "correctBlackEvalCp",
        "correctAnswererEvalCp",
        "correctBestmove",
        "correctScoreCp",
        "correctDepth",
        "incorrect1Usi",
        "incorrect1Label",
        "incorrect1EvalCp",
        "incorrect1RawScoreCp",
        "incorrect1BlackEvalCp",
        "incorrect1AnswererEvalCp",
        "incorrect1Bestmove",
        "incorrect1ScoreCp",
        "incorrect1Depth",
        "incorrect2Usi",
        "incorrect2Label",
        "incorrect2EvalCp",
        "incorrect2RawScoreCp",
        "incorrect2BlackEvalCp",
        "incorrect2AnswererEvalCp",
        "incorrect2Bestmove",
        "incorrect2ScoreCp",
        "incorrect2Depth",
        "problemRating",
        "diff",
        "incorrectSelectionMode",
        "incorrectCandidateCount",
        "correctLine",
        "incorrect1Line",
        "incorrect2Line",
        "correctLineLength",
        "incorrect1LineLength",
        "incorrect2LineLength",
        "bookType",
        "incorrectSource",
        "correctSource",
        "correctCount",
        "minDiff",
        "maxDiff",
        "analyzedLegalCandidates",
        "qhapaqSkipReason",
    ]


def _sql_text(records: list[dict[str, Any]], table_name: str = "public.workspaces") -> str:
    lines = [f"insert into {table_name} (id, name, draft)", "values"]
    values_lines: list[str] = []
    for record in records:
        draft_text = _json_text(record["draft"])
        name_literal = "'" + str(record["name"]).replace("'", "''") + "'"
        values_lines.append(
            f"  (gen_random_uuid(), {name_literal}, $json${draft_text}$json$::jsonb)"
        )
    if values_lines:
        lines.append(",\n".join(values_lines) + ";")
    else:
        lines.append("  ;")
    return "\n".join(lines) + "\n"


def write_json(records: list[dict[str, Any]], output_path: str | Path) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")


def append_jsonl(records: list[dict[str, Any]], output_path: str | Path) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def write_tsv(records: list[dict[str, Any]], output_path: str | Path) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=_tsv_fieldnames(), delimiter="\t", extrasaction="ignore")
        writer.writeheader()
        for record in records:
            writer.writerow(record)


def write_tsv_with_fieldnames(
    records: list[dict[str, Any]],
    output_path: str | Path,
    fieldnames: list[str],
) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, delimiter="\t", extrasaction="ignore")
        writer.writeheader()
        for record in records:
            writer.writerow(record)


def append_tsv(records: list[dict[str, Any]], output_path: str | Path) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_header = not path.exists() or path.stat().st_size == 0
    with path.open("a", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=_tsv_fieldnames(), delimiter="\t", extrasaction="ignore")
        if write_header:
            writer.writeheader()
        for record in records:
            writer.writerow(record)


def write_sql(records: list[dict[str, Any]], output_path: str | Path, table_name: str = "public.workspaces") -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_sql_text(records, table_name=table_name), encoding="utf-8")


def append_sql(records: list[dict[str, Any]], output_path: str | Path, table_name: str = "public.workspaces") -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="") as handle:
        handle.write(_sql_text(records, table_name=table_name))
