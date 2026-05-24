from __future__ import annotations

import codecs
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional


@dataclass(frozen=True)
class BookCandidate:
    usi: str
    ponder: str
    eval_cp: int
    depth: int
    count: int


@dataclass(frozen=True)
class BookPosition:
    root_sfen: str
    candidates: list[BookCandidate]
    position_index: int


@dataclass(frozen=True)
class BookIndexEntry:
    position_index: int
    byte_offset: int


def _decode_book_line(raw_line: bytes, byte_offset: int) -> str:
    if byte_offset == 0 and raw_line.startswith(codecs.BOM_UTF8):
        raw_line = raw_line[len(codecs.BOM_UTF8) :]
    return raw_line.decode("utf-8", errors="replace")


def iter_book_positions(book_path: str | Path, limit_scan: Optional[int] = None, start_index: int = 0) -> Iterator[BookPosition]:
    path = Path(book_path)
    current_root_sfen: Optional[str] = None
    current_candidates: list[BookCandidate] = []
    scanned = 0
    position_index = 0

    with path.open("r", encoding="utf-8-sig", errors="replace") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue

            if line.startswith("sfen "):
                if current_root_sfen is not None:
                    position_index += 1
                    if position_index > start_index:
                        yield BookPosition(root_sfen=current_root_sfen, candidates=current_candidates, position_index=position_index)
                        scanned += 1
                        if limit_scan is not None and scanned >= limit_scan:
                            return
                current_root_sfen = line[5:].strip()
                current_candidates = []
                continue

            if current_root_sfen is None:
                continue

            parts = line.split()
            if len(parts) < 5:
                continue

            usi, ponder, eval_raw, depth_raw, count_raw = parts[:5]
            try:
                eval_cp = int(eval_raw)
                depth = int(depth_raw)
                count = int(count_raw)
            except ValueError:
                continue

            current_candidates.append(
                BookCandidate(
                    usi=usi,
                    ponder=ponder,
                    eval_cp=eval_cp,
                    depth=depth,
                    count=count,
                )
            )

    if current_root_sfen is not None:
        position_index += 1
        if position_index > start_index:
            yield BookPosition(root_sfen=current_root_sfen, candidates=current_candidates, position_index=position_index)


def iter_book_index_entries(book_path: str | Path) -> Iterator[BookIndexEntry]:
    path = Path(book_path)
    position_index = 0

    with path.open("rb") as handle:
        while True:
            byte_offset = handle.tell()
            raw_line = handle.readline()
            if not raw_line:
                break

            line = _decode_book_line(raw_line, byte_offset).strip()
            if not line:
                continue

            if line.startswith("sfen "):
                position_index += 1
                yield BookIndexEntry(position_index=position_index, byte_offset=byte_offset)


def load_book_index(index_path: str | Path) -> list[BookIndexEntry]:
    path = Path(index_path)
    entries: list[BookIndexEntry] = []
    if not path.exists():
        return entries

    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
                position_index = int(payload["positionIndex"])
                byte_offset = int(payload["byteOffset"])
            except Exception:
                continue
            entries.append(BookIndexEntry(position_index=position_index, byte_offset=byte_offset))
    return entries


def read_book_position_at(book_path: str | Path, byte_offset: int, position_index: int) -> Optional[BookPosition]:
    path = Path(book_path)
    current_candidates: list[BookCandidate] = []

    with path.open("rb") as handle:
        handle.seek(byte_offset)
        line_offset = handle.tell()
        raw_line = handle.readline()
        if not raw_line:
            return None

        line = _decode_book_line(raw_line, line_offset).strip()
        if not line.startswith("sfen "):
            return None

        current_root_sfen = line[5:].strip()

        while True:
            line_offset = handle.tell()
            raw_line = handle.readline()
            if not raw_line:
                break

            line = _decode_book_line(raw_line, line_offset).strip()
            if not line:
                continue
            if line.startswith("sfen "):
                break

            parts = line.split()
            if len(parts) < 5:
                continue

            usi, ponder, eval_raw, depth_raw, count_raw = parts[:5]
            try:
                eval_cp = int(eval_raw)
                depth = int(depth_raw)
                count = int(count_raw)
            except ValueError:
                continue

            current_candidates.append(
                BookCandidate(
                    usi=usi,
                    ponder=ponder,
                    eval_cp=eval_cp,
                    depth=depth,
                    count=count,
                )
            )

    return BookPosition(root_sfen=current_root_sfen, candidates=current_candidates, position_index=position_index)


def build_book_index(book_path: str | Path, output_path: str | Path) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", encoding="utf-8", newline="") as handle:
        for entry in iter_book_index_entries(book_path):
            handle.write(
                json.dumps(
                    {"positionIndex": entry.position_index, "byteOffset": entry.byte_offset},
                    ensure_ascii=False,
                )
                + "\n"
            )
