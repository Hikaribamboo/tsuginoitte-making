import "dotenv/config";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { createUsiEngineClient, getEnginePath, type EngineClient, type PvInfo } from "../../../services/engine/engineClient";
import { config } from "../../kif-problem-generation/config";
import { cpToWinRatePercentFromRootSfen } from "../../kif-problem-generation/evaluation/cpToWinRate";
import { createChoiceLabel } from "../../kif-problem-generation/label/createChoiceLabel";
import { normalizeCpToSentePerspective } from "../../kif-problem-generation/problem/rootEval";
import { parseSfen } from "../../kif-problem-generation/shogi/sfenEngine";

type Color = "b" | "w";

type ChoiceDraft = {
  slotLabel: "correct" | "incorrect1" | "incorrect2";
  usi: string;
  label: string;
  explanation: string;
  line: string[];
  eval_cp: number | null;
  eval_percent: number | null;
};

type GeneratedRecord = {
  name: string;
  draft: Record<string, unknown>;
};

const BOOK_FILES = {
  qhapaq: {
    label: "Qhapaq定跡",
    fileName: "standard_book_alora.db",
    stateName: "qhapaq",
  },
  "sanken-shiken": {
    label: "三間四間飛車",
    fileName: "sanken-shiken.db",
    stateName: "sanken-shiken",
  },
} as const;

type BookFileKey = keyof typeof BOOK_FILES;

type CursorState = {
  version: 1;
  bookPath: string;
  step: number;
  nextSfenOrdinal: number;
  updatedAt: string;
};

type Summary = {
  attemptedCount: number;
  createdCount: number;
  skippedCount: number;
  startSfenOrdinal: number;
  nextSfenOrdinal: number;
  totalSfenCount: number;
};

const BOOK_STEP = 100;
const FINAL_DEPTH = 26;
const WRONG_PROBE_DEPTH = 18;
const WRONG_PROBE_MULTIPV = 16;
const PV_PLIES = 9;
const PROMPT = "最善手を選んでください";

const featureDir = path.resolve(import.meta.dirname, "..");
const defaultOutputPath = path.resolve(process.cwd(), "outputs", "book_generated.json");

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function resolveBookFile(raw: string | undefined): {
  key: BookFileKey;
  label: string;
  bookPath: string;
  statePath: string;
} {
  const key = raw && raw in BOOK_FILES ? (raw as BookFileKey) : "qhapaq";
  const book = BOOK_FILES[key];

  return {
    key,
    label: book.label,
    bookPath: path.join(featureDir, "books", book.fileName),
    statePath: path.join(featureDir, "state", `${book.stateName}.cursor.json`),
  };
}

function getTurnFromSfen(sfen: string): Color {
  const turn = sfen.trim().split(/\s+/)[1];
  if (turn !== "b" && turn !== "w") {
    throw new Error(`invalid turn in sfen: ${sfen}`);
  }
  return turn;
}

function buildPositionCommand(sfen: string): string {
  return `position sfen ${sfen}`;
}

function pickBestCpInfo(infos: PvInfo[]): PvInfo | null {
  const best = [...infos].sort((a, b) => a.multipv - b.multipv)[0];
  if (!best || best.evalType !== "cp") return null;
  if (!best.pv[0]) return null;
  return best;
}

function uniqCpInfosByMove(infos: PvInfo[]): PvInfo[] {
  const seen = new Set<string>();
  const out: PvInfo[] = [];

  for (const info of infos) {
    const usi = info.pv[0];
    if (!usi || info.evalType !== "cp") continue;
    if (seen.has(usi)) continue;
    seen.add(usi);
    out.push(info);
  }

  return out;
}

function lossFromBest(args: {
  bestEvalSente: number;
  candidateEvalSente: number;
  turn: Color;
}): number {
  const { bestEvalSente, candidateEvalSente, turn } = args;
  return turn === "b" ? bestEvalSente - candidateEvalSente : candidateEvalSente - bestEvalSente;
}

function pvLineUpTo8(info: PvInfo): string[] | null {
  const line = info.pv.slice(1, 9);
  return line.length > 0 ? line : null;
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

async function readCursor(statePath: string, bookPath: string): Promise<CursorState> {
  try {
    const raw = await readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CursorState>;
    const nextSfenOrdinal =
      typeof parsed.nextSfenOrdinal === "number" && Number.isInteger(parsed.nextSfenOrdinal) && parsed.nextSfenOrdinal >= 0
        ? parsed.nextSfenOrdinal
        : 0;

    if (parsed.bookPath && path.resolve(parsed.bookPath) !== path.resolve(bookPath)) {
      return {
        version: 1,
        bookPath,
        step: BOOK_STEP,
        nextSfenOrdinal: 0,
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      version: 1,
      bookPath,
      step: BOOK_STEP,
      nextSfenOrdinal,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return {
      version: 1,
      bookPath,
      step: BOOK_STEP,
      nextSfenOrdinal: 0,
      updatedAt: new Date().toISOString(),
    };
  }
}

async function writeCursor(statePath: string, state: CursorState): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify(
      {
        ...state,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );
}

async function extractSfens(bookPath: string): Promise<string[]> {
  const raw = await readFile(bookPath, "utf-8");
  const out: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("sfen ")) continue;
    const tokens = line.slice(5).trim().split(/\s+/);
    if (tokens.length < 4) continue;
    out.push(tokens.slice(0, 4).join(" "));
  }

  return out;
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

function isFatalEngineError(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  return (
    message.includes("analyze timeout") ||
    message.includes("waitFor timeout") ||
    message.includes("engine exited") ||
    message.includes("EPIPE") ||
    message.includes("ERR_STREAM_DESTROYED")
  );
}

async function analyzeSearchMove(args: {
  engine: EngineClient;
  positionCommand: string;
  moveUsi: string;
  label: string;
}): Promise<PvInfo | null> {
  const { engine, positionCommand, moveUsi, label } = args;
  await engine.setMultiPv(1);
  const res = await engine.analyze({
    positionCommand,
    depth: FINAL_DEPTH,
    pvPlies: PV_PLIES,
    searchMoves: [moveUsi],
    label,
  });
  const info = pickBestCpInfo(res.infos);
  if (!info || info.pv[0] !== moveUsi) return null;
  return info;
}

async function buildProblemFromSfen(args: {
  engine: EngineClient;
  sfen: string;
  sfenOrdinal: number;
  minDiff: number;
  maxDiff: number;
}): Promise<{ record: GeneratedRecord | null; reason: string }> {
  const { engine, sfen, sfenOrdinal, minDiff, maxDiff } = args;
  const turn = getTurnFromSfen(sfen);
  const positionCommand = buildPositionCommand(sfen);

  await engine.setMultiPv(1);
  const bestAnalysis = await engine.analyze({
    positionCommand,
    depth: FINAL_DEPTH,
    pvPlies: PV_PLIES,
    label: `book-row${sfenOrdinal + 1}-best`,
  });
  const best = pickBestCpInfo(bestAnalysis.infos);
  if (!best) return { record: null, reason: "最善手なし" };

  const correctUsi = best.pv[0];
  const bestLine = pvLineUpTo8(best);
  if (!correctUsi || !bestLine) return { record: null, reason: "正解手の読み筋不足" };

  const bestEvalSente = normalizeCpToSentePerspective(best.eval, turn);

  await engine.setMultiPv(WRONG_PROBE_MULTIPV);
  const probe = await engine.analyze({
    positionCommand,
    depth: WRONG_PROBE_DEPTH,
    pvPlies: PV_PLIES,
    label: `book-row${sfenOrdinal + 1}-wrongProbe-d${WRONG_PROBE_DEPTH}-mp${WRONG_PROBE_MULTIPV}`,
  });

  const candidates = uniqCpInfosByMove(probe.infos)
    .map((info) => {
      const candidateEvalSente = normalizeCpToSentePerspective(info.eval, turn);
      return {
        usi: info.pv[0]!,
        diff: lossFromBest({ bestEvalSente, candidateEvalSente, turn }),
      };
    })
    .filter((candidate) => candidate.usi !== correctUsi && candidate.diff >= minDiff && candidate.diff <= maxDiff);

  shuffleInPlace(candidates);

  const incorrects: PvInfo[] = [];
  const usedMoves = new Set<string>([correctUsi]);

  for (const candidate of candidates) {
    if (incorrects.length >= 2) break;
    if (usedMoves.has(candidate.usi)) continue;
    usedMoves.add(candidate.usi);

    const finalInfo = await analyzeSearchMove({
      engine,
      positionCommand,
      moveUsi: candidate.usi,
      label: `book-row${sfenOrdinal + 1}-wrong-${candidate.usi}`,
    });
    if (!finalInfo) continue;

    const finalEvalSente = normalizeCpToSentePerspective(finalInfo.eval, turn);
    const finalDiff = lossFromBest({ bestEvalSente, candidateEvalSente: finalEvalSente, turn });
    if (finalDiff < minDiff || finalDiff > maxDiff) continue;
    if (!pvLineUpTo8(finalInfo)) continue;

    incorrects.push(finalInfo);
  }

  if (incorrects.length < 2) {
    return {
      record: null,
      reason: `不正解手不足 candidates=${candidates.length} accepted=${incorrects.length}`,
    };
  }

  const position = parseSfen(sfen);
  const stateForLabel = { position, lastMoveTo: null };
  const rootEvalCp = bestEvalSente;
  const rootEvalPercent = cpToWinRatePercentFromRootSfen({
    cp: rootEvalCp,
    rootSfen: sfen,
    scale: config.eval.scale,
  });

  const toChoice = (slotLabel: ChoiceDraft["slotLabel"], info: PvInfo): ChoiceDraft => ({
    slotLabel,
    usi: info.pv[0]!,
    label: createChoiceLabel({ state: stateForLabel, usi: info.pv[0]! }),
    explanation: "",
    line: pvLineUpTo8(info) ?? [],
    eval_cp: normalizeCpToSentePerspective(info.eval, turn),
    eval_percent: cpToWinRatePercentFromRootSfen({
      cp: normalizeCpToSentePerspective(info.eval, turn),
      rootSfen: sfen,
      scale: config.eval.scale,
    }),
  });

  return {
    record: {
      name: `Book_${String(sfenOrdinal + 1).padStart(6, "0")}`,
      draft: {
        kifText: "",
        rootSfen: sfen,
        kifMoves: [],
        introMoveUsi: "",
        introMovesUsi: [],
        choices: {
          correct: toChoice("correct", best),
          incorrect1: toChoice("incorrect1", incorrects[0]!),
          incorrect2: toChoice("incorrect2", incorrects[1]!),
        },
        readingLineInputs: {
          correct: "",
          incorrect1: "",
          incorrect2: "",
        },
        prompt: PROMPT,
        tags: ["book"],
        displayNo: null,
        problemRating: 1500,
        rootEvalCp,
        rootEvalPercent,
        mode: "next_move",
        savedAt: new Date().toISOString(),
      },
    },
    reason: "OK",
  };
}

export async function main(): Promise<void> {
  const selectedBook = resolveBookFile(process.env.AMTS_BOOK_FILE?.trim());
  const bookPath = path.resolve(process.env.AMTS_BOOK_PATH?.trim() || selectedBook.bookPath);
  const statePath = path.resolve(process.env.AMTS_BOOK_STATE_FILE?.trim() || selectedBook.statePath);
  const outputPath = path.resolve(process.env.AMTS_BOOK_OUTPUT_PATH?.trim() || defaultOutputPath);
  const count = envInt("AMTS_BOOK_COUNT", 10, 1, 100000);
  const minDiff = envInt("AMTS_BOOK_MIN_DIFF", 100, 1, 100000);
  const maxDiff = envInt("AMTS_BOOK_MAX_DIFF", 600, 1, 100000);

  if (maxDiff < minDiff) {
    throw new Error(`maxDiff must be >= minDiff: minDiff=${minDiff} maxDiff=${maxDiff}`);
  }

  const sfens = await extractSfens(bookPath);
  const cursor = await readCursor(statePath, bookPath);
  const startSfenOrdinal = cursor.nextSfenOrdinal;

  console.log(
    `book作問開始: book=${selectedBook.label} count=${count} minDiff=${minDiff} maxDiff=${maxDiff} finalDepth=${FINAL_DEPTH} wrongProbeDepth=${WRONG_PROBE_DEPTH} wrongMp=${WRONG_PROBE_MULTIPV}`,
  );
  console.log(`book key: ${selectedBook.key}`);
  console.log(`book path: ${bookPath}`);
  console.log(`book sfen総数: ${sfens.length}`);
  console.log(`book cursor: start=${startSfenOrdinal} step=${BOOK_STEP} state=${statePath}`);

  const enginePath = process.env.ENGINE_PATH?.trim() || getEnginePath();
  const engineEvalDir = resolveEngineEvalDir(enginePath);
  const engine = createUsiEngineClient(enginePath, engineEvalDir);
  await engine.init({
    multipv: 1,
    disableBook: config.engine.disableBook,
    threads: config.engine.threads,
    hashMb: config.engine.hashMb,
    ponder: config.engine.ponder,
  });

  const records: GeneratedRecord[] = [];
  let attemptedCount = 0;
  let nextSfenOrdinal = startSfenOrdinal;

  try {
    for (let i = 0; i < count; i += 1) {
      const sfenOrdinal = nextSfenOrdinal;
      if (sfenOrdinal >= sfens.length) {
        console.log(`book終端: next=${sfenOrdinal} total=${sfens.length}`);
        break;
      }

      const sfen = sfens[sfenOrdinal]!;
      attemptedCount += 1;
      nextSfenOrdinal = sfenOrdinal + BOOK_STEP;
      await writeCursor(statePath, {
        version: 1,
        bookPath,
        step: BOOK_STEP,
        nextSfenOrdinal,
        updatedAt: new Date().toISOString(),
      });

      try {
        const result = await buildProblemFromSfen({
          engine,
          sfen,
          sfenOrdinal,
          minDiff,
          maxDiff,
        });

        if (result.record) {
          records.push(result.record);
          console.log(`book row${sfenOrdinal + 1} OK created=${records.length} sfen=${sfen}`);
        } else {
          console.log(`book row${sfenOrdinal + 1} NG reason=${result.reason} sfen=${sfen}`);
        }
      } catch (error: any) {
        const reason = String(error?.message ?? error);
        if (isFatalEngineError(error)) {
          console.error(`book row${sfenOrdinal + 1} FATAL reason=${reason} sfen=${sfen}`);
          throw new Error(`book row${sfenOrdinal + 1} engine failure: ${reason}`);
        }
        console.log(`book row${sfenOrdinal + 1} NG reason=${reason} sfen=${sfen}`);
      }
    }
  } finally {
    await engine.quit();
  }

  const summary: Summary = {
    attemptedCount,
    createdCount: records.length,
    skippedCount: attemptedCount - records.length,
    startSfenOrdinal,
    nextSfenOrdinal,
    totalSfenCount: sfens.length,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({ summary, records }, null, 2), "utf-8");

  console.log(
    `作問結果: 試行SFEN数=${summary.attemptedCount} 生成成功数=${summary.createdCount} スキップ数=${summary.skippedCount}`,
  );
  console.log(`book output: ${outputPath}`);
}

main().catch((error) => {
  console.error(`致命的エラー: ${String(error?.message ?? error)}`);
  process.exit(1);
});
