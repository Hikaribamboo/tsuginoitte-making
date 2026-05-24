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
    table_name: str


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
        table_name = os.getenv("SUPABASE_TABLE", "workspaces").strip() or "workspaces"
        if not url:
            raise RuntimeError("SUPABASE_URL is required for --insert")
        if not service_role_key:
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for --insert")
        return cls(SupabaseConfig(url=url, service_role_key=service_role_key, table_name=table_name))

    def name_exists(self, name: str) -> bool:
        response = self._client.table(self._config.table_name).select("id").eq("name", name).limit(1).execute()
        data = getattr(response, "data", None) or []
        return len(data) > 0

    def insert_rows(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        response = self._client.table(self._config.table_name).insert(rows).execute()
        data = getattr(response, "data", None) or []
        return len(data)
