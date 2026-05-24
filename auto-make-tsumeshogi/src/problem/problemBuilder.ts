// src/problem/problemBuilder.ts
import { cpToWinRatePercentFromRootSfen } from "../evaluation/cpToWinRate";
import type { PvInfo, UsiEngine } from "../engine";
import type { ChoiceOut, ProblemOut } from "../sql/buildSql";
import type { ScanResult } from "../types";
import { buildStateAtSForLabel } from "./buildStateAtSForLabel";
import { normalizeCpToSentePerspective } from "./rootEval";

type Color = "b" | "w";

function hasMate(infos: PvInfo[]): boolean {
  return infos.some((i) => i.evalType === "mate");
}

function getRootTurnFromSfen(rootSfen: string): Color {
  const parts = rootSfen.trim().split(/\s+/);
  const turn = parts[1];
  if (turn !== "b" && turn !== "w") {
    throw new Error(`[problemBuilder] invalid root turn in sfen: ${rootSfen}`);
  }
  return turn;
}

function questionTurnFromRootSfenAndIntro(rootSfen: string, introMoveUsi: string): Color {
  const rootTurn = getRootTurnFromSfen(rootSfen);
  if (!introMoveUsi) {
    throw new Error("[problemBuilder] introMoveUsi is empty");
  }
  return rootTurn === "b" ? "w" : "b";
}

function normalizeInfosToSenteCp(infos: PvInfo[], questionTurn: Color): PvInfo[] {
  return infos
    .filter((x) => x.evalType === "cp" && x.pv.length > 0)
    .map((x) => ({
      ...x,
      eval: normalizeCpToSentePerspective(x.eval, questionTurn),
    }));
}

function sortByBestForTurn(infos: PvInfo[], questionTurn: Color): PvInfo[] {
  const copied = infos.slice();
  copied.sort((a, b) => {
    if (questionTurn === "b") {
      return b.eval - a.eval;
    }
    return a.eval - b.eval;
  });
  return copied;
}

function pvLineUpTo8(info: PvInfo): string[] | null {
  const line = info.pv.slice(1, 9);
  if (line.length === 0) return null;
  return line;
}

function uniqMoves(infos: PvInfo[]): PvInfo[] {
  const seen = new Set<string>();
  const out: PvInfo[] = [];

  for (const i of infos) {
    const u = i.pv[0];
    if (!u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(i);
  }

  return out;
}

function lossFromBestCp(args: {
  bestEval: number;
  candidateEval: number;
  questionTurn: Color;
}): number {
  const { bestEval, candidateEval, questionTurn } = args;

  if (questionTurn === "b") {
    return bestEval - candidateEval;
  }
  return candidateEval - bestEval;
}

function pickWrong1(args: {
  cpInfos: PvInfo[];
  actualMoveUsi: string;
  correctUsi: string;
}): PvInfo | null {
  const { cpInfos, actualMoveUsi, correctUsi } = args;

  if (actualMoveUsi !== correctUsi) {
    const hit = cpInfos.find((x) => x.pv[0] === actualMoveUsi);
    if (hit) return hit;
  }

  return cpInfos.find((x) => x.pv[0] !== correctUsi) ?? null;
}

function pickWrong2Strict(args: {
  cpInfos: PvInfo[];
  bestEval: number;
  threshold: number;
  preferMax: number;
  exclude: Set<string>;
  questionTurn: Color;
}): PvInfo | null {
  const { cpInfos, bestEval, threshold, preferMax, exclude, questionTurn } = args;

  const pool = cpInfos.filter((x) => {
    const u = x.pv[0];
    if (!u) return false;
    if (exclude.has(u)) return false;
    return true;
  });

  const scored = pool
    .map((x) => ({
      info: x,
      diff: lossFromBestCp({
        bestEval,
        candidateEval: x.eval,
        questionTurn,
      }),
    }))
    .filter((x) => x.diff >= threshold);

  if (scored.length === 0) return null;

  const inRange = scored.filter((x) => x.diff >= threshold && x.diff <= preferMax);

  if (inRange.length > 0) {
    inRange.sort((a, b) => a.diff - b.diff);
    return inRange[0].info;
  }

  scored.sort((a, b) => a.diff - b.diff);
  return scored[0].info;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], seed: number) {
  const rnd = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export async function buildProblemOutFromScan(args: {
  engine: UsiEngine;
  scan: ScanResult;
  problemId: number;
  createdAt: string;
  prompt: string;
  blunderThreshold: number;
  shuffleSeed: number;
  evalScale: number;
  rootEvalDepth?: number;
  rootEvalPvPlies?: number;
  rejectIfBestTooBadCp?: number;
  rejectIfBestTooGoodCp?: number;
}): Promise<ProblemOut | null> {
  const {
    scan,
    problemId,
    createdAt,
    prompt,
    blunderThreshold,
    shuffleSeed,
    evalScale,
    rootEvalDepth = 18,
    rootEvalPvPlies = 2,
    rejectIfBestTooBadCp,
    rejectIfBestTooGoodCp,
  } = args;

  const { t, rootSfen, introMoveUsi, actualMoveUsi, infos } = scan;

  if (!infos.length) return null;
  if (hasMate(infos)) return null;

  const rootTurn = getRootTurnFromSfen(rootSfen);
  const questionTurn = questionTurnFromRootSfenAndIntro(rootSfen, introMoveUsi);

  const normalizedCpInfos = normalizeInfosToSenteCp(infos, questionTurn);
  const cpInfos = uniqMoves(sortByBestForTurn(normalizedCpInfos, questionTurn));
  const best = cpInfos[0];
  if (!best) return null;

  const correctUsi = best.pv[0];
  const bestEval = best.eval;

  const rootEvalCp = bestEval;

  const userColor: Color = questionTurn;
  const userCp = userColor === "b" ? rootEvalCp : -rootEvalCp;

  if (rejectIfBestTooBadCp != null && userCp < -rejectIfBestTooBadCp) {
    console.log(
      `pass2問題作成 破棄: 理由 ユーザー不利，t ${t}，root評価 ${rootEvalCp}，下限 ${rejectIfBestTooBadCp}`
    );
    return null;
  }

  if (rejectIfBestTooGoodCp != null && userCp > rejectIfBestTooGoodCp) {
    console.log(
      `pass2問題作成 破棄: 理由 ユーザー有利すぎ，t ${t}，root評価 ${rootEvalCp}，上限 ${rejectIfBestTooGoodCp}`
    );
    return null;
  }

  const wrong1 = pickWrong1({
    cpInfos,
    actualMoveUsi,
    correctUsi,
  });
  if (!wrong1) return null;

  const wrong2 = pickWrong2Strict({
    cpInfos,
    bestEval,
    threshold: blunderThreshold,
    preferMax: 800,
    exclude: new Set<string>([correctUsi, wrong1.pv[0]]),
    questionTurn,
  });

  if (!wrong2) {
    console.log(
      `pass2問題作成 破棄: 理由 悪手不足，t ${t}，閾値 ${blunderThreshold}，正解 ${correctUsi}，実戦手 ${actualMoveUsi}，最善評価 ${bestEval}`
    );
    return null;
  }

  const bestLine = pvLineUpTo8(best);
  const wrong1Line = pvLineUpTo8(wrong1);
  const wrong2Line = pvLineUpTo8(wrong2);

  if (!bestLine || !wrong1Line || !wrong2Line) {
    const w1 = wrong1.pv[0] ?? "-";
    const w2 = wrong2.pv[0] ?? "-";
    console.log(
      `pass2問題作成 破棄: 理由 読み筋なし，t ${t}，正解 ${correctUsi}，実戦手 ${w1}，悪手 ${w2}，pv長 正解 ${best.pv.length}，実戦手 ${wrong1.pv.length}，悪手 ${wrong2.pv.length}`
    );
    return null;
  }

  const u0 = correctUsi;
  const u1 = wrong1.pv[0];
  const u2 = wrong2.pv[0];

  if (!u1 || !u2) return null;
  if (u0 === u1 || u0 === u2 || u1 === u2) {
    console.log(`pass2問題作成 破棄: 理由 重複選択肢，t ${t}，手1 ${u0}，手2 ${u1}，手3 ${u2}`);
    return null;
  }

  const rawChoices: Array<{
    usi: string;
    evalCp: number;
    evalPercent: number;
    line: string[];
    isCorrect: boolean;
  }> = [
    {
      usi: u0,
      evalCp: best.eval,
      evalPercent: cpToWinRatePercentFromRootSfen({
        cp: best.eval,
        rootSfen,
        scale: evalScale,
      }),
      line: bestLine,
      isCorrect: true,
    },
    {
      usi: u1,
      evalCp: wrong1.eval,
      evalPercent: cpToWinRatePercentFromRootSfen({
        cp: wrong1.eval,
        rootSfen,
        scale: evalScale,
      }),
      line: wrong1Line,
      isCorrect: false,
    },
    {
      usi: u2,
      evalCp: wrong2.eval,
      evalPercent: cpToWinRatePercentFromRootSfen({
        cp: wrong2.eval,
        rootSfen,
        scale: evalScale,
      }),
      line: wrong2Line,
      isCorrect: false,
    },
  ];

  shuffleInPlace(rawChoices, shuffleSeed);

  const correctIndex = rawChoices.findIndex((c) => c.isCorrect);
  if (correctIndex < 0) return null;

  const stateForLabelAtS = buildStateAtSForLabel(rootSfen, introMoveUsi);

  const choices: ChoiceOut[] = rawChoices.map((c, idx) => ({
    choiceId: idx + 1,
    usi: c.usi,
    evalCp: c.evalCp,
    evalPercent: c.evalPercent,
    line: c.line,
  }));

  const rootEvalPercent = cpToWinRatePercentFromRootSfen({
    cp: rootEvalCp,
    rootSfen,
    scale: evalScale,
  });

  const diffWrong1 = lossFromBestCp({
    bestEval,
    candidateEval: wrong1.eval,
    questionTurn,
  });
  const diffWrong2 = lossFromBestCp({
    bestEval,
    candidateEval: wrong2.eval,
    questionTurn,
  });

  console.log(
    `問題作成 成功: t ${t}，root手番 ${rootTurn}`
  );

  return {
    id: problemId,
    createdAt,
    prompt,
    rootSfen,
    correctChoiceId: correctIndex + 1,
    introMovesUsi: [introMoveUsi],
    stateForLabelAtS,
    rootEvalCp,
    rootEvalPercent,
    choices,
  };
}