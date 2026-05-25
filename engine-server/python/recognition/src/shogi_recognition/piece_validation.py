from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Any


BOARD_SIZE = 9
LOW_CONFIDENCE_THRESHOLD = 0.80
TOP2_MARGIN_THRESHOLD = 0.20


PIECE_LIMITS = {
    "K": 1,
    "k": 1,
    "R": 2,
    "B": 2,
    "G": 4,
    "S": 4,
    "N": 4,
    "L": 4,
    "P": 18,
}


KANJI_RANKS = {
    1: "一",
    2: "二",
    3: "三",
    4: "四",
    5: "五",
    6: "六",
    7: "七",
    8: "八",
    9: "九",
}


@dataclass(frozen=True)
class Thresholds:
    low_confidence: float = LOW_CONFIDENCE_THRESHOLD
    top2_margin: float = TOP2_MARGIN_THRESHOLD


def square_coord_text(file_num: int, rank_num: int) -> str:
    return f"{file_num}{KANJI_RANKS.get(rank_num, str(rank_num))}"


def piece_family(label: str) -> str | None:
    if label == "empty":
        return None
    if label.startswith("+"):
        label = label[1:]
    if label in {"K", "k"}:
        return label
    return label.upper()


def is_promoted_label(label: str) -> bool:
    return label.startswith("+")


def same_piece_family(left: str, right: str) -> bool:
    left_family = piece_family(left)
    right_family = piece_family(right)
    if left_family is None or right_family is None:
        return False
    return left_family == right_family


def infer_square_reason(
    top1_label: str,
    top2_label: str,
    top1_confidence: float,
    top2_confidence: float,
    thresholds: Thresholds,
) -> tuple[str, list[str]]:
    reasons: list[str] = []
    margin = top1_confidence - top2_confidence

    if top1_confidence < thresholds.low_confidence:
        reasons.append("low_confidence")
    if margin < thresholds.top2_margin:
        reasons.append("ambiguous")

    if reasons and top1_label != "empty" and top2_label != "empty" and same_piece_family(top1_label, top2_label):
        if is_promoted_label(top1_label) != is_promoted_label(top2_label):
            reasons.append("promotion_uncertain")
        elif top1_label.islower() != top2_label.islower():
            reasons.append("orientation_uncertain")

    if top1_label == "empty":
        if reasons:
            return "uncertain", reasons
        return "empty", reasons

    if reasons:
        return "moved_to_box", reasons
    return "confirmed", reasons


def board_to_sfen(board_rows: list[list[str]]) -> str:
    sfen_rows: list[str] = []
    for row in board_rows:
        empty_count = 0
        row_tokens: list[str] = []
        for label in row:
            if label == "empty":
                empty_count += 1
                continue
            if empty_count:
                row_tokens.append(str(empty_count))
                empty_count = 0
            row_tokens.append(label)
        if empty_count:
            row_tokens.append(str(empty_count))
        sfen_rows.append("".join(row_tokens) or "9")
    return "/".join(sfen_rows)


def _make_box_item(
    square: dict[str, Any],
    piece: str,
    reason: str,
    confidence: float,
    source_type: str = "square",
) -> dict[str, Any]:
    return {
        "id": f"box_{square['file']:02d}_{square['rank']:02d}_{piece}",
        "piece": piece,
        "reason": reason,
        "source": {
            "type": source_type,
            "file": square["file"],
            "rank": square["rank"],
        },
        "confidence": confidence,
        "topCandidates": [dict(candidate) for candidate in square["topCandidates"]],
    }


def _limit_key(piece: str) -> str:
    if piece == "empty":
        return "empty"
    if piece.startswith("+"):
        piece = piece[1:]
    if piece in {"K", "k"}:
        return piece
    return piece.upper()


def _select_box_reason(top1_label: str, reasons: list[str], limit_exceeded: bool) -> str:
    if "low_confidence" in reasons:
        return "low_confidence"
    if "promotion_uncertain" in reasons:
        return "promotion_uncertain"
    if "orientation_uncertain" in reasons:
        return "orientation_uncertain"
    if "ambiguous" in reasons:
        return "ambiguous"
    if limit_exceeded:
        return "piece_limit_exceeded"
    if top1_label == "empty":
        return "uncertain_empty_square"
    return "uncertain"


def validate_predictions(
    squares: list[dict[str, Any]],
    thresholds: Thresholds | None = None,
    side_to_move: str = "b",
    move_number: int = 1,
    hands: str = "-",
) -> dict[str, Any]:
    thresholds = thresholds or Thresholds()

    final_squares: list[dict[str, Any]] = []
    piece_box: list[dict[str, Any]] = []
    validation_issues: list[dict[str, Any]] = []

    board_rows = [["empty" for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)]
    board_candidate_items: list[dict[str, Any]] = []

    for square in squares:
        top_candidates = square["topCandidates"]
        top1 = top_candidates[0]
        top2 = top_candidates[1] if len(top_candidates) > 1 else {"piece": "empty", "confidence": 0.0}
        status, reasons = infer_square_reason(
            top1["piece"],
            top2["piece"],
            top1["confidence"],
            top2["confidence"],
            thresholds,
        )

        item = {
            "file": square["file"],
            "rank": square["rank"],
            "piece": top1["piece"],
            "confidence": top1["confidence"],
            "topCandidates": top_candidates,
            "status": status,
        }
        final_squares.append(item)

        if status == "confirmed" and top1["piece"] != "empty":
            board_rows[square["rank"] - 1][9 - square["file"]] = top1["piece"]
            board_candidate_items.append(
                {
                    "square": item,
                    "piece": top1["piece"],
                    "confidence": top1["confidence"],
                    "reason": "confirmed",
                }
            )
            continue

        if status == "moved_to_box" and top1["piece"] != "empty":
            piece_box.append(
                _make_box_item(
                    item,
                    piece=top1["piece"],
                    reason=_select_box_reason(top1["piece"], reasons, False),
                    confidence=top1["confidence"],
                )
            )
            validation_issues.append(
                {
                    "type": "low_confidence_square" if top1["confidence"] < thresholds.low_confidence else "ambiguous_square",
                    "message": f"{square_coord_text(square['file'], square['rank'])}の判定が不確かです",
                    "file": square["file"],
                    "rank": square["rank"],
                }
            )
            if "promotion_uncertain" in reasons:
                validation_issues.append(
                    {
                        "type": "promotion_uncertain_square",
                        "message": f"{square_coord_text(square['file'], square['rank'])}で成駒判定が不確かです",
                        "file": square["file"],
                        "rank": square["rank"],
                    }
                )
            if "orientation_uncertain" in reasons:
                validation_issues.append(
                    {
                        "type": "orientation_uncertain_square",
                        "message": f"{square_coord_text(square['file'], square['rank'])}で先後判定が不確かです",
                        "file": square["file"],
                        "rank": square["rank"],
                    }
                )
            continue

        if status == "uncertain":
            validation_issues.append(
                {
                    "type": "uncertain_empty_square",
                    "message": f"{square_coord_text(square['file'], square['rank'])}の空白判定が不確かです",
                    "file": square["file"],
                    "rank": square["rank"],
                }
            )
            if top2["piece"] != "empty":
                piece_box.append(
                    _make_box_item(
                        item,
                        piece=top2["piece"],
                        reason="uncertain_empty_square",
                        confidence=top2["confidence"],
                    )
                )

    piece_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in board_candidate_items:
        key = _limit_key(candidate["piece"])
        if key == "empty":
            continue
        piece_groups[key].append(candidate)

    for key, limit in PIECE_LIMITS.items():
        if key not in piece_groups:
            continue
        items = sorted(piece_groups[key], key=lambda entry: entry["confidence"])
        overflow = max(len(items) - limit, 0)
        for candidate in items[:overflow]:
            square = candidate["square"]
            square["status"] = "moved_to_box"
            board_rows[square["rank"] - 1][9 - square["file"]] = "empty"
            piece_box.append(
                _make_box_item(
                    square,
                    piece=candidate["piece"],
                    reason="piece_limit_exceeded",
                    confidence=candidate["confidence"],
                )
            )
            validation_issues.append(
                {
                    "type": "piece_limit_exceeded",
                    "message": f"{square_coord_text(square['file'], square['rank'])}の{candidate['piece']}が上限を超えました",
                    "file": square["file"],
                    "rank": square["rank"],
                    "piece": candidate["piece"],
                }
            )

    king_counts = {"K": 0, "k": 0}
    for row in board_rows:
        for label in row:
            if label in king_counts:
                king_counts[label] += 1
    if king_counts["K"] == 0:
        validation_issues.append({"type": "missing_king", "message": "先手玉が盤面にありません"})
    if king_counts["k"] == 0:
        validation_issues.append({"type": "missing_king", "message": "後手玉が盤面にありません"})

    sfen_board = board_to_sfen(board_rows)
    sfen = f"{sfen_board} {side_to_move} {hands} {move_number}"
    overall_confidence = sum(square["confidence"] for square in final_squares) / max(len(final_squares), 1)

    return {
        "sfen": sfen,
        "sideToMove": side_to_move,
        "hands": hands,
        "moveNumber": move_number,
        "confidence": round(float(overall_confidence), 4),
        "squares": final_squares,
        "pieceBox": piece_box,
        "validationIssues": validation_issues,
    }
