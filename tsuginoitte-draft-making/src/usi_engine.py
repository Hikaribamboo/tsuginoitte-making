from __future__ import annotations

import queue
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass(frozen=True)
class EngineAnalysis:
    bestmove: str
    score_cp: Optional[int]
    depth: Optional[int]
    pv: list[str]
    raw_score_cp: Optional[int] = None


class UsiEngine:
    def __init__(
        self,
        engine_path: str | Path,
        *,
        engine_threads: Optional[int] = None,
        engine_hash: Optional[int] = None,
        engine_multipv: Optional[int] = None,
        engine_eval_dir: Optional[str] = None,
        debug_usi_log_path: str | Path | None = None,
    ) -> None:
        self._engine_path = Path(engine_path).resolve()
        self._process: subprocess.Popen[str] | None = None
        self._stdout_queue: queue.Queue[str | None] = queue.Queue()
        self._reader_thread: threading.Thread | None = None
        self._supported_option_names: set[str] = set()
        self._engine_threads = engine_threads
        self._engine_hash = engine_hash
        self._engine_multipv = engine_multipv
        self._engine_eval_dir = engine_eval_dir
        self._debug_usi_log_path = Path(debug_usi_log_path) if debug_usi_log_path is not None else None
        self._debug_usi_log_lock = threading.Lock()
        self._start_process()

    def _start_process(self) -> None:
        if not self._engine_path.exists():
            raise FileNotFoundError(self._engine_path)

        self._process = subprocess.Popen(
            [str(self._engine_path)],
            cwd=str(self._engine_path.parent),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        self._stdout_queue = queue.Queue()
        self._reader_thread = threading.Thread(target=self._read_stdout, daemon=True)
        self._reader_thread.start()
        self._handshake()

    def _read_stdout(self) -> None:
        assert self._process is not None
        assert self._process.stdout is not None
        for line in self._process.stdout:
            self._stdout_queue.put(line.rstrip("\r\n"))
        self._stdout_queue.put(None)

    def _log_debug_line(self, prefix: str, line: str) -> None:
        if self._debug_usi_log_path is None:
            return
        self._debug_usi_log_path.parent.mkdir(parents=True, exist_ok=True)
        with self._debug_usi_log_lock:
            with self._debug_usi_log_path.open("a", encoding="utf-8", newline="") as handle:
                handle.write(f"{prefix} {line}\n")

    def _send(self, command: str) -> None:
        if self._process is None or self._process.stdin is None:
            raise RuntimeError("Engine process is not running")
        self._log_debug_line(">>", command)
        self._process.stdin.write(command + "\n")
        self._process.stdin.flush()

    def _wait_for(self, predicate, timeout: float) -> list[str]:
        lines: list[str] = []
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Timed out waiting for engine response")
            try:
                line = self._stdout_queue.get(timeout=remaining)
            except queue.Empty as exc:  # pragma: no cover - defensive
                raise TimeoutError("Timed out waiting for engine response") from exc
            if line is None:
                raise RuntimeError("Engine process exited unexpectedly")
            lines.append(line)
            if line.startswith("info ") or line.startswith("bestmove"):
                self._log_debug_line("<<", line)
            if predicate(line):
                return lines

    @staticmethod
    def _parse_option_name(line: str) -> Optional[str]:
        if not line.startswith("option name "):
            return None
        option_text = line[len("option name ") :]
        if " type " in option_text:
            return option_text.split(" type ", 1)[0]
        return option_text.strip() or None

    def _read_usi_options(self, timeout: float = 15.0) -> None:
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Timed out waiting for usiok")
            try:
                line = self._stdout_queue.get(timeout=remaining)
            except queue.Empty as exc:  # pragma: no cover - defensive
                raise TimeoutError("Timed out waiting for usiok") from exc
            if line is None:
                raise RuntimeError("Engine process exited unexpectedly")
            option_name = self._parse_option_name(line)
            if option_name is not None:
                self._supported_option_names.add(option_name)
                continue
            if line == "usiok":
                return

    def _send_requested_options(self) -> None:
        if self._engine_threads is not None and "Threads" in self._supported_option_names:
            self._send(f"setoption name Threads value {self._engine_threads}")

        hash_option_name: Optional[str] = None
        if self._engine_hash is not None:
            if "Hash" in self._supported_option_names:
                hash_option_name = "Hash"
            elif "USI_Hash" in self._supported_option_names:
                hash_option_name = "USI_Hash"
        if hash_option_name is not None:
            self._send(f"setoption name {hash_option_name} value {self._engine_hash}")

        multipv_option_name: Optional[str] = None
        if self._engine_multipv is not None:
            if "MultiPV" in self._supported_option_names:
                multipv_option_name = "MultiPV"
            elif "USI_MultiPV" in self._supported_option_names:
                multipv_option_name = "USI_MultiPV"
        if multipv_option_name is not None:
            self._send(f"setoption name {multipv_option_name} value {self._engine_multipv}")

        if self._engine_eval_dir is not None and "EvalDir" in self._supported_option_names:
            self._send(f"setoption name EvalDir value {self._engine_eval_dir}")

    def _handshake(self) -> None:
        self._send("usi")
        self._read_usi_options(timeout=15.0)
        self._send_requested_options()
        self._send("isready")
        self._wait_for(lambda line: line == "readyok", timeout=15.0)
        self._send("usinewgame")

    @staticmethod
    def _parse_info_line(line: str) -> tuple[Optional[int], Optional[int], list[str]]:
        score_cp: Optional[int] = None
        depth: Optional[int] = None
        pv: list[str] = []
        tokens = line.split()
        index = 0
        while index < len(tokens):
            token = tokens[index]
            if token == "depth" and index + 1 < len(tokens):
                try:
                    depth = int(tokens[index + 1])
                except ValueError:
                    pass
                index += 2
                continue
            if token == "score" and index + 2 < len(tokens):
                score_kind = tokens[index + 1]
                score_value = tokens[index + 2]
                if score_kind == "cp":
                    try:
                        score_cp = int(score_value)
                    except ValueError:
                        pass
                index += 3
                continue
            if token == "pv":
                pv = tokens[index + 1 :]
                break
            index += 1
        return score_cp, depth, pv

    def analyze_after_move(self, root_sfen: str, move: str, depth: int) -> EngineAnalysis:
        self._send(f"position sfen {root_sfen} moves {move}")
        self._send(f"go depth {depth}")

        required_depth = depth
        reached_required_depth = False
        last_pv: list[str] = []
        last_score_cp: Optional[int] = None
        last_depth: Optional[int] = None
        best_acceptable_pv: list[str] = []
        best_acceptable_score_cp: Optional[int] = None
        best_acceptable_depth: Optional[int] = None
        timeout_seconds = max(10.0, required_depth * 1.5)
        deadline = time.monotonic() + timeout_seconds

        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                line = self._stdout_queue.get(timeout=remaining)
            except queue.Empty:
                break
            if line is None:
                raise RuntimeError("Engine process exited unexpectedly")
            if line.startswith("info ") or line.startswith("bestmove"):
                self._log_debug_line("<<", line)
            if line.startswith("info "):
                score_cp, info_depth, pv = self._parse_info_line(line)
                if info_depth is not None and info_depth >= required_depth:
                    reached_required_depth = True
                if pv:
                    last_pv = pv
                    last_score_cp = score_cp
                    last_depth = info_depth
                if info_depth is not None and info_depth >= required_depth and pv:
                    best_acceptable_pv = pv
                    best_acceptable_score_cp = score_cp
                    best_acceptable_depth = info_depth
                continue
            if line.startswith("bestmove "):
                parts = line.split()
                bestmove = parts[1] if len(parts) > 1 else "(none)"
                # Prioritize: depth >= required_depth with pv, then depth >= required_depth with any pv
                if best_acceptable_pv:
                    return EngineAnalysis(
                        bestmove=bestmove,
                        score_cp=best_acceptable_score_cp,
                        depth=best_acceptable_depth,
                        pv=best_acceptable_pv,
                        raw_score_cp=best_acceptable_score_cp,
                    )
                if reached_required_depth and last_pv:
                    return EngineAnalysis(
                        bestmove=bestmove,
                        score_cp=last_score_cp,
                        depth=last_depth,
                        pv=last_pv,
                        raw_score_cp=last_score_cp,
                    )
                if not reached_required_depth:
                    raise ValueError("Required depth was not reached")
                raise ValueError("No PV was returned")
            if line == "bestmove":
                if best_acceptable_pv:
                    return EngineAnalysis(
                        bestmove="(none)",
                        score_cp=best_acceptable_score_cp,
                        depth=best_acceptable_depth,
                        pv=best_acceptable_pv,
                        raw_score_cp=best_acceptable_score_cp,
                    )
                if reached_required_depth and last_pv:
                    return EngineAnalysis(
                        bestmove="(none)",
                        score_cp=last_score_cp,
                        depth=last_depth,
                        pv=last_pv,
                        raw_score_cp=last_score_cp,
                    )
                if not reached_required_depth:
                    raise ValueError("Required depth was not reached")
                raise ValueError("No PV was returned")

        self._send("stop")
        stop_deadline = time.monotonic() + 2.0
        while True:
            remaining = stop_deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Timed out waiting for bestmove after stop")
            try:
                line = self._stdout_queue.get(timeout=remaining)
            except queue.Empty as exc:  # pragma: no cover - defensive
                raise TimeoutError("Timed out waiting for bestmove after stop") from exc
            if line is None:
                raise RuntimeError("Engine process exited unexpectedly")
            if line.startswith("info ") or line.startswith("bestmove"):
                self._log_debug_line("<<", line)
            if line.startswith("info "):
                score_cp, info_depth, pv = self._parse_info_line(line)
                if info_depth is not None and info_depth >= required_depth:
                    reached_required_depth = True
                if pv:
                    last_pv = pv
                    last_score_cp = score_cp
                    last_depth = info_depth
                if info_depth is not None and info_depth >= required_depth and pv:
                    best_acceptable_pv = pv
                    best_acceptable_score_cp = score_cp
                    best_acceptable_depth = info_depth
                continue
            if line.startswith("bestmove "):
                parts = line.split()
                bestmove = parts[1] if len(parts) > 1 else "(none)"
                if best_acceptable_pv:
                    return EngineAnalysis(
                        bestmove=bestmove,
                        score_cp=best_acceptable_score_cp,
                        depth=best_acceptable_depth,
                        pv=best_acceptable_pv,
                        raw_score_cp=best_acceptable_score_cp,
                    )
                if reached_required_depth and last_pv:
                    return EngineAnalysis(
                        bestmove=bestmove,
                        score_cp=last_score_cp,
                        depth=last_depth,
                        pv=last_pv,
                        raw_score_cp=last_score_cp,
                    )
                if not reached_required_depth:
                    raise ValueError("Required depth was not reached")
                raise ValueError("No PV was returned")
            if line == "bestmove":
                if best_acceptable_pv:
                    return EngineAnalysis(
                        bestmove="(none)",
                        score_cp=best_acceptable_score_cp,
                        depth=best_acceptable_depth,
                        pv=best_acceptable_pv,
                        raw_score_cp=best_acceptable_score_cp,
                    )
                if reached_required_depth and last_pv:
                    return EngineAnalysis(
                        bestmove="(none)",
                        score_cp=last_score_cp,
                        depth=last_depth,
                        pv=last_pv,
                        raw_score_cp=last_score_cp,
                    )
                if not reached_required_depth:
                    raise ValueError("Required depth was not reached")
                raise ValueError("No PV was returned")

    def close(self) -> None:
        if self._process is None:
            return
        try:
            if self._process.poll() is None:
                try:
                    self._send("quit")
                except Exception:
                    pass
                try:
                    self._process.wait(timeout=2.0)
                except subprocess.TimeoutExpired:
                    self._process.kill()
        finally:
            self._process = None

    def __enter__(self) -> "UsiEngine":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()
