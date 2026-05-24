from __future__ import annotations

import argparse
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .book_parser import build_book_index
from .problem_builder import QhapaqLegalRunStats, build_problems, debug_qhapaq_legal_root_analysis
from .sql_writer import (
    append_jsonl,
    append_sql,
    append_tsv,
    write_json,
    write_sql,
    write_tsv,
    write_tsv_with_fieldnames,
)
from .supabase_client import SupabaseWriter, load_env_file


def _get_default_paths(book_type: str) -> tuple[str, str]:
    """Get default book index and state file paths based on book type."""
    if book_type == "petashock":
        return "outputs/petashock_book_index.jsonl", "outputs/petashock_state.json"
    elif book_type == "qhapaq":
        return "outputs/qhapaq_book_index.jsonl", "outputs/qhapaq_state.json"
    else:
        raise ValueError(f"Unknown book type: {book_type}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate shogi problems from a book database.")
    parser.add_argument("--book", required=True, help="Path to the book database file")
    parser.add_argument("--book-type", default="petashock", choices=("petashock", "qhapaq"), help="Type of book database")
    parser.add_argument("--book-index-file", default=None, help="Path to book index file")
    parser.add_argument("--engine", default=None, help="Path to the USI engine executable")
    parser.add_argument("--count", type=int, default=None, help="Number of problems to create")
    parser.add_argument("--depth", type=int, default=22, help="Analysis depth per choice")
    parser.add_argument("--name-prefix", default=None, help="Prefix for workspace names")
    parser.add_argument("--name-start", type=int, default=None, help="Starting number for workspace name sequence")
    parser.add_argument("--dry-run", action="store_true", help="Write outputs locally without inserting into Supabase")
    parser.add_argument("--insert", action="store_true", help="Insert into Supabase")
    parser.add_argument("--build-book-index", action="store_true", help="Build book index file and exit")
    parser.add_argument(
        "--scan-mode",
        choices=("sequential", "random"),
        default="sequential",
        help="How to scan the book database for candidate positions",
    )
    parser.add_argument("--min-diff", type=int, default=70, help="Minimum eval difference required for wrong choices")
    parser.add_argument(
        "--incorrect-selection",
        choices=("top", "bottom", "random", "mixed"),
        default="top",
        help="How to choose incorrect candidates after filtering by min-diff",
    )
    parser.add_argument(
        "--incorrect-source",
        choices=("book", "legal"),
        default="book",
        help="Source for incorrect candidates: 'book' from book candidates, 'legal' from legal moves",
    )
    parser.add_argument("--max-diff", type=int, default=None, help="Maximum eval difference for incorrect candidates")
    parser.add_argument("--random-seed", type=int, default=None, help="Seed for random scan and incorrect-candidate selection")
    parser.add_argument("--max-line-moves", type=int, default=12, help="Maximum PV moves stored in each line")
    parser.add_argument("--min-line-moves", type=int, default=4, help="Minimum PV moves required in each line")
    parser.add_argument("--batch-size", type=int, default=50, help="Supabase insert batch size")
    parser.add_argument("--limit-scan", type=int, default=None, help="Limit number of scanned positions for debugging")
    parser.add_argument("--state-file", type=str, default=None, help="Path to state file for persisting progress")
    parser.add_argument("--update-state", action="store_true", help="Update state file even during dry-run")
    parser.add_argument("--verbose-skip-log", action="store_true", help="Print qhapaq legal skip details")
    parser.add_argument("--debug-root-sfen", type=str, default=None, help="Analyze one root SFEN and exit")
    parser.add_argument("--debug-correct-usi", type=str, default=None, help="Override the correct move for debug root analysis")
    parser.add_argument(
        "--debug-output",
        type=str,
        default="outputs/debug_root_analysis.tsv",
        help="Output TSV path for debug root analysis",
    )
    parser.add_argument(
        "--debug-max-legal-analyze",
        type=int,
        default=30,
        help="Maximum legal moves to analyze in debug root analysis",
    )
    parser.add_argument("--engine-threads", type=int, default=None, help="USI engine Threads option")
    parser.add_argument("--engine-hash", type=int, default=None, help="USI engine Hash or USI_Hash option")
    parser.add_argument("--engine-multipv", type=int, default=None, help="USI engine MultiPV or USI_MultiPV option")
    parser.add_argument("--engine-eval-dir", type=str, default=None, help="USI engine EvalDir option")
    parser.add_argument("--debug-usi-log", type=str, default=None, help="Save debug-mode USI commands and engine replies")
    return parser.parse_args()


def _resolve_mode(args: argparse.Namespace) -> bool:
    if args.dry_run and args.insert:
        raise SystemExit("Choose only one of --dry-run or --insert")
    return not args.insert


def _write_outputs(records: list[dict[str, object]]) -> None:
    output_dir = Path("outputs")
    json_records = [{"name": record["name"], "draft": record["draft"]} for record in records]
    write_json(json_records, output_dir / "petashock_generated.json")
    tsv_records = [{"name": record["name"], **record["tsv_row"]} for record in records]
    write_tsv(tsv_records, output_dir / "petashock_generated.tsv")
    write_sql(records, output_dir / "petashock_generated_insert.sql")


def _clear_insert_outputs() -> None:
    output_dir = Path("outputs")
    for file_name in ("petashock_generated.jsonl", "petashock_generated.tsv", "petashock_generated_insert.sql"):
        output_path = output_dir / file_name
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if output_path.exists():
            output_path.unlink()


def _append_insert_outputs(records: list[dict[str, object]]) -> None:
    output_dir = Path("outputs")
    jsonl_records = [{"name": record["name"], "draft": record["draft"]} for record in records]
    append_jsonl(jsonl_records, output_dir / "petashock_generated.jsonl")
    tsv_records = [{"name": record["name"], **record["tsv_row"]} for record in records]
    append_tsv(tsv_records, output_dir / "petashock_generated.tsv")
    append_sql(records, output_dir / "petashock_generated_insert.sql")


def _print_debug_root_summary(summary: dict[str, object], output_path: Path) -> None:
    print("Debug root analysis")
    print(f"rootTurn={summary['rootTurn']}")
    print(f"correct={summary['correct']}")
    print(f"correctBlackEvalCp={summary['correctBlackEvalCp']}")
    print(f"correctAnswererEvalCp={summary['correctAnswererEvalCp']}")
    print(f"analyzedLegalCandidates={summary['analyzedLegalCandidates']}")
    print(f"acceptedDiffCandidates={summary['acceptedDiffCandidates']}")
    print(f"selectedIncorrect1={summary['selectedIncorrect1']}")
    print(f"selectedIncorrect2={summary['selectedIncorrect2']}")
    print(f"output={output_path}")


def _run_debug_root_analysis(args: argparse.Namespace) -> int:
    if args.book_type != "qhapaq":
        raise SystemExit("--debug-root-sfen requires --book-type qhapaq")
    if args.engine is None:
        raise SystemExit("--engine is required for --debug-root-sfen")
    if args.depth < 1:
        raise SystemExit("--depth must be >= 1")
    if args.min_line_moves < 1 or args.max_line_moves < 1:
        raise SystemExit("--max-line-moves and --min-line-moves must be >= 1")
    if args.min_line_moves > args.max_line_moves:
        raise SystemExit("--min-line-moves must be <= --max-line-moves")
    if args.debug_max_legal_analyze < 1:
        raise SystemExit("--debug-max-legal-analyze must be >= 1")
    if args.debug_root_sfen is None:
        raise SystemExit("--debug-root-sfen is required")

    rows, summary = debug_qhapaq_legal_root_analysis(
        book_path=args.book,
        engine_path=args.engine,
        root_sfen=args.debug_root_sfen,
        depth=args.depth,
        min_diff=args.min_diff,
        max_diff=args.max_diff,
        incorrect_selection=args.incorrect_selection,
        debug_max_legal_analyze=args.debug_max_legal_analyze,
        correct_usi=args.debug_correct_usi,
        random_seed=args.random_seed,
        max_line_moves=args.max_line_moves,
        min_line_moves=args.min_line_moves,
        engine_threads=args.engine_threads,
        engine_hash=args.engine_hash,
        engine_multipv=args.engine_multipv,
        engine_eval_dir=args.engine_eval_dir,
        debug_usi_log_path=args.debug_usi_log,
    )

    output_path = Path(args.debug_output)
    fieldnames = [
        "role",
        "usi",
        "label",
        "enginePath",
        "engineThreads",
        "engineHash",
        "engineMultiPV",
        "engineEvalDir",
        "usiGoCommand",
        "rootTurn",
        "afterTurn",
        "rawScoreCp",
        "blackEvalCp",
        "answererEvalCp",
        "bestmove",
        "scoreCp",
        "depth",
        "diffFromCorrect",
        "isDiffAccepted",
        "line",
        "lineLength",
        "skipReason",
    ]
    write_tsv_with_fieldnames(rows, output_path, fieldnames)
    _print_debug_root_summary(summary, output_path)
    return 0


def _print_qhapaq_legal_summary(stats: QhapaqLegalRunStats) -> None:
    print("Qhapaq legal summary:")
    print(f"scannedPositions={stats.scanned_positions}")
    print(f"acceptedProblems={stats.accepted_problems}")
    print(f"skippedCorrectAnalysisFailed={stats.skipped_correct_analysis_failed}")
    print(f"skippedNotEnoughLegalCandidates={stats.skipped_not_enough_legal_candidates}")
    print(f"skippedNotEnoughDiffCandidates={stats.skipped_not_enough_diff_candidates}")
    print(f"skippedLineTooShort={stats.skipped_line_too_short}")
    print(f"totalAnalyzedLegalCandidates={stats.total_analyzed_legal_candidates}")
    print(f"totalCorrectAnalyses={stats.total_correct_analyses}")
    print(f"elapsedSeconds={int(round(stats.elapsed_seconds))}")


def _load_state(state_path: Path, book_path: str) -> tuple[int, int, set[int]]:
    start_index = 0
    generated_count = 0
    used_position_indexes: set[int] = set()
    if state_path.exists():
        try:
            state_data = json.loads(state_path.read_text(encoding="utf-8"))
            if state_data.get("bookPath") == book_path:
                start_index = int(state_data.get("lastScannedPositionIndex", 0))
                generated_count = int(state_data.get("generatedCount", 0))
                used_position_indexes = {
                    int(position_index)
                    for position_index in state_data.get("usedPositionIndexes", [])
                }
        except Exception:
            start_index = 0
            generated_count = 0
            used_position_indexes = set()
    return start_index, generated_count, used_position_indexes


def _write_state(
    path: Path,
    book_path: str,
    last_index: int | None,
    generated_count: int,
    used_position_indexes: set[int],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "bookPath": book_path,
        "generatedCount": int(generated_count),
        "usedPositionIndexes": sorted(int(position_index) for position_index in used_position_indexes),
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    if last_index is not None:
        payload["lastScannedPositionIndex"] = int(last_index)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _insert_batch(writer: SupabaseWriter, records: list[dict[str, object]], batch_label: str) -> int:
    filtered_rows: list[dict[str, object]] = []
    for record in records:
        name = record["name"]
        assert isinstance(name, str)
        if writer.name_exists(name):
            print(f"skip existing workspace name: {name}")
            continue
        filtered_rows.append({"id": str(uuid.uuid4()), "name": name, "draft": record["draft"]})

    print(f"Inserting batch {batch_label}: {len(filtered_rows)} rows")
    try:
        inserted = writer.insert_rows(filtered_rows)
    except Exception as exc:
        raise RuntimeError(f"Failed to insert batch {batch_label}") from exc
    print(f"Inserted batch {batch_label}")
    return inserted


def _run_insert_batches(
    args: argparse.Namespace,
    writer: SupabaseWriter,
    start_index: int,
    generated_count: int,
    name_start: int,
    book_index_path: Path,
    state_file: Path,
    used_position_indexes: set[int] | None = None,
    qhapaq_legal_stats: QhapaqLegalRunStats | None = None,
) -> tuple[int, int | None, int]:
    if used_position_indexes is None:
        used_position_indexes = set()

    total_batches = max(1, (args.count + args.batch_size - 1) // args.batch_size)
    remaining = args.count
    batch_index = 0
    inserted_total = 0
    current_start_index = start_index
    current_generated_count = generated_count
    current_name_start = name_start
    current_last_index: int | None = None

    while remaining > 0:
        batch_index += 1
        target_count = min(args.batch_size, remaining)
        print(f"Generating batch {batch_index}/{total_batches}: target {target_count} problems")

        batch_name_start = current_name_start
        problems, last_scanned_index = build_problems(
            book_path=args.book,
            engine_path=args.engine,
            count=target_count,
            depth=args.depth,
            name_prefix=args.name_prefix,
            name_start=batch_name_start,
            min_diff=args.min_diff,
            max_line_moves=args.max_line_moves,
            min_line_moves=args.min_line_moves,
            incorrect_selection=args.incorrect_selection,
            random_seed=args.random_seed,
            limit_scan=args.limit_scan,
            start_index=current_start_index,
            scan_mode=args.scan_mode,
            book_index_path=book_index_path,
            used_position_indexes=used_position_indexes,
            book_type=args.book_type,
            incorrect_source=args.incorrect_source,
            max_diff=args.max_diff,
            qhapaq_legal_stats=qhapaq_legal_stats,
            verbose_skip_log=args.verbose_skip_log,
        )

        if not problems:
            print(f"Generated batch {batch_index}/{total_batches}: 0 problems")
            break

        records = [{"name": problem.name, "draft": problem.draft, "tsv_row": problem.tsv_row} for problem in problems]
        print(f"Generated batch {batch_index}/{total_batches}: {len(records)} problems")
        print(f"Inserting batch {batch_index}/{total_batches}: {len(records)} rows")

        inserted_total += _insert_batch(writer, records, f"{batch_index}/{total_batches}")
        _append_insert_outputs(records)

        current_generated_count += len(records)
        current_name_start += len(records)
        current_start_index = last_scanned_index
        current_last_index = last_scanned_index
        if args.scan_mode == "random":
            used_position_indexes.update(int(record["tsv_row"]["positionIndex"]) for record in records)
            state_last_index: int | None = None
        else:
            state_last_index = current_start_index
        _write_state(
            state_file,
            args.book,
            state_last_index,
            current_generated_count,
            used_position_indexes,
        )
        print(
            f"Updated state: generatedCount={current_generated_count}, "
            + (
                f"lastScannedPositionIndex={current_start_index}"
                if args.scan_mode != "random"
                else f"usedPositionIndexes={len(used_position_indexes)}"
            )
        )

        remaining -= len(records)
        if len(records) < target_count:
            break

    return inserted_total, current_last_index, current_generated_count


def main() -> int:
    args = parse_args()
    
    # Determine book index and state file paths
    default_book_index_path, default_state_file = _get_default_paths(args.book_type)
    book_index_path = Path(args.book_index_file) if args.book_index_file else Path(default_book_index_path)
    state_file = Path(args.state_file) if args.state_file else Path(default_state_file)

    if args.debug_root_sfen is not None:
        return _run_debug_root_analysis(args)
    
    dry_run = _resolve_mode(args)
    if args.build_book_index:
        build_book_index(args.book, book_index_path)
        print(f"wrote book index to {book_index_path}")
        return 0

    if args.engine is None:
        raise SystemExit("--engine is required unless --build-book-index is used")
    if args.count is None:
        raise SystemExit("--count is required unless --build-book-index is used")
    if args.name_prefix is None:
        raise SystemExit("--name-prefix is required unless --build-book-index is used")
    if args.max_line_moves < 1 or args.min_line_moves < 1:
        raise SystemExit("--max-line-moves and --min-line-moves must be >= 1")
    if args.min_line_moves > args.max_line_moves:
        raise SystemExit("--min-line-moves must be <= --max-line-moves")
    if args.depth < 1:
        raise SystemExit("--depth must be >= 1")
    if args.batch_size < 1:
        raise SystemExit("--batch-size must be >= 1")
    start_index, state_generated_count, used_position_indexes = _load_state(state_file, args.book)

    if args.name_start is None:
        name_start = state_generated_count + 1
    else:
        if args.name_start < 1:
            raise SystemExit("--name-start must be >= 1")
        name_start = args.name_start

    if args.scan_mode == "random" and not book_index_path.exists():
        raise SystemExit(f"{book_index_path} does not exist. Run --build-book-index first.")

    qhapaq_legal_stats = None
    if args.book_type == "qhapaq" and args.incorrect_source == "legal":
        qhapaq_legal_stats = QhapaqLegalRunStats()

    if dry_run:
        problems, last_scanned_index = build_problems(
            book_path=args.book,
            engine_path=args.engine,
            count=args.count,
            depth=args.depth,
            name_prefix=args.name_prefix,
            name_start=name_start,
            min_diff=args.min_diff,
            max_line_moves=args.max_line_moves,
            min_line_moves=args.min_line_moves,
            incorrect_selection=args.incorrect_selection,
            random_seed=args.random_seed,
            limit_scan=args.limit_scan,
            start_index=start_index,
            scan_mode=args.scan_mode,
            book_index_path=book_index_path,
            used_position_indexes=used_position_indexes,
            book_type=args.book_type,
            incorrect_source=args.incorrect_source,
            max_diff=args.max_diff,
            qhapaq_legal_stats=qhapaq_legal_stats,
            verbose_skip_log=args.verbose_skip_log,
        )

        records = [{"name": problem.name, "draft": problem.draft, "tsv_row": problem.tsv_row} for problem in problems]
        _write_outputs(records)
        print(f"wrote {len(records)} records to outputs/")
        if args.update_state:
            if args.scan_mode == "random":
                state_last_index: int | None = None
            else:
                state_last_index = last_scanned_index
            _write_state(
                state_file,
                args.book,
                state_last_index,
                state_generated_count + len(records),
                used_position_indexes,
            )
        if qhapaq_legal_stats is not None:
            qhapaq_legal_stats.finish()
            _print_qhapaq_legal_summary(qhapaq_legal_stats)
        return 0

    load_env_file()
    writer = SupabaseWriter.from_environment()
    _clear_insert_outputs()
    inserted_total, last_scanned_index, final_generated_count = _run_insert_batches(
        args,
        writer,
        start_index=start_index,
        generated_count=state_generated_count,
        name_start=name_start,
        book_index_path=book_index_path,
        state_file=state_file,
        used_position_indexes=used_position_indexes,
        qhapaq_legal_stats=qhapaq_legal_stats,
    )
    print(f"inserted {inserted_total} records into Supabase")
    if qhapaq_legal_stats is not None:
        qhapaq_legal_stats.finish()
        _print_qhapaq_legal_summary(qhapaq_legal_stats)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
