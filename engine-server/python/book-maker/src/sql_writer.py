from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _array_literal(values: Any) -> str:
    if not isinstance(values, list):
        values = []
    items = [str(item) for item in values if isinstance(item, str)]
    if not items:
        return "'{}'::text[]"
    return "array[" + ",".join(_sql_literal(item) for item in items) + "]::text[]"


def _nullable_number(value: Any) -> str:
    return str(value) if isinstance(value, (int, float)) else "null"


def _source_ref(name: str) -> str:
    return f"book-maker:{name}"


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


def _problem_insert_sql(record: dict[str, Any], problem_table_name: str, choice_table_name: str) -> str:
    name = str(record["name"])
    draft = record.get("draft")
    if not isinstance(draft, dict):
        draft = {}

    source_ref = _source_ref(name)
    draft_payload = {key: value for key, value in draft.items() if key != "choices"}
    source_payload = {"workspace_name": name, "draft_payload": draft_payload}
    source_snapshot = {"source": "book-maker", "name": name}

    choices = draft.get("choices")
    if not isinstance(choices, dict):
        choices = {}

    choice_values: list[str] = []
    for choice_id, slot in enumerate(("correct", "incorrect1", "incorrect2"), start=1):
        choice = choices.get(slot)
        if not isinstance(choice, dict):
            choice = {}
        choice_snapshot = {"source": "book-maker", "slot": slot, "name": name}
        choice_values.append(
            "("
            "draft_id,"
            f"{choice_id},"
            f"{_sql_literal(str(choice.get('usi') or ''))},"
            f"{_sql_literal(str(choice.get('label') or ''))},"
            f"{_nullable_number(choice.get('eval_cp'))},"
            f"{_nullable_number(choice.get('eval_percent'))},"
            f"{_array_literal(choice.get('line'))},"
            f"{_sql_literal(str(choice.get('explanation') or ''))},"
            f"$json${_json_text(choice_snapshot)}$json$::jsonb"
            ")"
        )
    choice_values_sql = ",\n    ".join(choice_values)

    return f"""do $$
declare
  draft_id bigint;
begin
  insert into {problem_table_name} (
    workspace_id,
    mode,
    status,
    prompt,
    root_sfen,
    intro_moves_usi,
    correct_choice_id,
    root_eval_cp,
    root_eval_percent,
    problem_rating,
    problem_rating_games,
    manual_difficulty_tier,
    display_no,
    tags,
    review_comment,
    source_type,
    source_ref,
    source_payload,
    source_snapshot
  )
  values (
    null,
    'next_move',
    'draft',
    {_sql_literal(str(draft.get('prompt') or ''))},
    {_sql_literal(str(draft.get('rootSfen') or ''))},
    {_array_literal(draft.get('introMovesUsi'))},
    1,
    {_nullable_number(draft.get('rootEvalCp'))},
    {_nullable_number(draft.get('rootEvalPercent'))},
    {_nullable_number(draft.get('problemRating'))},
    0,
    null,
    {_nullable_number(draft.get('displayNo'))},
    {_array_literal(draft.get('tags'))},
    null,
    'local_book',
    {_sql_literal(source_ref)},
    $json${_json_text(source_payload)}$json$::jsonb,
    $json${_json_text(source_snapshot)}$json$::jsonb
  )
  on conflict (source_type, source_ref)
  where source_type is not null and source_ref is not null
  do update set
    prompt = excluded.prompt,
    root_sfen = excluded.root_sfen,
    intro_moves_usi = excluded.intro_moves_usi,
    root_eval_cp = excluded.root_eval_cp,
    root_eval_percent = excluded.root_eval_percent,
    problem_rating = excluded.problem_rating,
    display_no = excluded.display_no,
    tags = excluded.tags,
    source_payload = excluded.source_payload,
    source_snapshot = excluded.source_snapshot,
    updated_at = now()
  returning id into draft_id;

  delete from {choice_table_name}
  where draft_problem_id = draft_id;

  insert into {choice_table_name} (
    draft_problem_id,
    choice_id,
    usi,
    label,
    eval_cp,
    eval_percent,
    line,
    explanation,
    source_snapshot
  )
  values
    {choice_values_sql};
end $$;
"""


def _sql_text(
    records: list[dict[str, Any]],
    problem_table_name: str = "public.making_draft_problems",
    choice_table_name: str = "public.making_draft_choices",
) -> str:
    if not records:
        return "-- no records\n"
    return "\n".join(_problem_insert_sql(record, problem_table_name, choice_table_name) for record in records) + "\n"


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


def write_sql(
    records: list[dict[str, Any]],
    output_path: str | Path,
    problem_table_name: str = "public.making_draft_problems",
    choice_table_name: str = "public.making_draft_choices",
) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        _sql_text(records, problem_table_name=problem_table_name, choice_table_name=choice_table_name),
        encoding="utf-8",
    )


def append_sql(
    records: list[dict[str, Any]],
    output_path: str | Path,
    problem_table_name: str = "public.making_draft_problems",
    choice_table_name: str = "public.making_draft_choices",
) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="") as handle:
        handle.write(_sql_text(records, problem_table_name=problem_table_name, choice_table_name=choice_table_name))
