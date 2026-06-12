// src/scanGame.ts
import type { EngineClient, PvInfo } from "../../services/engine/engineClient";
import { config } from "./config";
import { perfMark, startTimer } from "./debug/coarsePerf";
import { buildRootSfenWithMoveNumber } from "./problem/buildRootSfenWithMoveNumber";
import { correctRootSfenMeta } from "./problem/correctRootSfenMeta";
import { normalizeCpToSentePerspective } from "./problem/rootEval";
import { sfenAtPly } from "./shogi/sfenEngine";
import type { ScanResult } from "./types";

type Color = "b" | "w";

type Candidate = {
  t: number;
  introMoveUsi: string;
  actualMoveUsi: string;
  pass1UserCp: number;
};

type Pass1LogItem = {
  t: number;
};

type Pass2LogItem = {
  t: number;
  depth: number;
  positionCommand: string;
  turnAtS: Color;
  status: "OK" | "NG";
  reason: string | null;
  best: PvInfo | null;
  actual: PvInfo | null;
  wrong: PvInfo | null;
};

type DepthRunLog = {
  purpose: "best" | "actual" | "wrongFinal";
  moveUsi: string | null;
  depth: number;
  elapsedMs: number;
  status: "OK" | "ERROR";
};

function depthRunReason(purpose: DepthRunLog["purpose"]): string {
  if (purpose === "best") return "最善手と評価値の確定";
  if (purpose === "actual") return "実戦手の悪手度確認";
  return "不正解候補の評価確定";
}

function pickBestCpInfo(infos: PvInfo[]) {
  const sorted = [...infos].sort((a, b) => a.multipv - b.multipv);
  const best = sorted[0];
  if (!best || best.evalType !== "cp") return null;
  return best;
}

function buildPositionCommandAtPly(initialSfen: string, moves: string[], ply: number) {
  return `position sfen ${sfenAtPly(initialSfen, moves, ply)}`;
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

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed<T>(items: T[], seed: number): T[] {
  const out = [...items];
  const rnd = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
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

function formatMoveEval(info: PvInfo, turnAtS: Color): string {
  const move = info.pv[0] ?? "-";
  if (info.evalType === "mate") return `${move} mate=${info.eval}`;

  const senteEval = normalizeCpToSentePerspective(info.eval, turnAtS);
  return `${move} eval=${senteEval} raw=${info.eval}`;
}

function formatLoss(args: { best: PvInfo; candidate: PvInfo; turnAtS: Color }): number | null {
  const { best, candidate, turnAtS } = args;
  if (best.evalType !== "cp" || candidate.evalType !== "cp") return null;

  return bestLossCp({
    bestEvalSente: normalizeCpToSentePerspective(best.eval, turnAtS),
    candidateEvalSente: normalizeCpToSentePerspective(candidate.eval, turnAtS),
    turnAtS,
  });
}

function formatPass2LogItem(item: Pass2LogItem): string {
  const actualLoss =
    item.best && item.actual ? formatLoss({ best: item.best, candidate: item.actual, turnAtS: item.turnAtS }) : null;
  const wrongLoss =
    item.best && item.wrong ? formatLoss({ best: item.best, candidate: item.wrong, turnAtS: item.turnAtS }) : null;
  const actualLossText = actualLoss == null ? "" : ` loss=${actualLoss}`;
  const wrongLossText = wrongLoss == null ? "" : ` loss=${wrongLoss}`;
  const reasonText = item.reason ? ` reason=${item.reason}` : "";

  return [
    `pass2 row${item.t + 1}`,
    item.status,
    `depth${item.depth}`,
    `turn=${item.turnAtS}`,
    `best=${item.best ? formatMoveEval(item.best, item.turnAtS) : "-"}`,
    `actual=${item.actual ? formatMoveEval(item.actual, item.turnAtS) : "-"}${actualLossText}`,
    `wrong=${item.wrong ? formatMoveEval(item.wrong, item.turnAtS) : "-"}${wrongLossText}`,
    reasonText,
  ].join(" ");
}

async function analyzeMove(args: {
  engine: EngineClient;
  positionCommand: string;
  depth: number;
  pvPlies: number;
  moveUsi: string;
  perfLabel?: string;
  maxDurationMs?: number;
}): Promise<PvInfo | null> {
  const { engine, positionCommand, depth, pvPlies, moveUsi, perfLabel, maxDurationMs } = args;

  const endAll = startTimer();

  const endSetMp = startTimer();
  await engine.setMultiPv(1);
  perfMark(perfLabel ? `${perfLabel}|setMultiPv(1)` : "scanGame.pass2.analyzeMove.setMultiPv", endSetMp());

  const endAnalyze = startTimer();
  const res = await engine.analyze({
    positionCommand,
    depth,
    pvPlies,
    searchMoves: [moveUsi],
    label: perfLabel ? `${perfLabel}|searchMove` : "scan-pass2-searchMove",
    maxDurationMs,
    stopWhen: (info) => info.evalType === "mate",
  });
  perfMark(
    perfLabel ? `${perfLabel}|analyzeMove` : "scanGame.pass2.analyzeMove.analyze",
    endAnalyze()
  );

  perfMark(perfLabel ? `${perfLabel}|total` : "scanGame.pass2.analyzeMove.total", endAll());

  const best = pickBestCpInfo(res.infos);
  if (!best) return null;
  if (best.pv[0] !== moveUsi) return null;

  return { ...best, multipv: 999 };
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

function listWrong2Candidates(args: {
  infos: PvInfo[];
  correctUsi: string;
  actualMoveUsi: string;
  threshold: number;
  turnAtS: Color;
  randomSeed: number;
}): Array<{ info: PvInfo; loss: number }> {
  const { infos, correctUsi, actualMoveUsi, threshold, turnAtS, randomSeed } = args;
  const cp = infos.filter((x) => x.evalType === "cp" && x.pv.length > 0);
  if (cp.length === 0) return [];

  const normalized = cp.map((x) => ({
    ...x,
    eval: normalizeCpToSentePerspective(x.eval, turnAtS),
  }));
  const sorted =
    turnAtS === "b"
      ? [...normalized].sort((a, b) => b.eval - a.eval)
      : [...normalized].sort((a, b) => a.eval - b.eval);
  const best = sorted[0];
  if (!best) return [];

  const exclude = new Set<string>([correctUsi, actualMoveUsi]);
  const filtered = normalized
    .map((info) => {
      const loss = bestLossCp({
        bestEvalSente: best.eval,
        candidateEvalSente: info.eval,
        turnAtS,
      });
      return { info, loss };
    })
    .filter(({ info, loss }) => {
      const usi = info.pv[0];
      return Boolean(usi) && !exclude.has(usi) && loss >= threshold;
    })
    .sort((a, b) => b.loss - a.loss);

  const strong = filtered.filter(({ loss }) => loss >= 800);
  const normal = filtered.filter(({ loss }) => loss < 800);
  const orderedStrong = shuffleWithSeed(strong, randomSeed + 800);
  const orderedNormal = shuffleWithSeed(normal, randomSeed + 300);
  return [...orderedStrong, ...orderedNormal];
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
  engine: EngineClient;
  initialSfen: string;
  moves: string[];
}): Promise<ScanResult[]> {
  const { engine, initialSfen, moves } = args;

  const initialTurn = getInitialTurn(initialSfen);

  const minT = 2;
  const maxT = moves.length - 1;

  const candidates: Candidate[] = [];
  const pass1LogItems: Pass1LogItem[] = [];

  for (let t = minT; t <= maxT; t++) {
    const introMoveUsi = moves[t - 1];
    const actualMoveUsi = moves[t];

    const turnAtS = getTurnAtS(initialTurn, t);
    const positionCommandS = buildPositionCommandAtPly(initialSfen, moves, t);

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

    const signedDiff = bestLossCp({
      bestEvalSente,
      candidateEvalSente: actualEvalSente,
      turnAtS,
    });

    // 浅い解析では実戦手側の評価が最善手側を上回ることがある。
    // その場合は悪手ではないため候補に含めない。
    const isCandidate = signedDiff >= config.scan.minDiff;
    if (config.scan.debugAllPass1) {
      console.log(
        `pass1${isCandidate ? "候補" : "確認"}: row ${t + 1} actual ${actualMoveUsi} best ${best.pv[0] ?? "-"} appBestEval=${bestEvalSente} appActualEval=${actualEvalSente} loss=${signedDiff}`
      );
    }

    if (isCandidate) {
      const pass1UserCp = turnAtS === "b" ? bestEvalSente : -bestEvalSente;
      candidates.push({ t, introMoveUsi, actualMoveUsi, pass1UserCp });
      pass1LogItems.push({ t });
    }
  }

  console.log(`pass1抽出: ${pass1LogItems.map((x) => x.t + 1).join(",") || "なし"}`);

  const pass2Targets = candidates.slice().sort((a, b) => a.t - b.t);
  const minCandidateGapPlies = config.finalize.minCandidateGapPlies;

  const results: ScanResult[] = [];
  const pass2LogItems: Pass2LogItem[] = [];
  let nextPass2T = 0;

  for (const c of pass2Targets) {
    if (results.length >= config.maxProblemsPerGame) break;
    if (c.t < nextPass2T) continue;

    const candidateLabel = `scanGame.pass2.t${c.t}`;
    const { t, introMoveUsi, actualMoveUsi, pass1UserCp } = c;

    const turnAtS = getTurnAtS(initialTurn, t);
    const positionCommandS = buildPositionCommandAtPly(initialSfen, moves, t);

    const pvPlies = Math.max(config.finalize.pvPlies, 9);
    const finalDepth = config.finalize.depth;
    const maxDepthRunMs = config.finalize.maxDepthRunMs;
    const wrongProbeDepth = Math.min(config.finalize.wrongProbeDepthCap, finalDepth);
    const wrongProbeMultiPv = config.finalize.wrongProbeMultiPv;
    const threshold = config.finalize.minDiff;

    const rejectIfBestTooBadCp = config.finalize.rejectIfBestTooBadCp;
    const rejectIfBestTooGoodCp = config.finalize.rejectIfBestTooGoodCp;
    const earlyRejectMarginCp = config.finalize.earlyRejectMarginCp;

    let gathered: PvInfo[] = [];
    let giveUpReason: string | null = null;
    let ok = false;
    let finalBest: PvInfo | null = null;
    let actualInfo: PvInfo | null = null;
    let selectedWrongInfo: PvInfo | null = null;
    const candidateTimer = startTimer();
    let bestMs = 0;
    let actualMs = 0;
    let wrongProbeMs = 0;
    let wrongFinalMs = 0;
    const depthRunLogs: DepthRunLog[] = [];

    console.log(`pass2 candidate row${t + 1} start depth=${finalDepth} wrongProbeMp=${wrongProbeMultiPv}`);

    try {
      if (rejectIfBestTooBadCp != null && pass1UserCp < -(rejectIfBestTooBadCp + earlyRejectMarginCp)) {
        giveUpReason = `pass1でユーザー不利 pass1UserCp ${pass1UserCp} 早期棄却上限 ${rejectIfBestTooBadCp + earlyRejectMarginCp}`;
      } else if (rejectIfBestTooGoodCp != null && pass1UserCp > rejectIfBestTooGoodCp + earlyRejectMarginCp) {
        giveUpReason = `pass1でユーザー有利すぎ pass1UserCp ${pass1UserCp} 早期棄却上限 ${rejectIfBestTooGoodCp + earlyRejectMarginCp}`;
      }

      if (!giveUpReason) {
        console.log(`pass2 depth run row${t + 1} start purpose=best reason=${depthRunReason("best")} depth=${finalDepth} move=all`);
        const bestTimer = startTimer();
        let bestAnalysis: Awaited<ReturnType<EngineClient["analyze"]>>;
        try {
          await engine.setMultiPv(1);
          bestAnalysis = await engine.analyze({
            positionCommand: positionCommandS,
            depth: finalDepth,
            pvPlies,
            label: `scan-pass2-t${t}-best-d${finalDepth}`,
            maxDurationMs: maxDepthRunMs,
            stopWhen: (info) => info.evalType === "mate",
          });
          bestMs = bestTimer();
          depthRunLogs.push({ purpose: "best", moveUsi: null, depth: finalDepth, elapsedMs: bestMs, status: "OK" });
          console.log(`pass2 depth run row${t + 1} done purpose=best reason=${depthRunReason("best")} depth=${finalDepth} move=all elapsed=${bestMs}ms`);
        } catch (error) {
          bestMs = bestTimer();
          depthRunLogs.push({ purpose: "best", moveUsi: null, depth: finalDepth, elapsedMs: bestMs, status: "ERROR" });
          console.log(`pass2 depth run row${t + 1} error purpose=best reason=${depthRunReason("best")} depth=${finalDepth} move=all elapsed=${bestMs}ms`);
          throw error;
        }
        gathered = mergeUniqueByMove(gathered, bestAnalysis.infos);
        finalBest = pickBestCpInfo(bestAnalysis.infos);
        console.log(`pass2 best row${t + 1} d${finalDepth} ${finalBest ? formatMoveEval(finalBest, turnAtS) : "-"}`);

        if (!finalBest || !finalBest.pv[0]) {
          giveUpReason = "最善手なし";
        } else {
          const userCp = computeUserCpFromGathered({ gathered, questionTurn: turnAtS });
          if (userCp != null && rejectIfBestTooBadCp != null && userCp < -rejectIfBestTooBadCp) {
            giveUpReason = `ユーザー不利 turn=${turnAtS} userCp ${userCp} 下限 ${rejectIfBestTooBadCp}`;
          } else if (userCp != null && rejectIfBestTooGoodCp != null && userCp > rejectIfBestTooGoodCp) {
            giveUpReason = `ユーザー有利すぎ turn=${turnAtS} userCp ${userCp} 上限 ${rejectIfBestTooGoodCp}`;
          }
        }
      }

      if (!giveUpReason) {
        console.log(`pass2 depth run row${t + 1} start purpose=actual reason=${depthRunReason("actual")} depth=${finalDepth} move=${actualMoveUsi}`);
        const actualTimer = startTimer();
        try {
          actualInfo = await analyzeMove({
            engine,
            positionCommand: positionCommandS,
            depth: finalDepth,
            pvPlies,
            moveUsi: actualMoveUsi,
            perfLabel: `${candidateLabel}|actual-d${finalDepth}`,
            maxDurationMs: maxDepthRunMs,
          });
          actualMs = actualTimer();
          depthRunLogs.push({ purpose: "actual", moveUsi: actualMoveUsi, depth: finalDepth, elapsedMs: actualMs, status: "OK" });
          console.log(`pass2 depth run row${t + 1} done purpose=actual reason=${depthRunReason("actual")} depth=${finalDepth} move=${actualMoveUsi} elapsed=${actualMs}ms`);
        } catch (error) {
          actualMs = actualTimer();
          depthRunLogs.push({ purpose: "actual", moveUsi: actualMoveUsi, depth: finalDepth, elapsedMs: actualMs, status: "ERROR" });
          console.log(`pass2 depth run row${t + 1} error purpose=actual reason=${depthRunReason("actual")} depth=${finalDepth} move=${actualMoveUsi} elapsed=${actualMs}ms`);
          throw error;
        }
        if (actualInfo) gathered = mergeUniqueByMove(gathered, [actualInfo]);
        if (!actualInfo) {
          giveUpReason = "実戦手評価なし";
        } else if (finalBest) {
          const actualLoss = formatLoss({
            best: finalBest,
            candidate: actualInfo,
            turnAtS,
          });
          if (actualLoss == null || actualLoss < threshold) {
            giveUpReason = `実戦手の悪手度不足 loss=${actualLoss ?? "none"} 下限 ${threshold}`;
          }
        }
      }

      const correctUsi = finalBest?.pv[0] ?? null;
      if (!giveUpReason && correctUsi) {
        const triedWrongMoves = new Set<string>();

        console.log(`pass2 candidate row${t + 1} wrongProbe start mp=${wrongProbeMultiPv}`);
        const wrongProbeTimer = startTimer();
        await engine.setMultiPv(wrongProbeMultiPv);
        const probe = await engine.analyze({
          positionCommand: positionCommandS,
          depth: wrongProbeDepth,
          pvPlies,
          label: `scan-pass2-t${t}-wrongProbe-d${wrongProbeDepth}-mp${wrongProbeMultiPv}`,
        });
        wrongProbeMs = wrongProbeTimer();
        console.log(`pass2 candidate row${t + 1} wrongProbe done mp=${wrongProbeMultiPv}`);
        const candidatesForWrong2 = listWrong2Candidates({
          infos: probe.infos,
          correctUsi,
          actualMoveUsi,
          threshold,
          turnAtS,
          randomSeed: t * 1000 + wrongProbeMultiPv,
        });

        for (const candidate of candidatesForWrong2) {
          const wrongUsi = candidate.info.pv[0];
          if (!wrongUsi || triedWrongMoves.has(wrongUsi)) continue;
          triedWrongMoves.add(wrongUsi);

          console.log(`pass2 depth run row${t + 1} start purpose=wrongFinal reason=${depthRunReason("wrongFinal")} depth=${finalDepth} move=${wrongUsi}`);
          const wrongFinalTimer = startTimer();
          let wrongFinal: PvInfo | null;
          try {
            wrongFinal = await analyzeMove({
              engine,
              positionCommand: positionCommandS,
              depth: finalDepth,
              pvPlies,
              moveUsi: wrongUsi,
              perfLabel: `${candidateLabel}|wrong2-${wrongUsi}-d${finalDepth}`,
              maxDurationMs: maxDepthRunMs,
            });
            const elapsedMs = wrongFinalTimer();
            wrongFinalMs += elapsedMs;
            depthRunLogs.push({ purpose: "wrongFinal", moveUsi: wrongUsi, depth: finalDepth, elapsedMs, status: "OK" });
            console.log(`pass2 depth run row${t + 1} done purpose=wrongFinal reason=${depthRunReason("wrongFinal")} depth=${finalDepth} move=${wrongUsi} elapsed=${elapsedMs}ms`);
          } catch (error) {
            const elapsedMs = wrongFinalTimer();
            wrongFinalMs += elapsedMs;
            depthRunLogs.push({ purpose: "wrongFinal", moveUsi: wrongUsi, depth: finalDepth, elapsedMs, status: "ERROR" });
            console.log(`pass2 depth run row${t + 1} error purpose=wrongFinal reason=${depthRunReason("wrongFinal")} depth=${finalDepth} move=${wrongUsi} elapsed=${elapsedMs}ms`);
            throw error;
          }
          if (wrongFinal) gathered = mergeUniqueByMove(gathered, [wrongFinal]);

          const summary = summarizeWrong2Potential({
            infos: gathered,
            wrong1Usi: actualMoveUsi,
            threshold,
            turnAtS,
          });
          if (summary.foundWrong2) {
            selectedWrongInfo = wrongFinal;
            ok = true;
            break;
          }
        }

        if (!ok) {
          const summary = summarizeWrong2Potential({
            infos: gathered,
            wrong1Usi: actualMoveUsi,
            threshold,
            turnAtS,
          });
          giveUpReason = `悪手不足 worstLoss=${summary.worstLoss}`;
        }
      }
    } catch (error: any) {
      giveUpReason = error?.message ?? String(error);
      console.log(`pass2 candidate row${t + 1} failed: ${giveUpReason}`);
    }

    console.log(
      `pass2 timing row${t + 1}: total=${candidateTimer()}ms best=${bestMs}ms actual=${actualMs}ms wrongProbe=${wrongProbeMs}ms wrongFinal=${wrongFinalMs}ms`,
    );
    const depthRunTotalMs = depthRunLogs.reduce((sum, run) => sum + run.elapsedMs, 0);
    console.log(`pass2 depth summary row${t + 1}: count=${depthRunLogs.length} total=${depthRunTotalMs}ms`);
    for (const [index, run] of depthRunLogs.entries()) {
      console.log(
        `pass2 depth summary row${t + 1} #${index + 1}: purpose=${run.purpose} reason=${depthRunReason(run.purpose)} depth=${run.depth} move=${run.moveUsi ?? "all"} status=${run.status} elapsed=${run.elapsedMs}ms`,
      );
    }

    const rootSfenRaw = buildRootSfenWithMoveNumber(initialSfen, moves, t - 1);
    const rootSfen = correctRootSfenMeta({
      rootSfen: rootSfenRaw,
      initialSfen,
      appliedPlies: t - 1,
    });

    if (ok) {
      results.push({ t, rootSfen, introMoveUsi, actualMoveUsi, infos: gathered });
      nextPass2T = t + minCandidateGapPlies;
    }

    pass2LogItems.push({
      t,
      depth: finalDepth,
      positionCommand: positionCommandS,
      turnAtS,
      status: ok ? "OK" : "NG",
      reason: ok ? null : giveUpReason ?? "不採用",
      best: finalBest,
      actual: actualInfo,
      wrong: selectedWrongInfo,
    });
  }

  console.log(`pass2結果: ${pass2LogItems.length}件`);
  for (const item of pass2LogItems) {
    console.log(formatPass2LogItem(item));
    console.log(`pass2 sfen row${item.t + 1}: ${item.positionCommand}`);
  }

  return results;
}
