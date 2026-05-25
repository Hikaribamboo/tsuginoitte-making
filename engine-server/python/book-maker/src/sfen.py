from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class ParsedSfen:
    board: list[list[Optional[str]]]
    turn: str
    hands: str
    move_number: int


def parse_sfen(root_sfen: str) -> ParsedSfen:
    parts = root_sfen.split()
    if len(parts) < 4:
        raise ValueError(f"Invalid SFEN: {root_sfen}")

    board_part, turn, hands, move_number_raw = parts[:4]
    rows = board_part.split("/")
    if len(rows) != 9:
        raise ValueError(f"Invalid SFEN board: {root_sfen}")

    board: list[list[Optional[str]]] = []
    for row in rows:
        cells: list[Optional[str]] = []
        index = 0
        while index < len(row):
            char = row[index]
            if char.isdigit():
                cells.extend([None] * int(char))
                index += 1
                continue
            if char == "+":
                if index + 1 >= len(row):
                    raise ValueError(f"Invalid promoted piece in SFEN: {root_sfen}")
                cells.append("+" + row[index + 1])
                index += 2
                continue
            cells.append(char)
            index += 1

        if len(cells) != 9:
            raise ValueError(f"Invalid SFEN row width: {root_sfen}")
        board.append(cells)

    return ParsedSfen(board=board, turn=turn, hands=hands, move_number=int(move_number_raw))


def square_to_board_index(square: str) -> tuple[int, int]:
    if len(square) != 2:
        raise ValueError(f"Invalid USI square: {square}")
    file_char, rank_char = square
    if file_char not in "123456789" or rank_char not in "abcdefghi":
        raise ValueError(f"Invalid USI square: {square}")
    row_index = ord(rank_char) - ord("a")
    col_index = 9 - int(file_char)
    return row_index, col_index


def piece_at_square(root_sfen: str, square: str) -> Optional[str]:
    parsed = parse_sfen(root_sfen)
    row_index, col_index = square_to_board_index(square)
    return parsed.board[row_index][col_index]


def piece_owner(piece: str) -> str:
    return "b" if piece.upper() == piece else "w"
