// src/scanGame.ts
import type { PvInfo, UsiEngine } from "./engine";
import { config } from "./config";
import { perfMark, startTimer } from "./debug/coarsePerf";
import { buildRootSfenWithMoveNumber } from "./problem/buildRootSfenWithMoveNumber";
import { correctRootSfenMeta } from "./problem/correctRootSfenMeta";
import { normalizeCpToSentePerspective } from "./problem/rootEval";
import type { ScanResult } from "./types";

type Color = "b" | "w";

type Candidate = {
  t: number;
  diff: number;
  introMoveUsi: string;
  actualMoveUsi: string;
};

type StepSnapshot = {
  depth: number;
  mp: number;
  gatheredCount: number;
  hasActualMove: boolean;
  foundWrong2: boolean;
};

function pickBestCpInfo(infos: PvInfo[]) {
  const sorted = [...infos].sort((a, b) => a.multipv - b.multipv);
  const best = sorted[0];
  if (!best || best.evalType !== "cp") return null;
  return best;
}

function buildPositionCommand(initialSfen: string, movesApplied: string[]) {
  const baseCmd = `position sfen ${initialSfen}`;
  return movesApplied.length === 0 ? baseCmd : `${baseCmd} moves ${movesApplied.join(" ")}`;
}

function getTurnAtS(initialTurn: Color, appliedPlies: number): Color {
  return appliedPlies % 2 === 0 ? initialTurn : initialTurn === "b" ? "w" : "b";
}

function getInitialTurn(initialSfen: string): Color {
  const parts = initialSfen.trim().split(/\s+/);
  const turn = parts[1];
  if (turn !== "b" && turn !== "w") {
    throw new Error(`[scanGame] invalid turn in initial sfen: ${initialSfen}`);
  }
  return turn;
}

function hasMove(infos: PvInfo[], usi: string): boolean {
  return infos.some((x) => x.evalType === "cp" && x.pv[0] === usi);
}

function mergeUniqueByMove(primary: PvInfo[], extra: PvInfo[]): PvInfo[] {
  const seen = new Set<string>();
  const out: PvInfo[] = [];

  for (const x of primary) {
    const u = x.pv[0];
    if (!u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(x);
  }

  for (const x of extra) {
    const u = x.pv[0];
    if (!u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(x);
  }

  return out;
}

function bestLossCp(args: {
  bestEvalSente: number;
  candidateEvalSente: number;
  turnAtS: Color;
}): number {
  const { bestEvalSente, candidateEvalSente, turnAtS } = args;

  if (turnAtS === "b") return bestEvalSente - candidateEvalSente;
  return candidateEvalSente - bestEvalSente;
}

async function analyzeActualIfMissing(args: {
  engine: UsiEngine;
  positionCommand: string;
  depth: number;
  pvPlies: number;
  actualMoveUsi: string;
  perfLabel?: string;
}): Promise<PvInfo | null> {
  const { engine, positionCommand, depth, pvPlies, actualMoveUsi, perfLabel } = args;

  const endAll = startTimer();

  const endSetMp = startTimer();
  await engine.setMultiPv(1);
  perfMark(perfLabel ? `${perfLabel}|setMultiPv(1)` : "scanGame.pass2.actualIfMissing.setMultiPv", endSetMp());

  const endAnalyze = startTimer();
  const res = await engine.analyze({
    positionCommand,
    depth,
    pvPlies,
    searchMoves: [actualMoveUsi],
    label: perfLabel ? `${perfLabel}|actualIfMissing` : "scan-pass2-actualIfMissing",
  });
  perfMark(
    perfLabel ? `${perfLabel}|analyzeActualIfMissing` : "scanGame.pass2.actualIfMissing.analyze",
    endAnalyze()
  );

  perfMark(perfLabel ? `${perfLabel}|total` : "scanGame.pass2.actualIfMissing.total", endAll());

  const best = pickBestCpInfo(res.infos);
  if (!best) return null;
  if (best.pv[0] !== actualMoveUsi) return null;

  return { ...best, multipv: 999 };
}

function pickSpacedCandidates(args: { candidates: Candidate[]; maxPick: number; minGap: number }): Candidate[] {
  const { candidates, maxPick, minGap } = args;
  const sorted = [...candidates].sort((a, b) => b.diff - a.diff);

  const gapSteps = [minGap, Math.floor(minGap / 2), Math.floor(minGap / 3), 0].filter(
    (g, i, a) => g >= 0 && a.indexOf(g) === i
  );

  for (const gap of gapSteps) {
    const picked: Candidate[] = [];
    for (const c of sorted) {
      if (picked.length >= maxPick) break;
      if (picked.every((p) => Math.abs(p.t - c.t) >= gap)) picked.push(c);
    }

    if (picked.length > 0) {
      const ts = picked
        .slice()
        .sort((a, b) => a.t - b.t)
        .map((x) => x.t)
        .join(",");
      console.log(`pass2候補t一覧:${ts}`);
      return picked;
    }
  }

  const fallback = sorted.slice(0, maxPick);
  console.log(`pass2候補t一覧: fallback picked=${fallback.length}`);
  return fallback;
}

function shouldGiveUpPass2(args: {
  history: StepSnapshot[];
  currentMp: number;
  maxMp: number;
}): { giveUp: boolean; reason?: string } {
  const { history, currentMp, maxMp } = args;

  if (history.length < 2) return { giveUp: false };

  const last = history[history.length - 1];
  const prev = history[history.length - 2];

  if (!last.hasActualMove) return { giveUp: false };
  if (last.foundWrong2) return { giveUp: false };

  const noGrowth = last.gatheredCount === prev.gatheredCount;
  const reachedHighMp = currentMp >= 10;
  const nearEnd = currentMp === maxMp || currentMp >= 20;

  if (noGrowth && reachedHighMp) return { giveUp: true, reason: "候補増えず高mp" };
  if (noGrowth && nearEnd) return { giveUp: true, reason: "候補増えず終盤" };

  return { giveUp: false };
}

function summarizeWrong2Potential(args: {
  infos: PvInfo[];
  wrong1Usi: string;
  threshold: number;
  turnAtS: Color;
}): {
  foundWrong2: boolean;
  worstLoss: number;
} {
  const { infos, wrong1Usi, threshold, turnAtS } = args;

  const cp = infos.filter((x) => x.evalType === "cp" && x.pv.length > 0);
  if (cp.length === 0) return { foundWrong2: false, worstLoss: 0 };

  const normalized = cp.map((x) => ({
    ...x,
    eval: normalizeCpToSentePerspective(x.eval, turnAtS),
  }));

  const sorted =
    turnAtS === "b"
      ? [...normalized].sort((a, b) => b.eval - a.eval)
      : [...normalized].sort((a, b) => a.eval - b.eval);

  const best = sorted[0];
  if (!best) return { foundWrong2: false, worstLoss: 0 };

  const correctUsi = best.pv[0];
  const exclude = new Set<string>([correctUsi, wrong1Usi]);

  let worstLoss = 0;
  let foundWrong2 = false;

  for (const x of normalized) {
    const u = x.pv[0];
    if (!u) continue;
    if (exclude.has(u)) continue;

    const loss = bestLossCp({
      bestEvalSente: best.eval,
      candidateEvalSente: x.eval,
      turnAtS,
    });

    if (loss > worstLoss) worstLoss = loss;
    if (loss >= threshold) foundWrong2 = true;
  }

  return { foundWrong2, worstLoss };
}

function getDynamicMpConfig(): {
  baseMps: readonly number[];
  tailMp: number;
  insert20WorstLossThreshold: number;
} {
  return {
    baseMps: config.finalize.dynamicMpBaseSteps ?? [3, 10],
    tailMp: config.finalize.dynamicMpTail ?? 30,
    insert20WorstLossThreshold: config.finalize.dynamicMpInsert20WorstLossThreshold ?? 400,
  };
}

/**
 * pass2の超序盤（最初の1step）で「ユーザー不利/有利すぎ」を判定するため，
 * gatheredからbestEvalを取り，builderと同じ定義で userCp を計算する。
 *
 * - infosは questionTurn(=turnAtS) の局面の解析結果（intro適用後）である前提
 * - bestEvalは「先手視点に正規化したcp」
 * - userCp は questionTurnがbなら +bestEval，wなら -bestEval
 */
function computeUserCpFromGathered(args: { gathered: PvInfo[]; questionTurn: Color }): number | null {
  const { gathered, questionTurn } = args;

  const cp = gathered.filter((x) => x.evalType === "cp" && x.pv.length > 0);
  if (cp.length === 0) return null;

  const normalized = cp.map((x) => ({
    ...x,
    eval: normalizeCpToSentePerspective(x.eval, questionTurn),
  }));

  const sorted =
    questionTurn === "b"
      ? [...normalized].sort((a, b) => b.eval - a.eval)
      : [...normalized].sort((a, b) => a.eval - b.eval);

  const best = sorted[0];
  if (!best) return null;

  const bestEval = best.eval; // sente perspective
  const userCp = questionTurn === "b" ? bestEval : -bestEval;
  return userCp;
}

export async function scanGame(args: {
  engine: UsiEngine;
  initialSfen: string;
  moves: string[];
}): Promise<ScanResult[]> {
  const { engine, initialSfen, moves } = args;

  const initialTurn = getInitialTurn(initialSfen);

  const minT = 2;
  const maxT = moves.length - 1;

  console.log("pass1開始");
  const candidates: Candidate[] = [];

  for (let t = minT; t <= maxT; t++) {
    const introMoveUsi = moves[t - 1];
    const actualMoveUsi = moves[t];

    const movesToS = moves.slice(0, t);
    const turnAtS = getTurnAtS(initialTurn, t);
    const positionCommandS = buildPositionCommand(initialSfen, movesToS);

    const bestRes = await engine.analyze({
      positionCommand: positionCommandS,
      depth: config.scan.depth,
      pvPlies: 2,
      label: `scan-pass1-best-t${t}`,
    });

    const best = pickBestCpInfo(bestRes.infos);
    if (!best) continue;

    // pass1軽量化：
    // bestmoveが実戦手と一致するなら diff=0 なので suspicious に入らない。
    // actualのsearchmoves解析を省略して次へ。
    if (bestRes.bestmove && bestRes.bestmove === actualMoveUsi) {
      continue;
    }

    const actualRes = await engine.analyze({
      positionCommand: positionCommandS,
      depth: config.scan.depth,
      pvPlies: 2,
      searchMoves: [actualMoveUsi],
      label: `scan-pass1-actual-t${t}`,
    });

    const actual = pickBestCpInfo(actualRes.infos);
    if (!actual) continue;

    const bestEvalSente = normalizeCpToSentePerspective(best.eval, turnAtS);
    const actualEvalSente = normalizeCpToSentePerspective(actual.eval, turnAtS);

    const diff = bestLossCp({
      bestEvalSente,
      candidateEvalSente: actualEvalSente,
      turnAtS,
    });

    if (diff >= config.suspiciousMinDiff && diff <= config.suspiciousMaxDiff) {
      candidates.push({ t, diff, introMoveUsi, actualMoveUsi });
    }
  }

  const pass2Targets = pickSpacedCandidates({
    candidates,
    maxPick: config.maxCandidates,
    minGap: config.finalize.minCandidateGapPlies ?? 30,
  });

  console.log(`pass1候補t一覧: ${candidates
         .slice()
         .sort((a, b) => a.t - b.t)
         .map((x) => x.t)
         .join(",")}`);

  console.log(`pass1結果: 候補手 ${candidates.length}，pass2候補手 ${pass2Targets.length}`);
  console.log("pass2開始");

  const results: ScanResult[] = [];

  for (const c of pass2Targets) {
    if (results.length >= (config.maxScanResultsPerGame ?? 9999)) break;

    const candidateLabel = `scanGame.pass2.t${c.t}`;
    const { t, introMoveUsi, actualMoveUsi } = c;

    const movesToS = moves.slice(0, t);
    const turnAtS = getTurnAtS(initialTurn, t);
    const positionCommandS = buildPositionCommand(initialSfen, movesToS);

    const pvPlies = Math.max(config.finalize.pvPlies, 9);
    const depthSteps = config.finalize.choiceDepthSteps ?? [config.finalize.depth, config.finalize.depth + 2];
    const threshold = config.finalize.blunderThresholdCp ?? 400;
    const { baseMps, tailMp, insert20WorstLossThreshold } = getDynamicMpConfig();

    const rejectIfBestTooBadCp = config.finalize.rejectIfBestTooBadCp;
    const rejectIfBestTooGoodCp = config.finalize.rejectIfBestTooGoodCp;

    let gathered: PvInfo[] = [];
    let gaveUp = false;
    let giveUpReason: string | null = null;
    const stepHistory: StepSnapshot[] = [];

    let summaryAtMp10: { foundWrong2: boolean; worstLoss: number } | null = null;

    let ok = false;

    outer: for (const depth of depthSteps) {
      for (const mp of baseMps) {
        const endStep = startTimer();

        const endSetMp = startTimer();
        await engine.setMultiPv(mp);
        const setMpMs = endSetMp();
        perfMark(`${candidateLabel}|setMultiPv`, setMpMs);
        perfMark(`${candidateLabel}|depth${depth}|mp${mp}|setMultiPv`, setMpMs);

        const endAnalyze = startTimer();
        const analysis = await engine.analyze({
          positionCommand: positionCommandS,
          depth,
          pvPlies,
          label: `scan-pass2-t${t}-d${depth}-mp${mp}`,
        });
        const analyzeMs = endAnalyze();
        perfMark(`${candidateLabel}|analyze`, analyzeMs);
        perfMark(`${candidateLabel}|depth${depth}|mp${mp}|analyze`, analyzeMs);

        gathered = mergeUniqueByMove(gathered, analysis.infos);

        // pass2超序盤のフィルタ：
        // 最初の1stepで rootEval相当(bestEval)を取って，builderと同じ条件で弾く。
        // これで「後で確実に破棄される局面」に対して mp10/tail/depth20 を回さずに済む。
        const isFirstStep = depth === depthSteps[0] && mp === baseMps[0] && stepHistory.length === 0;
        if (isFirstStep) {
          const userCp = computeUserCpFromGathered({ gathered, questionTurn: turnAtS });

          if (userCp != null && rejectIfBestTooBadCp != null && userCp < -rejectIfBestTooBadCp) {
            gaveUp = true;
            giveUpReason = `ユーザー不利(早期) userCp ${userCp} 下限 ${rejectIfBestTooBadCp}`;
            break outer;
          }

          if (userCp != null && rejectIfBestTooGoodCp != null && userCp > rejectIfBestTooGoodCp) {
            gaveUp = true;
            giveUpReason = `ユーザー有利すぎ(早期) userCp ${userCp} 上限 ${rejectIfBestTooGoodCp}`;
            break outer;
          }
        }

        let hadActual = hasMove(gathered, actualMoveUsi);
        if (!hadActual) {
          const endActual = startTimer();
          const actualInfo = await analyzeActualIfMissing({
            engine,
            positionCommand: positionCommandS,
            depth,
            pvPlies,
            actualMoveUsi,
            perfLabel: `${candidateLabel}|depth${depth}|mp${mp}|actualIfMissing`,
          });
          const actualIfMissingMs = endActual();
          perfMark(`${candidateLabel}|actualIfMissingTotal`, actualIfMissingMs);
          perfMark(`${candidateLabel}|depth${depth}|mp${mp}|actualIfMissingTotal`, actualIfMissingMs);

          if (actualInfo) gathered = mergeUniqueByMove(gathered, [actualInfo]);
          hadActual = hasMove(gathered, actualMoveUsi);
        }

        const endSumm = startTimer();
        const summary = summarizeWrong2Potential({
          infos: gathered,
          wrong1Usi: actualMoveUsi,
          threshold,
          turnAtS,
        });
        const existsWrong2Ms = endSumm();
        perfMark(`${candidateLabel}|existsWrong2`, existsWrong2Ms);
        perfMark(`${candidateLabel}|depth${depth}|mp${mp}|existsWrong2`, existsWrong2Ms);

        const stepMs = endStep();
        perfMark(`${candidateLabel}|stepTotal`, stepMs);
        perfMark(`${candidateLabel}|depth${depth}|mp${mp}|stepTotal`, stepMs);

        stepHistory.push({
          depth,
          mp,
          gatheredCount: gathered.length,
          hasActualMove: hadActual,
          foundWrong2: summary.foundWrong2,
        });

        if (mp === 10) summaryAtMp10 = summary;

        if (summary.foundWrong2) {
          ok = true;
          break outer;
        }

        const giveUp = shouldGiveUpPass2({
          history: stepHistory,
          currentMp: mp,
          maxMp: tailMp,
        });

        if (giveUp.giveUp) {
          gaveUp = true;
          giveUpReason = giveUp.reason ?? "見込みなし";
          break outer;
        }
      }

      const worstLoss10 = summaryAtMp10?.worstLoss ?? 0;
      const shouldInsert20 = worstLoss10 >= insert20WorstLossThreshold;
      const nextMps = shouldInsert20 ? [20, tailMp] : [tailMp];

      for (const mp of nextMps) {
        const endStep = startTimer();

        const endSetMp = startTimer();
        await engine.setMultiPv(mp);
        const setMpMs = endSetMp();
        perfMark(`${candidateLabel}|setMultiPv`, setMpMs);
        perfMark(`${candidateLabel}|depth${depth}|mp${mp}|setMultiPv`, setMpMs);

        const endAnalyze = startTimer();
        const analysis = await engine.analyze({
          positionCommand: positionCommandS,
          depth,
          pvPlies,
          label: `scan-pass2-t${t}-d${depth}-mp${mp}`,
        });
        const analyzeMs = endAnalyze();
        perfMark(`${candidateLabel}|analyze`, analyzeMs);
        perfMark(`${candidateLabel}|depth${depth}|mp${mp}|analyze`, analyzeMs);

        gathered = mergeUniqueByMove(gathered, analysis.infos);

        const endSumm = startTimer();
        const summary = summarizeWrong2Potential({
          infos: gathered,
          wrong1Usi: actualMoveUsi,
          threshold,
          turnAtS,
        });
        const existsWrong2Ms = endSumm();
        perfMark(`${candidateLabel}|existsWrong2`, existsWrong2Ms);
        perfMark(`${candidateLabel}|depth${depth}|mp${mp}|existsWrong2`, existsWrong2Ms);

        const stepMs = endStep();
        perfMark(`${candidateLabel}|stepTotal`, stepMs);
        perfMark(`${candidateLabel}|depth${depth}|mp${mp}|stepTotal`, stepMs);

        stepHistory.push({
          depth,
          mp,
          gatheredCount: gathered.length,
          hasActualMove: hasMove(gathered, actualMoveUsi),
          foundWrong2: summary.foundWrong2,
        });

        if (summary.foundWrong2) {
          ok = true;
          break outer;
        }

        const giveUp = shouldGiveUpPass2({
          history: stepHistory,
          currentMp: mp,
          maxMp: tailMp,
        });

        if (giveUp.giveUp) {
          gaveUp = true;
          giveUpReason = giveUp.reason ?? "見込みなし";
          break outer;
        }
      }
    }

    const rootSfenRaw = buildRootSfenWithMoveNumber(initialSfen, moves, t - 1);
    const rootSfen = correctRootSfenMeta({
      rootSfen: rootSfenRaw,
      initialSfen,
      appliedPlies: t - 1,
    });

    if (ok && !gaveUp) {
      results.push({ t, rootSfen, introMoveUsi, actualMoveUsi, infos: gathered });
      console.log(`pass2候補: OK，t ${t}`);
    } else {
      const reason = giveUpReason ?? "条件未達";
      console.log(`pass2候補: NG，t ${t}，理由 ${reason}`);
    }
  }

  return results;
}