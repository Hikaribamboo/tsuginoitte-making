from __future__ import annotations

from dataclasses import dataclass

from .class_map import class_to_idx


class SfenError(ValueError):
    pass


BOARD_SIZE = 9
PROMOTED_ALLOWED = {"+P", "+L", "+N", "+S", "+B", "+R", "+p", "+l", "+n", "+s", "+b", "+r"}


@dataclass(frozen=True)
class SfenBoard:
    rows: list[list[str]]

    @property
    def flat(self) -> list[str]:
        return [label for row in self.rows for label in row]


def _piece_to_class(piece_char: str, promoted: bool) -> str:
    if promoted:
        label = f"+{piece_char}"
    else:
        label = piece_char
    if label not in class_to_idx:
        raise SfenError(f"unsupported SFEN piece label: {label}")
    return label


def expand_sfen_to_board_labels(sfen: str) -> SfenBoard:
    text = sfen.strip()
    if not text:
        raise SfenError("SFEN is empty")

    if text.lower().startswith("position sfen "):
        text = text[len("position sfen ") :].strip()
    if text.lower().startswith("sfen "):
        text = text[len("sfen ") :].strip()

    parts = text.split()
    if len(parts) < 4:
        raise SfenError("SFEN must have at least 4 fields: board side hand move_number")

    board_part = parts[0]
    rows = board_part.split("/")
    if len(rows) != BOARD_SIZE:
        raise SfenError(f"SFEN board must have {BOARD_SIZE} rows")

    board_rows: list[list[str]] = []
    for row_index, row_text in enumerate(rows, start=1):
        labels: list[str] = []
        i = 0
        while i < len(row_text):
            ch = row_text[i]
            if ch.isdigit():
                count = int(ch)
                if count <= 0 or count > BOARD_SIZE:
                    raise SfenError(f"invalid empty count in row {row_index}")
                labels.extend(["empty"] * count)
                i += 1
                continue
            if ch == "+":
                if i + 1 >= len(row_text):
                    raise SfenError(f"dangling promotion marker in row {row_index}")
                piece_char = row_text[i + 1]
                label = _piece_to_class(piece_char, promoted=True)
                if label not in PROMOTED_ALLOWED:
                    raise SfenError(f"unsupported promoted piece: {label}")
                labels.append(label)
                i += 2
                continue
            if ch.lower() not in {"p", "l", "n", "s", "g", "b", "r", "k"}:
                raise SfenError(f"invalid SFEN character '{ch}' in row {row_index}")
            labels.append(_piece_to_class(ch, promoted=False))
            i += 1

        if len(labels) != BOARD_SIZE:
            raise SfenError(f"row {row_index} does not expand to {BOARD_SIZE} squares")
        board_rows.append(labels)

    return SfenBoard(rows=board_rows)


def expand_sfen_to_cell_labels(sfen: str) -> list[str]:
    return expand_sfen_to_board_labels(sfen).flat
