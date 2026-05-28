from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def load_env_file(env_path: str | Path = ".env") -> None:
    path = Path(env_path)
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


@dataclass(frozen=True)
class SupabaseConfig:
    url: str
    service_role_key: str
    draft_problem_table_name: str
    draft_choice_table_name: str


class SupabaseWriter:
    def __init__(self, config: SupabaseConfig) -> None:
        self._config = config
        try:
            from supabase import create_client
        except ImportError as exc:  # pragma: no cover - dependency issue
            raise RuntimeError("supabase package is required for --insert") from exc

        self._client = create_client(config.url, config.service_role_key)

    @classmethod
    def from_environment(cls) -> "SupabaseWriter":
        load_env_file()
        url = os.getenv("SUPABASE_URL", "").strip()
        service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        draft_problem_table_name = os.getenv("SUPABASE_DRAFT_PROBLEM_TABLE", "making_draft_problems").strip() or "making_draft_problems"
        draft_choice_table_name = os.getenv("SUPABASE_DRAFT_CHOICE_TABLE", "making_draft_choices").strip() or "making_draft_choices"
        if not url:
            raise RuntimeError("SUPABASE_URL is required for --insert")
        if not service_role_key:
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for --insert")
        return cls(SupabaseConfig(
            url=url,
            service_role_key=service_role_key,
            draft_problem_table_name=draft_problem_table_name,
            draft_choice_table_name=draft_choice_table_name,
        ))

    def name_exists(self, name: str) -> bool:
        response = (
            self._client
            .table(self._config.draft_problem_table_name)
            .select("id")
            .eq("source_type", "local_book")
            .eq("source_ref", self._source_ref(name))
            .limit(1)
            .execute()
        )
        data = getattr(response, "data", None) or []
        return len(data) > 0

    def insert_rows(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0

        problem_rows = [self._problem_row(row) for row in rows]
        problem_response = (
            self._client
            .table(self._config.draft_problem_table_name)
            .insert(problem_rows)
            .execute()
        )
        inserted_problems = getattr(problem_response, "data", None) or []
        source_ref_to_id = {
            str(row["source_ref"]): int(row["id"])
            for row in inserted_problems
            if row.get("id") is not None and row.get("source_ref") is not None
        }

        choice_rows: list[dict[str, Any]] = []
        for row in rows:
            name = str(row["name"])
            draft_problem_id = source_ref_to_id.get(self._source_ref(name))
            if draft_problem_id is None:
                continue
            choice_rows.extend(self._choice_rows(draft_problem_id, row))

        if choice_rows:
            self._client.table(self._config.draft_choice_table_name).insert(choice_rows).execute()

        return len(inserted_problems)

    @staticmethod
    def _source_ref(name: str) -> str:
        return f"book-maker:{name}"

    @staticmethod
    def _string_array(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item) for item in value if isinstance(item, str)]

    @staticmethod
    def _number_or_none(value: Any) -> int | float | None:
        return value if isinstance(value, (int, float)) else None

    def _problem_row(self, row: dict[str, Any]) -> dict[str, Any]:
        name = str(row["name"])
        draft = row.get("draft")
        if not isinstance(draft, dict):
            draft = {}

        return {
            "workspace_id": None,
            "mode": "next_move",
            "status": "draft",
            "prompt": str(draft.get("prompt") or ""),
            "root_sfen": str(draft.get("rootSfen") or ""),
            "intro_moves_usi": self._string_array(draft.get("introMovesUsi")),
            "correct_choice_id": 1,
            "root_eval_cp": self._number_or_none(draft.get("rootEvalCp")),
            "root_eval_percent": self._number_or_none(draft.get("rootEvalPercent")),
            "problem_rating": self._number_or_none(draft.get("problemRating")),
            "problem_rating_games": 0,
            "manual_difficulty_tier": None,
            "display_no": self._number_or_none(draft.get("displayNo")),
            "tags": self._string_array(draft.get("tags")),
            "review_comment": None,
            "source_type": "local_book",
            "source_ref": self._source_ref(name),
            "source_payload": {
                "workspace_name": name,
                "draft_payload": {
                    key: value
                    for key, value in draft.items()
                    if key != "choices"
                },
            },
            "source_snapshot": {
                "source": "book-maker",
                "name": name,
            },
        }

    def _choice_rows(self, draft_problem_id: int, row: dict[str, Any]) -> list[dict[str, Any]]:
        draft = row.get("draft")
        if not isinstance(draft, dict):
            draft = {}
        choices = draft.get("choices")
        if not isinstance(choices, dict):
            choices = {}

        result: list[dict[str, Any]] = []
        for choice_id, slot in enumerate(("correct", "incorrect1", "incorrect2"), start=1):
            choice = choices.get(slot)
            if not isinstance(choice, dict):
                choice = {}
            result.append({
                "draft_problem_id": draft_problem_id,
                "choice_id": choice_id,
                "usi": str(choice.get("usi") or ""),
                "label": str(choice.get("label") or ""),
                "eval_cp": self._number_or_none(choice.get("eval_cp")),
                "eval_percent": self._number_or_none(choice.get("eval_percent")),
                "line": self._string_array(choice.get("line")),
                "explanation": str(choice.get("explanation") or ""),
                "source_snapshot": {
                    "source": "book-maker",
                    "slot": slot,
                    "name": str(row["name"]),
                },
            })
        return result
