from __future__ import annotations

from .sfen import parse_sfen, piece_at_square, piece_owner


SIDE_PREFIX = {"b": "▲", "w": "△"}
RANK_LABELS = {
    "a": "一",
    "b": "二",
    "c": "三",
    "d": "四",
    "e": "五",
    "f": "六",
    "g": "七",
    "h": "八",
    "i": "九",
}
PIECE_LABELS = {
    "P": "歩",
    "L": "香",
    "N": "桂",
    "S": "銀",
    "G": "金",
    "B": "角",
    "R": "飛",
    "K": "玉",
}
PROMOTED_LABELS = {
    "+P": "と",
    "+L": "成香",
    "+N": "成桂",
    "+S": "成銀",
    "+B": "馬",
    "+R": "龍",
}
PROMOTABLE_PIECES = {"P", "L", "N", "S", "B", "R"}


def format_destination(square: str) -> str:
    file_char, rank_char = square
    return chr(ord("０") + int(file_char)) + RANK_LABELS[rank_char]


def _move_piece_label(piece: str, promote: bool) -> str:
    if piece in PROMOTED_LABELS:
        return PROMOTED_LABELS[piece]

    base_piece = piece.upper()
    if base_piece not in PIECE_LABELS:
        raise ValueError(f"Unsupported piece: {piece}")

    label = PIECE_LABELS[base_piece]
    if promote:
        if base_piece not in PROMOTABLE_PIECES:
            raise ValueError(f"Piece cannot promote: {piece}")
        label += "成"
    return label


def move_to_label(root_sfen: str, usi_move: str) -> str:
    parsed = parse_sfen(root_sfen)
    prefix = SIDE_PREFIX.get(parsed.turn)
    if prefix is None:
        raise ValueError(f"Unsupported side to move: {parsed.turn}")

    if "*" in usi_move:
        piece_code, destination = usi_move.split("*", 1)
        if piece_code not in PIECE_LABELS:
            raise ValueError(f"Unsupported drop piece: {usi_move}")
        return prefix + format_destination(destination) + PIECE_LABELS[piece_code] + "打"

    promote = usi_move.endswith("+")
    move_body = usi_move[:-1] if promote else usi_move
    if len(move_body) != 4:
        raise ValueError(f"Invalid USI move: {usi_move}")

    source_square = move_body[:2]
    destination_square = move_body[2:]
    source_piece = piece_at_square(root_sfen, source_square)
    if source_piece is None:
        raise ValueError(f"No piece on source square: {usi_move}")
    if piece_owner(source_piece) != parsed.turn:
        raise ValueError(f"Piece owner mismatch: {usi_move}")

    return prefix + format_destination(destination_square) + _move_piece_label(source_piece, promote)
