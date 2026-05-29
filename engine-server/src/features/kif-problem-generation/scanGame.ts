// src/scanGame.ts
import type { EngineClient, PvInfo } from "../../services/engine/engineClient";
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

async function analyzeMove(args: {
  engine: EngineClient;
  positionCommand: string;
  depth: number;
  pvPlies: number;
  moveUsi: string;
  perfLabel?: string;
}): Promise<PvInfo | null> {
  const { engine, positionCommand, depth, pvPlies, moveUsi, perfLabel } = args;

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

    const isCandidate = diff >= config.suspiciousMinDiff && diff <= config.suspiciousMaxDiff;
    if (isCandidate || config.scan.debugAllPass1) {
      console.log(
        `pass1${isCandidate ? "候補" : "確認"}: t ${t} row ${t + 1} turn ${turnAtS} actual ${actualMoveUsi} best ${best.pv[0] ?? "-"} rawBest=${best.eval} rawActual=${actual.eval} senteBest=${bestEvalSente} senteActual=${actualEvalSente} loss=${diff}`
      );
    }

    if (isCandidate) {
      candidates.push({ t, diff, introMoveUsi, actualMoveUsi });
    }
  }

  const pass2Targets = candidates.slice().sort((a, b) => a.t - b.t);
  const acceptedGap = config.finalize.minCandidateGapPlies ?? 30;

  console.log(`pass1候補t一覧: ${candidates
         .slice()
         .sort((a, b) => a.t - b.t)
         .map((x) => x.t)
         .join(",")}`);

  console.log(`pass1結果: 候補手 ${candidates.length}，pass2候補手 ${pass2Targets.length}`);
  console.log("pass2開始");

  const results: ScanResult[] = [];
  const acceptedTs: number[] = [];
  let attemptedPass2 = 0;

  for (const c of pass2Targets) {
    if (results.length >= (config.maxScanResultsPerGame ?? 9999)) break;
    if (attemptedPass2 >= config.maxCandidates) break;
    const skippedByAcceptedGap = acceptedTs.some((acceptedT) => c.t > acceptedT && c.t - acceptedT < acceptedGap);
    if (skippedByAcceptedGap) {
      console.log(`pass2候補: skip t ${c.t}，採用済み候補から${acceptedGap}手以内`);
      continue;
    }
    attemptedPass2 += 1;

    const candidateLabel = `scanGame.pass2.t${c.t}`;
    const { t, introMoveUsi, actualMoveUsi } = c;

    const movesToS = moves.slice(0, t);
    const turnAtS = getTurnAtS(initialTurn, t);
    const positionCommandS = buildPositionCommand(initialSfen, movesToS);

    const pvPlies = Math.max(config.finalize.pvPlies, 9);
    const finalDepth = config.finalize.depth;
    const wrongProbeDepth = Math.min(16, finalDepth);
    const shouldTryMp15 = t % 5 === 0;
    const wrongProbeMps = shouldTryMp15 ? [5, 10, 15] : [5, 10];
    const threshold = config.finalize.blunderThresholdCp ?? 400;

    const rejectIfBestTooBadCp = config.finalize.rejectIfBestTooBadCp;
    const rejectIfBestTooGoodCp = config.finalize.rejectIfBestTooGoodCp;

    let gathered: PvInfo[] = [];
    let giveUpReason: string | null = null;
    let ok = false;

    console.log(`pass2候補: start t ${t} d${finalDepth} actual ${actualMoveUsi} turn ${turnAtS}`);

    await engine.setMultiPv(1);
    const bestAnalysis = await engine.analyze({
      positionCommand: positionCommandS,
      depth: finalDepth,
      pvPlies,
      label: `scan-pass2-t${t}-best-d${finalDepth}`,
    });
    gathered = mergeUniqueByMove(gathered, bestAnalysis.infos);
    const finalBest = pickBestCpInfo(bestAnalysis.infos);
    const correctUsi = finalBest?.pv[0] ?? null;

    if (!finalBest || !correctUsi) {
      giveUpReason = "最善手なし";
    } else {
      const userCp = computeUserCpFromGathered({ gathered, questionTurn: turnAtS });
      if (userCp != null && rejectIfBestTooBadCp != null && userCp < -rejectIfBestTooBadCp) {
        giveUpReason = `ユーザー不利 userCp ${userCp} 下限 ${rejectIfBestTooBadCp}`;
      } else if (userCp != null && rejectIfBestTooGoodCp != null && userCp > rejectIfBestTooGoodCp) {
        giveUpReason = `ユーザー有利すぎ userCp ${userCp} 上限 ${rejectIfBestTooGoodCp}`;
      }
    }

    if (!giveUpReason) {
      const actualInfo = await analyzeMove({
        engine,
        positionCommand: positionCommandS,
        depth: finalDepth,
        pvPlies,
        moveUsi: actualMoveUsi,
        perfLabel: `${candidateLabel}|actual-d${finalDepth}`,
      });
      if (actualInfo) gathered = mergeUniqueByMove(gathered, [actualInfo]);
      if (!actualInfo) giveUpReason = "実戦手評価なし";
    }

    if (!giveUpReason && correctUsi) {
      const triedWrongMoves = new Set<string>();

      for (const mp of wrongProbeMps) {
        await engine.setMultiPv(mp);
        const probe = await engine.analyze({
          positionCommand: positionCommandS,
          depth: wrongProbeDepth,
          pvPlies,
          label: `scan-pass2-t${t}-wrongProbe-d${wrongProbeDepth}-mp${mp}`,
        });
        const candidatesForWrong2 = listWrong2Candidates({
          infos: probe.infos,
          correctUsi,
          actualMoveUsi,
          threshold,
          turnAtS,
          randomSeed: t * 1000 + mp,
        });
        console.log(`pass2候補: 悪手探索 t ${t} d${wrongProbeDepth} mp${mp} 候補${candidatesForWrong2.length}`);

        for (const candidate of candidatesForWrong2) {
          const wrongUsi = candidate.info.pv[0];
          if (!wrongUsi || triedWrongMoves.has(wrongUsi)) continue;
          triedWrongMoves.add(wrongUsi);

          const wrongFinal = await analyzeMove({
            engine,
            positionCommand: positionCommandS,
            depth: finalDepth,
            pvPlies,
            moveUsi: wrongUsi,
            perfLabel: `${candidateLabel}|wrong2-${wrongUsi}-d${finalDepth}`,
          });
          if (wrongFinal) gathered = mergeUniqueByMove(gathered, [wrongFinal]);

          const summary = summarizeWrong2Potential({
            infos: gathered,
            wrong1Usi: actualMoveUsi,
            threshold,
            turnAtS,
          });
          console.log(
            `pass2候補: 悪手再評価 t ${t} move ${wrongUsi} d${finalDepth} found=${summary.foundWrong2 ? "true" : "false"} worstLoss=${summary.worstLoss}`
          );

          if (summary.foundWrong2) {
            ok = true;
            break;
          }
        }

        if (ok) break;
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

    const rootSfenRaw = buildRootSfenWithMoveNumber(initialSfen, moves, t - 1);
    const rootSfen = correctRootSfenMeta({
      rootSfen: rootSfenRaw,
      initialSfen,
      appliedPlies: t - 1,
    });

    if (ok) {
      results.push({ t, rootSfen, introMoveUsi, actualMoveUsi, infos: gathered });
      acceptedTs.push(t);
      console.log(`pass2候補: OK，t ${t}`);
    } else {
      const reason = giveUpReason ?? "条件未達";
      console.log(`pass2候補: NG，t ${t}，理由 ${reason}`);
    }
  }

  return results;
}
