import "dotenv/config";
import { existsSync } from "fs";
import path from "path";

import { engineConfig } from "../../../engine-config.js";
import { envInt } from "../../../env.js";
import { createUsiEngineClient, getEnginePath, type PvInfo } from "../../../services/engine/engineClient";

type Color = "b" | "w";

const DEFAULT_POSITION =
  "position sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1 moves 2g2f 3c3d 7g7f 4c4d 3i4h 3a3b 2f2e 2b3c 5i6h 3b4c 4i5h 8b4b 5g5f 5a6b 6h7h 6b7b 3g3f 7b8b 6g6f 9a9b 8h7g 8b9a 5h6g 7a8b 7h8h 6a7a 2i3g 4a5b 9i9h 4c5d 6i7h 6c6d 8h9i 6d6e 6f6e 5d6e P*6f 6e7d 7i8h 5b6b 1g1f 4d4e 4h5g 3d3e 2h2f 3c4d 2e2d 2c2d 2f2d 4b2b 2d4d 3e3f 3g4e 3f3g+ 4d4a+ 2b2h+ B*5e 2h7h 6g6h 7h7g 6h7g 3g4g 4e5c+ 6b5c 4a4g N*8e 7g7h B*6i 4g3h G*4g 3h6h 6i5h+ R*5a 4g5g 6h5h 5g5h 5a5c+ 5h5g G*7i P*6g 5e4f R*5h B*3f P*4g 5c5a S*6b 3f8a+ 9a8a 5a2a 6g6h+ 7h6h 5g6h 7i6h 5h5f+ N*6d P*6a G*5b 7d6c 5b6a 7a6a 2a6a G*7a G*7b 8a9a 7b7a 8b7a N*7e G*7b 7e6c 6b6c 6d7b+";

function parsePositionCommand(command: string): { initialSfen: string; moves: string[] } {
  const trimmed = command.trim();
  const prefix = "position sfen ";
  if (!trimmed.startsWith(prefix)) {
    throw new Error("position command must start with 'position sfen '");
  }

  const body = trimmed.slice(prefix.length);
  const marker = " moves ";
  const markerIndex = body.indexOf(marker);
  if (markerIndex < 0) {
    return { initialSfen: body.trim(), moves: [] };
  }

  return {
    initialSfen: body.slice(0, markerIndex).trim(),
    moves: body.slice(markerIndex + marker.length).trim().split(/\s+/).filter(Boolean),
  };
}

function positionCommand(initialSfen: string, moves: string[]): string {
  return moves.length === 0 ? `position sfen ${initialSfen}` : `position sfen ${initialSfen} moves ${moves.join(" ")}`;
}

function getInitialTurn(initialSfen: string): Color {
  const turn = initialSfen.trim().split(/\s+/)[1];
  if (turn !== "b" && turn !== "w") throw new Error(`invalid initial sfen turn: ${initialSfen}`);
  return turn;
}

function turnAfterPlies(initialTurn: Color, plies: number): Color {
  return plies % 2 === 0 ? initialTurn : initialTurn === "b" ? "w" : "b";
}

function normalizeToSente(rawCp: number | null, turn: Color): number | null {
  if (rawCp == null) return null;
  return turn === "b" ? rawCp : -rawCp;
}

function pickBestCp(infos: PvInfo[]): PvInfo | null {
  const best = [...infos].sort((a, b) => a.multipv - b.multipv)[0];
  if (!best || best.evalType !== "cp") return null;
  return best;
}

function absLossFromBest(bestSente: number | null, actualSente: number | null, turn: Color): number | null {
  if (bestSente == null || actualSente == null) return null;
  const signed = turn === "b" ? bestSente - actualSente : actualSente - bestSente;
  return Math.abs(signed);
}

function resolveEngineEvalDir(enginePath: string): string {
  const fromEnv = process.env.EVAL_DIR?.trim();
  if (fromEnv) return fromEnv;

  const candidates = [
    path.join(path.dirname(enginePath), "eval"),
    path.join(path.dirname(enginePath), "..", "eval"),
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, "nn.bin")))
    ?? candidates.find((candidate) => existsSync(candidate))
    ?? candidates[0];
}

function value(value: unknown): string {
  return value == null ? "" : String(value);
}

async function main() {
  const command = process.argv.slice(2).join(" ").trim() || process.env.AMTS_COMPARE_POSITION || DEFAULT_POSITION;
  const { initialSfen, moves } = parsePositionCommand(command);
  const depth = envInt("AMTS_COMPARE_DEPTH", envInt("AMTS_SCAN_DEPTH", 16, 1, 80), 1, 80);
  const startRow = envInt("AMTS_COMPARE_START_ROW", 1, 1, Math.max(1, moves.length));
  const endRow = envInt("AMTS_COMPARE_END_ROW", moves.length, 1, Math.max(1, moves.length));

  const enginePath = process.env.ENGINE_PATH?.trim() || getEnginePath();
  const engineEvalDir = resolveEngineEvalDir(enginePath);
  const engine = createUsiEngineClient(enginePath, engineEvalDir);

  console.error(`[compare] enginePath=${enginePath} exists=${existsSync(enginePath)}`);
  console.error(`[compare] engineEvalDir=${engineEvalDir} exists=${existsSync(engineEvalDir)}`);
  console.error(`[compare] depth=${depth} rows=${startRow}-${endRow}`);
  console.error(`[compare] position sfen ${initialSfen} moves ${moves.join(" ")}`);

  await engine.init({
    multipv: 1,
    disableBook: !engineConfig.ownBook,
    threads: engineConfig.threads,
    hashMb: engineConfig.hashMb,
    ponder: engineConfig.ponder,
  });

  const initialTurn = getInitialTurn(initialSfen);
  let previousAfterSente: number | null = null;

  try {
    const start = await engine.analyze({
      positionCommand: positionCommand(initialSfen, []),
      depth,
      pvPlies: 4,
      label: "compare-start",
    });
    const startBest = pickBestCp(start.infos);
    previousAfterSente = normalizeToSente(startBest?.eval ?? null, initialTurn);

    console.log(
      [
        "row",
        "move",
        "turnBefore",
        "bestMoveBefore",
        "rawBestBefore",
        "senteBestBefore",
        "rawActualSearch",
        "senteActualSearch",
        "pass1Loss",
        "rawAfterMove",
        "senteAfterMove",
        "afterDelta",
      ].join("\t")
    );
    console.log(["0", "start", initialTurn, startBest?.pv[0] ?? "", startBest?.eval ?? "", previousAfterSente ?? "", "", "", "", startBest?.eval ?? "", previousAfterSente ?? "", ""].join("\t"));

    for (let row = startRow; row <= endRow; row++) {
      const move = moves[row - 1];
      const beforeMoves = moves.slice(0, row - 1);
      const afterMoves = moves.slice(0, row);
      const turnBefore = turnAfterPlies(initialTurn, row - 1);
      const turnAfter = turnAfterPlies(initialTurn, row);

      const bestBeforeResult = await engine.analyze({
        positionCommand: positionCommand(initialSfen, beforeMoves),
        depth,
        pvPlies: 4,
        label: `compare-row-${row}-best-before`,
      });
      const bestBefore = pickBestCp(bestBeforeResult.infos);
      const bestBeforeSente = normalizeToSente(bestBefore?.eval ?? null, turnBefore);

      const actualSearchResult = await engine.analyze({
        positionCommand: positionCommand(initialSfen, beforeMoves),
        depth,
        pvPlies: 4,
        searchMoves: [move],
        label: `compare-row-${row}-actual-search`,
      });
      const actualSearch = pickBestCp(actualSearchResult.infos);
      const actualSearchSente = normalizeToSente(actualSearch?.eval ?? null, turnBefore);

      const afterResult = await engine.analyze({
        positionCommand: positionCommand(initialSfen, afterMoves),
        depth,
        pvPlies: 4,
        label: `compare-row-${row}-after`,
      });
      const after = pickBestCp(afterResult.infos);
      const afterSente = normalizeToSente(after?.eval ?? null, turnAfter);
      const afterDelta = afterSente == null || previousAfterSente == null ? null : afterSente - previousAfterSente;

      console.log(
        [
          row,
          move,
          turnBefore,
          bestBefore?.pv[0] ?? "",
          bestBefore?.eval ?? "",
          bestBeforeSente,
          actualSearch?.eval ?? "",
          actualSearchSente,
          absLossFromBest(bestBeforeSente, actualSearchSente, turnBefore),
          after?.eval ?? "",
          afterSente,
          afterDelta,
        ].map(value).join("\t")
      );

      previousAfterSente = afterSente;
    }
  } finally {
    await engine.quit();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
