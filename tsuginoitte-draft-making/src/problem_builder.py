from __future__ import annotations

import random
import sys
import time
import shogi
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

from .book_parser import (
    BookCandidate,
    BookPosition,
    iter_book_positions,
    load_book_index,
    read_book_position_at,
)
from .label import move_to_label
from .rating import problem_rating
from .usi_engine import EngineAnalysis, UsiEngine


@dataclass(frozen=True)
class SelectedProblem:
    name: str
    draft: dict[str, Any]
    tsv_row: dict[str, Any]


@dataclass
class QhapaqLegalRunStats:
    scanned_positions: int = 0
    skipped_correct_analysis_failed: int = 0
    skipped_not_enough_legal_candidates: int = 0
    skipped_not_enough_diff_candidates: int = 0
    skipped_line_too_short: int = 0
    accepted_problems: int = 0
    total_analyzed_legal_candidates: int = 0
    total_correct_analyses: int = 0
    start_monotonic: float = field(default_factory=time.monotonic)
    elapsed_seconds: float = 0.0

    def finish(self) -> None:
        self.elapsed_seconds = max(0.0, time.monotonic() - self.start_monotonic)


@dataclass(frozen=True)
class QhapaqLegalSelectionResult:
    selected: Optional[dict[str, Any]]
    skip_reason: Optional[str]
    correct_analysis_attempted: bool
    analyzed_legal_candidates: int
    successful_legal_analyses: int


_QHAPAQ_SKIP_CORRECT_ANALYSIS_FAILED = "correct_analysis_failed"
_QHAPAQ_SKIP_NOT_ENOUGH_LEGAL_CANDIDATES = "not_enough_legal_candidates"
_QHAPAQ_SKIP_NOT_ENOUGH_DIFF_CANDIDATES = "not_enough_diff_candidates"


def _log_qhapaq_legal_skip(message: str, verbose_skip_log: bool) -> None:
    if not verbose_skip_log:
        return
    print(message, file=sys.stderr)


def get_root_turn(root_sfen: str) -> str:
    tokens = root_sfen.split()
    if len(tokens) < 2:
        raise ValueError(f"Invalid root sfen: {root_sfen}")
    root_turn = tokens[1]
    if root_turn not in ("b", "w"):
        raise ValueError(f"Invalid root turn: {root_turn}")
    return root_turn


def get_after_turn(root_sfen: str) -> str:
    root_turn = get_root_turn(root_sfen)
    return "w" if root_turn == "b" else "b"


def _find_book_position_by_root_sfen(book_path: str | Path, root_sfen: str) -> Optional[BookPosition]:
    for position in iter_book_positions(book_path):
        if position.root_sfen == root_sfen:
            return position
    return None


def _select_qhapaq_correct_candidate(position: BookPosition) -> Optional[BookCandidate]:
    candidates_by_usi: dict[str, BookCandidate] = {}
    for candidate in position.candidates:
        current = candidates_by_usi.get(candidate.usi)
        if current is None or candidate.count > current.count:
            candidates_by_usi[candidate.usi] = candidate

    if not candidates_by_usi:
        return None

    return max(candidates_by_usi.values(), key=lambda candidate: candidate.count)


def _select_qhapaq_legal_candidates(
    sorted_candidates: list[dict[str, Any]],
    incorrect_selection: str,
    rng: random.Random,
) -> list[dict[str, Any]]:
    def _answerer_eval_cp(candidate: dict[str, Any]) -> Any:
        return candidate.get("answerer_eval_cp", candidate.get("answererEvalCp"))

    sorted_candidates = sorted(sorted_candidates, key=_answerer_eval_cp, reverse=True)
    if len(sorted_candidates) < 2:
        return []

    if incorrect_selection == "top":
        return sorted_candidates[:2]

    if incorrect_selection == "bottom":
        selected = sorted(sorted_candidates, key=_answerer_eval_cp)[:2]
        return sorted(selected, key=_answerer_eval_cp, reverse=True)

    if incorrect_selection == "random":
        selected = rng.sample(sorted_candidates, 2)
        return sorted(selected, key=_answerer_eval_cp, reverse=True)

    if incorrect_selection == "mixed":
        if len(sorted_candidates) == 2:
            return sorted_candidates[:2]

        roll = rng.random()
        if roll < 0.5:
            return sorted_candidates[:2]
        if roll < 0.85:
            selected = [sorted_candidates[0], rng.choice(sorted_candidates[1:])]
            return sorted(selected, key=_answerer_eval_cp, reverse=True)

        selected = rng.sample(sorted_candidates, 2)
        return sorted(selected, key=_answerer_eval_cp, reverse=True)

    raise ValueError(f"Unknown incorrect selection mode: {incorrect_selection}")


def _evaluate_qhapaq_legal_move(
    engine: UsiEngine,
    root_sfen: str,
    move_usi: str,
    depth: int,
    max_line_moves: int,
    min_line_moves: int,
) -> dict[str, Any]:
    analysis = engine.analyze_after_move(root_sfen, move_usi, depth)
    raw_score_cp = _analysis_raw_score_cp(analysis)
    black_eval_cp = to_black_eval_cp(root_sfen, raw_score_cp)
    answerer_eval_cp = to_answerer_eval_cp(root_sfen, black_eval_cp)
    line = _truncate_pv(analysis.pv, max_line_moves)
    line_length = len(line)

    skip_reason = ""
    is_diff_accepted = False
    if analysis.bestmove == "(none)":
        skip_reason = "analysis_no_bestmove"
    elif analysis.depth is None or analysis.depth < depth:
        skip_reason = "analysis_depth_too_shallow"
    elif raw_score_cp is None or black_eval_cp is None or answerer_eval_cp is None:
        skip_reason = "analysis_score_missing"
    elif line_length < min_line_moves:
        skip_reason = "line_too_short"
    else:
        is_diff_accepted = True

    return {
        "analysis": analysis,
        "raw_score_cp": raw_score_cp,
        "black_eval_cp": black_eval_cp,
        "answerer_eval_cp": answerer_eval_cp,
        "line": line,
        "line_length": line_length,
        "is_diff_accepted": is_diff_accepted,
        "skip_reason": skip_reason,
    }


def debug_qhapaq_legal_root_analysis(
    book_path: str | Path,
    engine_path: str | Path,
    root_sfen: str,
    depth: int,
    min_diff: int,
    max_diff: Optional[int],
    incorrect_selection: str,
    debug_max_legal_analyze: int,
    correct_usi: Optional[str] = None,
    random_seed: Optional[int] = None,
    max_line_moves: int = 12,
    min_line_moves: int = 4,
    engine_threads: Optional[int] = None,
    engine_hash: Optional[int] = None,
    engine_multipv: Optional[int] = None,
    engine_eval_dir: Optional[str] = None,
    debug_usi_log_path: str | Path | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    root_turn = get_root_turn(root_sfen)
    after_turn = get_after_turn(root_sfen)
    rng = random.Random(random_seed)
    engine_path_text = str(Path(engine_path))
    go_command = f"go depth {depth}"

    position = _find_book_position_by_root_sfen(book_path, root_sfen)
    if position is None and correct_usi is None:
        raise ValueError(
            f"rootSfen was not found in book: {root_sfen}"
        )

    if correct_usi is None:
        assert position is not None
        correct_candidate = _select_qhapaq_correct_candidate(position)
        if correct_candidate is None:
            raise ValueError(f"No candidates were found for rootSfen: {root_sfen}")
        correct_usi = correct_candidate.usi

    legal_rows: list[dict[str, Any]] = []
    accepted_candidates: list[dict[str, Any]] = []

    with UsiEngine(
        engine_path,
        engine_threads=engine_threads,
        engine_hash=engine_hash,
        engine_multipv=engine_multipv,
        engine_eval_dir=engine_eval_dir,
        debug_usi_log_path=debug_usi_log_path,
    ) as engine:
        correct_result = _evaluate_qhapaq_legal_move(
            engine,
            root_sfen,
            correct_usi,
            depth,
            max_line_moves,
            min_line_moves,
        )
        correct_analysis = correct_result["analysis"]
        if correct_result["skip_reason"]:
            raise RuntimeError(
                f"Failed to analyze correct move {correct_usi} at depth {depth}: {correct_result['skip_reason']}"
            )

        correct_raw_score_cp = correct_result["raw_score_cp"]
        correct_black_eval_cp = correct_result["black_eval_cp"]
        correct_answerer_eval_cp = correct_result["answerer_eval_cp"]
        assert correct_raw_score_cp is not None
        assert correct_black_eval_cp is not None
        assert correct_answerer_eval_cp is not None

        correct_label = move_to_label(root_sfen, correct_usi)
        legal_rows.append(
            {
                "role": "correct",
                "usi": correct_usi,
                "label": correct_label,
                "enginePath": engine_path_text,
                "engineThreads": engine_threads,
                "engineHash": engine_hash,
                "engineMultiPV": engine_multipv,
                "engineEvalDir": engine_eval_dir,
                "usiGoCommand": go_command,
                "rootTurn": root_turn,
                "afterTurn": after_turn,
                "rawScoreCp": correct_raw_score_cp,
                "blackEvalCp": correct_black_eval_cp,
                "answererEvalCp": correct_answerer_eval_cp,
                "bestmove": correct_analysis.bestmove,
                "scoreCp": correct_analysis.score_cp,
                "depth": correct_analysis.depth,
                "diffFromCorrect": 0,
                "isDiffAccepted": True,
                "line": _join_pv(correct_result["line"]),
                "lineLength": correct_result["line_length"],
                "skipReason": "",
            }
        )

        board = shogi.Board(root_sfen)
        legal_moves = list(board.legal_moves)
        legal_move_usis = [move.usi() for move in legal_moves]
        if correct_usi not in legal_move_usis:
            raise ValueError(f"Correct move is not legal for the provided rootSfen: {correct_usi}")

        analyzed_legal_candidates = 0
        for move in legal_moves:
            move_usi = move.usi()
            if move_usi == correct_usi:
                continue
            if analyzed_legal_candidates >= debug_max_legal_analyze:
                break

            analyzed_legal_candidates += 1
            label = move_to_label(root_sfen, move_usi)
            try:
                result = _evaluate_qhapaq_legal_move(
                    engine,
                    root_sfen,
                    move_usi,
                    depth,
                    max_line_moves,
                    min_line_moves,
                )
            except (TimeoutError, ValueError) as exc:
                legal_rows.append(
                    {
                        "role": "legal_candidate",
                        "usi": move_usi,
                        "label": label,
                        "enginePath": engine_path_text,
                        "engineThreads": engine_threads,
                        "engineHash": engine_hash,
                        "engineMultiPV": engine_multipv,
                        "engineEvalDir": engine_eval_dir,
                        "usiGoCommand": go_command,
                        "rootTurn": root_turn,
                        "afterTurn": after_turn,
                        "rawScoreCp": None,
                        "blackEvalCp": None,
                        "answererEvalCp": None,
                        "bestmove": "",
                        "scoreCp": None,
                        "depth": None,
                        "diffFromCorrect": None,
                        "isDiffAccepted": False,
                        "line": "",
                        "lineLength": 0,
                        "skipReason": f"analysis_failed: {exc}",
                    }
                )
                continue

            candidate_raw_score_cp = result["raw_score_cp"]
            candidate_black_eval_cp = result["black_eval_cp"]
            candidate_answerer_eval_cp = result["answerer_eval_cp"]
            diff_from_correct: Optional[int] = None
            if candidate_answerer_eval_cp is not None:
                diff_from_correct = correct_answerer_eval_cp - candidate_answerer_eval_cp

            skip_reason = result["skip_reason"]
            is_diff_accepted = False
            if skip_reason:
                pass
            elif diff_from_correct is None:
                skip_reason = "analysis_score_missing"
            elif diff_from_correct < min_diff:
                skip_reason = "diff_below_min"
            elif max_diff is not None and diff_from_correct > max_diff:
                skip_reason = "diff_above_max"
            else:
                is_diff_accepted = True

            row = {
                "role": "legal_candidate",
                "usi": move_usi,
                "label": label,
                "enginePath": engine_path_text,
                "engineThreads": engine_threads,
                "engineHash": engine_hash,
                "engineMultiPV": engine_multipv,
                "engineEvalDir": engine_eval_dir,
                "usiGoCommand": go_command,
                "rootTurn": root_turn,
                "afterTurn": after_turn,
                "rawScoreCp": candidate_raw_score_cp,
                "blackEvalCp": candidate_black_eval_cp,
                "answererEvalCp": candidate_answerer_eval_cp,
                "bestmove": result["analysis"].bestmove,
                "scoreCp": result["analysis"].score_cp,
                "depth": result["analysis"].depth,
                "diffFromCorrect": diff_from_correct,
                "isDiffAccepted": is_diff_accepted,
                "line": _join_pv(result["line"]),
                "lineLength": result["line_length"],
                "skipReason": skip_reason,
            }
            legal_rows.append(row)
            if is_diff_accepted:
                accepted_candidates.append(row)

    selected_candidates = _select_qhapaq_legal_candidates(accepted_candidates, incorrect_selection, rng)
    selected_rows: list[dict[str, Any]] = []
    for index, selected_candidate in enumerate(selected_candidates, start=1):
        selected_rows.append(
            {
                **selected_candidate,
                "role": f"selected_incorrect{index}",
            }
        )

    rows = legal_rows + selected_rows
    summary = {
        "rootTurn": root_turn,
        "correct": correct_usi,
        "correctBlackEvalCp": correct_black_eval_cp,
        "correctAnswererEvalCp": correct_answerer_eval_cp,
        "analyzedLegalCandidates": analyzed_legal_candidates,
        "acceptedDiffCandidates": len(accepted_candidates),
        "selectedIncorrect1": selected_candidates[0]["usi"] if len(selected_candidates) >= 1 else "",
        "selectedIncorrect2": selected_candidates[1]["usi"] if len(selected_candidates) >= 2 else "",
        "enginePath": engine_path_text,
        "engineThreads": engine_threads,
        "engineHash": engine_hash,
        "engineMultiPV": engine_multipv,
        "engineEvalDir": engine_eval_dir,
        "usiGoCommand": go_command,
    }
    return rows, summary


def to_black_eval_cp(root_sfen: str, raw_score_cp: Optional[int]) -> Optional[int]:
    if raw_score_cp is None:
        return None

    after_turn = get_after_turn(root_sfen)
    if after_turn == "b":
        return raw_score_cp
    return -raw_score_cp


def to_answerer_eval_cp(root_sfen: str, black_eval_cp: Optional[int]) -> Optional[int]:
    if black_eval_cp is None:
        return None

    root_turn = get_root_turn(root_sfen)
    if root_turn == "b":
        return black_eval_cp
    return -black_eval_cp


def normalize_eval_for_root_side(
    root_sfen: str,
    raw_score_cp: Optional[int],
    score_basis: str = "side_to_move",
) -> Optional[int]:
    if score_basis == "side_to_move":
        return to_black_eval_cp(root_sfen, raw_score_cp)
    if score_basis == "root_side":
        return raw_score_cp
    raise ValueError(f"Unknown score basis: {score_basis}")


def _analysis_raw_score_cp(analysis: EngineAnalysis) -> Optional[int]:
    if analysis.raw_score_cp is not None:
        return analysis.raw_score_cp
    return analysis.score_cp


def _analyze_after_move_or_none(
    engine: UsiEngine,
    root_sfen: str,
    move: str,
    depth: int,
    *,
    log_message: str,
    verbose_skip_log: bool,
) -> Optional[EngineAnalysis]:
    try:
        analysis = engine.analyze_after_move(root_sfen, move, depth)
    except (ValueError, TimeoutError) as exc:
        _log_qhapaq_legal_skip(f"{log_message}: {exc}", verbose_skip_log)
        return None

    if analysis.bestmove == "(none)" or analysis.depth is None or analysis.depth < depth:
        return None
    if analysis.score_cp is None:
        return None
    return analysis


def _join_pv(pv: list[str]) -> str:
    return " ".join(pv)


def _truncate_pv(pv: list[str], max_line_moves: int) -> list[str]:
    return pv[:max_line_moves]


def _choose_incorrect_candidates(
    incorrect_candidates: list[BookCandidate],
    incorrect_selection: str,
    rng: random.Random,
) -> list[BookCandidate]:
    if incorrect_selection == "top":
        return incorrect_candidates[:2]

    if incorrect_selection == "bottom":
        selected = sorted(incorrect_candidates, key=lambda candidate: candidate.eval_cp)[:2]
        return sorted(selected, key=lambda candidate: candidate.eval_cp, reverse=True)

    if incorrect_selection == "random":
        selected = rng.sample(incorrect_candidates, 2)
        return sorted(selected, key=lambda candidate: candidate.eval_cp, reverse=True)

    if incorrect_selection == "mixed":
        if len(incorrect_candidates) == 2:
            return incorrect_candidates[:2]

        roll = rng.random()
        if roll < 0.5:
            return incorrect_candidates[:2]
        if roll < 0.85:
            selected = [incorrect_candidates[0], rng.choice(incorrect_candidates[1:])]
            return sorted(selected, key=lambda candidate: candidate.eval_cp, reverse=True)

        selected = rng.sample(incorrect_candidates, 2)
        return sorted(selected, key=lambda candidate: candidate.eval_cp, reverse=True)

    raise ValueError(f"Unknown incorrect selection mode: {incorrect_selection}")


def _select_candidates(
    position: BookPosition,
    min_diff: int,
    incorrect_selection: str,
    rng: random.Random,
) -> Optional[dict[str, Any]]:
    valid_candidates = sorted(position.candidates, key=lambda candidate: candidate.eval_cp, reverse=True)
    if len(valid_candidates) < 3:
        return None

    correct_candidate = valid_candidates[0]
    incorrect_candidates = [
        candidate
        for candidate in valid_candidates[1:]
        if correct_candidate.eval_cp - candidate.eval_cp > min_diff
    ]
    if len(incorrect_candidates) < 2:
        return None

    selected_incorrect_candidates = _choose_incorrect_candidates(incorrect_candidates, incorrect_selection, rng)

    return {
        "correct": correct_candidate,
        "incorrect1": selected_incorrect_candidates[0],
        "incorrect2": selected_incorrect_candidates[1],
        "incorrectSelectionMode": incorrect_selection,
        "incorrectCandidateCount": len(incorrect_candidates),
    }


def _select_candidates_qhapaq_legal(
    position: BookPosition,
    min_diff: int,
    max_diff: Optional[int],
    incorrect_selection: str,
    engine: UsiEngine,
    depth: int,
    rng: random.Random,
    verbose_skip_log: bool,
) -> QhapaqLegalSelectionResult:
    """Select candidates for Qhapaq legal mode.
    
    - Correct: book candidate with highest count
    - Incorrect: from legal moves (early exit after 2 found)
    """
    candidates_by_count: dict[str, BookCandidate] = {}
    for candidate in position.candidates:
        if candidate.usi not in candidates_by_count:
            candidates_by_count[candidate.usi] = candidate

    if not candidates_by_count:
        return QhapaqLegalSelectionResult(
            selected=None,
            skip_reason=_QHAPAQ_SKIP_NOT_ENOUGH_LEGAL_CANDIDATES,
            correct_analysis_attempted=False,
            analyzed_legal_candidates=0,
            successful_legal_analyses=0,
        )

    correct_candidate = max(candidates_by_count.values(), key=lambda c: c.count)

    board = shogi.Board(position.root_sfen)
    legal_moves = list(board.legal_moves)

    correct_analysis = _analyze_after_move_or_none(
        engine,
        position.root_sfen,
        correct_candidate.usi,
        depth,
        log_message=f"skip qhapaq legal position {position.position_index} correct move {correct_candidate.usi}",
        verbose_skip_log=verbose_skip_log,
    )
    if correct_analysis is None:
        return QhapaqLegalSelectionResult(
            selected=None,
            skip_reason=_QHAPAQ_SKIP_CORRECT_ANALYSIS_FAILED,
            correct_analysis_attempted=True,
            analyzed_legal_candidates=0,
            successful_legal_analyses=0,
        )

    root_turn = get_root_turn(position.root_sfen)
    after_turn = get_after_turn(position.root_sfen)

    correct_raw_score_cp = _analysis_raw_score_cp(correct_analysis)
    correct_black_eval_cp = to_black_eval_cp(position.root_sfen, correct_raw_score_cp)
    correct_answerer_eval_cp = to_answerer_eval_cp(position.root_sfen, correct_black_eval_cp)
    assert correct_black_eval_cp is not None
    assert correct_answerer_eval_cp is not None

    legal_candidates = []
    correct_usi = correct_candidate.usi
    analyzed_legal_candidates = 0
    successful_legal_analyses = 0

    for move in legal_moves:
        move_usi = move.usi()
        if move_usi == correct_usi:
            continue

        analyzed_legal_candidates += 1
        analysis = _analyze_after_move_or_none(
            engine,
            position.root_sfen,
            move_usi,
            depth,
            log_message=f"skip qhapaq legal position {position.position_index} move {move_usi}",
            verbose_skip_log=verbose_skip_log,
        )
        if analysis is None:
            continue

        successful_legal_analyses += 1

        candidate_raw_score_cp = _analysis_raw_score_cp(analysis)
        candidate_black_eval_cp = to_black_eval_cp(position.root_sfen, candidate_raw_score_cp)
        candidate_answerer_eval_cp = to_answerer_eval_cp(position.root_sfen, candidate_black_eval_cp)
        if candidate_black_eval_cp is None or candidate_answerer_eval_cp is None:
            continue

        diff = correct_answerer_eval_cp - candidate_answerer_eval_cp
        if diff < min_diff:
            continue
        if max_diff is not None and diff > max_diff:
            continue

        legal_candidates.append({
            "usi": move_usi,
            "eval_cp": candidate_black_eval_cp,
            "raw_score_cp": candidate_raw_score_cp,
            "black_eval_cp": candidate_black_eval_cp,
            "answerer_eval_cp": candidate_answerer_eval_cp,
            "analysis": analysis,
        })

        # Early exit when 2 candidates found
        if len(legal_candidates) >= 2:
            break

    if successful_legal_analyses < 2:
        return QhapaqLegalSelectionResult(
            selected=None,
            skip_reason=_QHAPAQ_SKIP_NOT_ENOUGH_LEGAL_CANDIDATES,
            correct_analysis_attempted=True,
            analyzed_legal_candidates=analyzed_legal_candidates,
            successful_legal_analyses=successful_legal_analyses,
        )

    if len(legal_candidates) < 2:
        return QhapaqLegalSelectionResult(
            selected=None,
            skip_reason=_QHAPAQ_SKIP_NOT_ENOUGH_DIFF_CANDIDATES,
            correct_analysis_attempted=True,
            analyzed_legal_candidates=analyzed_legal_candidates,
            successful_legal_analyses=successful_legal_analyses,
        )

    sorted_candidates = sorted(legal_candidates, key=lambda c: c["answerer_eval_cp"], reverse=True)
    selected = _select_qhapaq_legal_candidates(sorted_candidates, incorrect_selection, rng)

    incorrect1_cand = BookCandidate(
        usi=selected[0]["usi"],
        ponder="",
        eval_cp=selected[0]["eval_cp"],
        depth=selected[0]["analysis"].depth or depth,
        count=1,
    )
    incorrect2_cand = BookCandidate(
        usi=selected[1]["usi"],
        ponder="",
        eval_cp=selected[1]["eval_cp"],
        depth=selected[1]["analysis"].depth or depth,
        count=1,
    )
    
    return QhapaqLegalSelectionResult(
        selected={
            "correct": correct_candidate,
            "incorrect1": incorrect1_cand,
            "incorrect2": incorrect2_cand,
            "incorrect1_analysis": selected[0]["analysis"],
            "incorrect2_analysis": selected[1]["analysis"],
            "correct_analysis": correct_analysis,
            "correct_raw_score_cp": correct_raw_score_cp,
            "correct_black_eval_cp": correct_black_eval_cp,
            "correct_answerer_eval_cp": correct_answerer_eval_cp,
            "incorrect1_raw_score_cp": selected[0]["raw_score_cp"],
            "incorrect1_black_eval_cp": selected[0]["black_eval_cp"],
            "incorrect1_answerer_eval_cp": selected[0]["answerer_eval_cp"],
            "incorrect2_raw_score_cp": selected[1]["raw_score_cp"],
            "incorrect2_black_eval_cp": selected[1]["black_eval_cp"],
            "incorrect2_answerer_eval_cp": selected[1]["answerer_eval_cp"],
            "root_turn": root_turn,
            "after_turn": after_turn,
            "correct_count": correct_candidate.count,
            "incorrect_source": "legal",
            "incorrectSelectionMode": incorrect_selection,
            "incorrectCandidateCount": len(sorted_candidates),
            "analyzedLegalCandidates": analyzed_legal_candidates,
        },
        skip_reason=None,
        correct_analysis_attempted=True,
        analyzed_legal_candidates=analyzed_legal_candidates,
        successful_legal_analyses=successful_legal_analyses,
    )


def _make_choice_payload(usi: str, label: str, eval_cp: int, line: list[str], slot_label: str) -> dict[str, Any]:
    return {
        "usi": usi,
        "line": line,
        "label": label,
        "eval_cp": eval_cp,
        "slotLabel": slot_label,
        "explanation": "",
        "eval_percent": None,
    }


def _make_draft(
    root_sfen: str,
    selected: dict[str, BookCandidate],
    analyses: dict[str, EngineAnalysis],
    lines: dict[str, list[str]],
    saved_at: str,
    incorrect_selection_mode: str,
    incorrect_candidate_count: int,
    book_type: str = "petashock",
    incorrect_source: str = "book",
    max_diff: Optional[int] = None,
    min_diff: Optional[int] = None,
    analyzed_legal_candidates: Optional[int] = None,
    scanned_position_attempt: Optional[int] = None,
    qhapaq_skip_reason: str = "",
) -> tuple[dict[str, Any], dict[str, Any]]:
    correct = selected["correct"]
    incorrect1 = selected["incorrect1"]
    incorrect2 = selected["incorrect2"]

    correct_label = move_to_label(root_sfen, correct.usi)
    incorrect1_label = move_to_label(root_sfen, incorrect1.usi)
    incorrect2_label = move_to_label(root_sfen, incorrect2.usi)

    root_turn = selected.get("root_turn", get_root_turn(root_sfen))
    after_turn = selected.get("after_turn", get_after_turn(root_sfen))

    if book_type == "qhapaq" and incorrect_source == "legal":
        correct_eval_cp = selected["correct_black_eval_cp"]
        diff = selected["correct_answerer_eval_cp"] - selected["incorrect1_answerer_eval_cp"]
    else:
        correct_eval_cp = correct.eval_cp
        diff = correct.eval_cp - incorrect1.eval_cp

    rating = problem_rating(diff)
    if rating is None:
        raise ValueError("Problem rating is out of scope")

    tags = []
    if book_type == "qhapaq":
        tags = ["opening", "qhapaq"]

    draft = {
        "tags": tags,
        "prompt": "",
        "choices": {
            "correct": _make_choice_payload(
                correct.usi, correct_label, correct_eval_cp, lines["correct"], "correct"
            ),
            "incorrect1": _make_choice_payload(
                incorrect1.usi, incorrect1_label, incorrect1.eval_cp, lines["incorrect1"], "incorrect1"
            ),
            "incorrect2": _make_choice_payload(
                incorrect2.usi, incorrect2_label, incorrect2.eval_cp, lines["incorrect2"], "incorrect2"
            ),
        },
        "kifText": "",
        "savedAt": saved_at,
        "kifMoves": [],
        "rootSfen": root_sfen,
        "displayNo": None,
        "rootEvalCp": correct_eval_cp,
        "introMoveUsi": "",
        "problemRating": rating,
        "rootEvalPercent": None,
        "rootTurn": root_turn,
        "afterTurn": after_turn,
        "readingLineInputs": {
            "correct": "",
            "incorrect1": "",
            "incorrect2": "",
        },
    }

    correct_source = "book_count" if (book_type == "qhapaq" and incorrect_source == "legal") else None

    tsv_row = {
        "rootSfen": root_sfen,
        "rootTurn": root_turn,
        "afterTurn": after_turn,
        "correctUsi": correct.usi,
        "correctLabel": correct_label,
        "correctEvalCp": correct_eval_cp,
        "correctBestmove": analyses["correct"].bestmove,
        "correctRawScoreCp": selected.get("correct_raw_score_cp", _analysis_raw_score_cp(analyses["correct"])),
        "correctBlackEvalCp": selected.get("correct_black_eval_cp", correct_eval_cp),
        "correctAnswererEvalCp": selected.get(
            "correct_answerer_eval_cp",
            to_answerer_eval_cp(root_sfen, selected.get("correct_black_eval_cp", correct_eval_cp)),
        ),
        "correctScoreCp": _analysis_raw_score_cp(analyses["correct"]),
        "correctDepth": analyses["correct"].depth,
        "incorrect1Usi": incorrect1.usi,
        "incorrect1Label": incorrect1_label,
        "incorrect1EvalCp": incorrect1.eval_cp,
        "incorrect1Bestmove": analyses["incorrect1"].bestmove,
        "incorrect1RawScoreCp": selected.get("incorrect1_raw_score_cp", _analysis_raw_score_cp(analyses["incorrect1"])),
        "incorrect1BlackEvalCp": selected.get("incorrect1_black_eval_cp", incorrect1.eval_cp),
        "incorrect1AnswererEvalCp": selected.get(
            "incorrect1_answerer_eval_cp",
            to_answerer_eval_cp(root_sfen, selected.get("incorrect1_black_eval_cp", incorrect1.eval_cp)),
        ),
        "incorrect1ScoreCp": _analysis_raw_score_cp(analyses["incorrect1"]),
        "incorrect1Depth": analyses["incorrect1"].depth,
        "incorrect2Usi": incorrect2.usi,
        "incorrect2Label": incorrect2_label,
        "incorrect2EvalCp": incorrect2.eval_cp,
        "incorrect2Bestmove": analyses["incorrect2"].bestmove,
        "incorrect2RawScoreCp": selected.get("incorrect2_raw_score_cp", _analysis_raw_score_cp(analyses["incorrect2"])),
        "incorrect2BlackEvalCp": selected.get("incorrect2_black_eval_cp", incorrect2.eval_cp),
        "incorrect2AnswererEvalCp": selected.get(
            "incorrect2_answerer_eval_cp",
            to_answerer_eval_cp(root_sfen, selected.get("incorrect2_black_eval_cp", incorrect2.eval_cp)),
        ),
        "incorrect2ScoreCp": _analysis_raw_score_cp(analyses["incorrect2"]),
        "incorrect2Depth": analyses["incorrect2"].depth,
        "problemRating": rating,
        "diff": diff,
        "correctLine": _join_pv(lines["correct"]),
        "incorrect1Line": _join_pv(lines["incorrect1"]),
        "incorrect2Line": _join_pv(lines["incorrect2"]),
        "correctLineLength": len(lines["correct"]),
        "incorrect1LineLength": len(lines["incorrect1"]),
        "incorrect2LineLength": len(lines["incorrect2"]),
        "incorrectSelectionMode": incorrect_selection_mode,
        "incorrectCandidateCount": incorrect_candidate_count,
        "bookType": book_type,
        "incorrectSource": incorrect_source,
        "correctSource": correct_source,
        "correctCount": selected.get("correct_count"),
        "minDiff": min_diff,
        "maxDiff": max_diff,
        "analyzedLegalCandidates": analyzed_legal_candidates,
        "scannedPositionAttempt": scanned_position_attempt,
        "qhapaqSkipReason": qhapaq_skip_reason,
    }
    return draft, tsv_row


def build_problems(
    book_path: str | Path,
    engine_path: str | Path,
    count: int,
    depth: int,
    name_prefix: str,
    name_start: int,
    min_diff: int,
    max_line_moves: int,
    min_line_moves: int,
    incorrect_selection: str = "top",
    random_seed: Optional[int] = None,
    limit_scan: Optional[int] = None,
    start_index: int = 0,
    scan_mode: str = "sequential",
    book_index_path: str | Path = "outputs/petashock_book_index.jsonl",
    used_position_indexes: Optional[set[int]] = None,
    book_type: str = "petashock",
    incorrect_source: str = "book",
    max_diff: Optional[int] = None,
    qhapaq_legal_stats: Optional[QhapaqLegalRunStats] = None,
    verbose_skip_log: bool = False,
) -> tuple[list[SelectedProblem], int]:
    generated: list[SelectedProblem] = []
    saved_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    rng = random.Random(random_seed)

    last_scanned_index = start_index
    with UsiEngine(engine_path) as engine:
        if scan_mode == "sequential":
            position_iter = iter_book_positions(book_path, limit_scan=limit_scan, start_index=start_index)
        elif scan_mode == "random":
            index_entries = load_book_index(book_index_path)
            if not index_entries:
                raise FileNotFoundError(
                    f"Book index not found or empty: {book_index_path}. Run --build-book-index first."
                )
            used_indexes = set(used_position_indexes or set())
            available_entries = [entry for entry in index_entries if entry.position_index not in used_indexes]

            def _random_positions() -> Iterator[BookPosition]:
                scanned = 0
                while available_entries:
                    if limit_scan is not None and scanned >= limit_scan:
                        break
                    entry_index = rng.randrange(len(available_entries))
                    entry = available_entries.pop(entry_index)
                    scanned += 1
                    position = read_book_position_at(book_path, entry.byte_offset, entry.position_index)
                    if position is None:
                        continue
                    yield position

            position_iter = _random_positions()
            last_scanned_index = 0
        else:
            raise ValueError(f"Unknown scan mode: {scan_mode}")

        for position in position_iter:
            last_scanned_index = position.position_index
            if len(generated) >= count:
                break

            if book_type == "qhapaq" and incorrect_source == "legal" and qhapaq_legal_stats is not None:
                qhapaq_legal_stats.scanned_positions += 1

            # Select candidates based on book type and incorrect source
            if book_type == "qhapaq" and incorrect_source == "legal":
                selection = _select_candidates_qhapaq_legal(
                    position,
                    min_diff=min_diff,
                    max_diff=max_diff,
                    incorrect_selection=incorrect_selection,
                    engine=engine,
                    depth=depth,
                    rng=rng,
                    verbose_skip_log=verbose_skip_log,
                )
                if qhapaq_legal_stats is not None:
                    qhapaq_legal_stats.total_correct_analyses += int(selection.correct_analysis_attempted)
                    qhapaq_legal_stats.total_analyzed_legal_candidates += selection.analyzed_legal_candidates
                if selection.selected is None:
                    if qhapaq_legal_stats is not None:
                        if selection.skip_reason == _QHAPAQ_SKIP_CORRECT_ANALYSIS_FAILED:
                            qhapaq_legal_stats.skipped_correct_analysis_failed += 1
                        elif selection.skip_reason == _QHAPAQ_SKIP_NOT_ENOUGH_LEGAL_CANDIDATES:
                            qhapaq_legal_stats.skipped_not_enough_legal_candidates += 1
                        elif selection.skip_reason == _QHAPAQ_SKIP_NOT_ENOUGH_DIFF_CANDIDATES:
                            qhapaq_legal_stats.skipped_not_enough_diff_candidates += 1
                    if selection.skip_reason is not None:
                        _log_qhapaq_legal_skip(
                            f"skip qhapaq legal position {position.position_index}: {selection.skip_reason}",
                            verbose_skip_log,
                        )
                    continue
                selected = selection.selected
            else:
                selected = _select_candidates(
                    position,
                    min_diff=min_diff,
                    incorrect_selection=incorrect_selection,
                    rng=rng,
                )
            if selected is None:
                continue

            try:
                # For qhapaq legal mode, analyses are already in selected
                if book_type == "qhapaq" and incorrect_source == "legal":
                    analyses = {
                        "correct": selected["correct_analysis"],
                        "incorrect1": selected["incorrect1_analysis"],
                        "incorrect2": selected["incorrect2_analysis"],
                    }
                else:
                    analyses = {
                        "correct": engine.analyze_after_move(
                            position.root_sfen, selected["correct"].usi, depth
                        ),
                        "incorrect1": engine.analyze_after_move(
                            position.root_sfen, selected["incorrect1"].usi, depth
                        ),
                        "incorrect2": engine.analyze_after_move(
                            position.root_sfen, selected["incorrect2"].usi, depth
                        ),
                    }
                if any(analysis.bestmove == "(none)" for analysis in analyses.values()):
                    continue
                if any(analysis.depth is None or analysis.depth < depth for analysis in analyses.values()):
                    continue

                lines = {
                    slot: _truncate_pv(analysis.pv, max_line_moves) for slot, analysis in analyses.items()
                }
                if any(len(line) < min_line_moves or len(line) > max_line_moves for line in lines.values()):
                    if qhapaq_legal_stats is not None and book_type == "qhapaq" and incorrect_source == "legal":
                        qhapaq_legal_stats.skipped_line_too_short += 1
                    continue

                draft, tsv_row = _make_draft(
                    position.root_sfen,
                    selected,
                    analyses,
                    lines,
                    saved_at=saved_at,
                    incorrect_selection_mode=selected["incorrectSelectionMode"],
                    incorrect_candidate_count=selected["incorrectCandidateCount"],
                    book_type=book_type,
                    incorrect_source=incorrect_source,
                    max_diff=max_diff,
                    min_diff=min_diff,
                    analyzed_legal_candidates=selected.get("analyzedLegalCandidates"),
                    scanned_position_attempt=(
                        qhapaq_legal_stats.scanned_positions
                        if qhapaq_legal_stats is not None and book_type == "qhapaq" and incorrect_source == "legal"
                        else None
                    ),
                    qhapaq_skip_reason="",
                )
                tsv_row["positionIndex"] = position.position_index
            except (TimeoutError, ValueError):
                continue

            problem_no = name_start + len(generated)
            problem_rating_value = draft["problemRating"]
            name = f"[R{problem_rating_value}] {name_prefix}_{problem_no:03d}"
            generated.append(SelectedProblem(name=name, draft=draft, tsv_row={"name": name, **tsv_row}))

            # Log qhapaq legal mode accepted positions
            if book_type == "qhapaq" and incorrect_source == "legal" and verbose_skip_log:
                analyzed_count = selected.get("analyzedLegalCandidates", 0)
                print(f"qhapaq legal accepted position {position.position_index}: analyzed {analyzed_count} legal moves")
                if qhapaq_legal_stats is not None:
                    qhapaq_legal_stats.accepted_problems += 1
            elif book_type == "qhapaq" and incorrect_source == "legal" and qhapaq_legal_stats is not None:
                qhapaq_legal_stats.accepted_problems += 1

    return generated, last_scanned_index
