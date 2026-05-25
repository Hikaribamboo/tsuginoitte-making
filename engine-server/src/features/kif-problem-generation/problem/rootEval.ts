// src/problem/rootEval.ts
import type { EngineClient, PvInfo } from "../../../services/engine/engineClient";

export type Color = "b" | "w";

function buildPositionCommandFromRootSfen(rootSfen: string): string {
  return `position sfen ${rootSfen}`;
}

function getTurnFromSfen(sfen: string): Color {
  const parts = sfen.trim().split(/\s+/);
  const turn = parts[1];
  if (turn !== "b" && turn !== "w") {
    throw new Error(`[rootEval] invalid turn in sfen: ${sfen}`);
  }
  return turn;
}

function pickBestCpInfo(infos: PvInfo[]): PvInfo | null {
  const sorted = [...infos].sort((a, b) => a.multipv - b.multipv);
  const best = sorted[0];
  if (!best || best.evalType !== "cp") return null;
  return best;
}

export function normalizeCpToSentePerspective(rawCp: number, sideToMove: Color): number {
  // engine の cp が「現在手番視点」の前提
  // b手番ならそのまま先手視点
  // w手番なら反転して先手視点
  return sideToMove === "b" ? rawCp : -rawCp;
}

export async function evaluateRootSfenCp(args: {
  engine: EngineClient;
  rootSfen: string;
  depth: number;
  pvPlies: number;
  multipv?: number;
}): Promise<number | null> {
  const { engine, rootSfen, depth, pvPlies, multipv = 1 } = args;

  await engine.setMultiPv(multipv);

  const positionCommand = buildPositionCommandFromRootSfen(rootSfen);
  const analysis = await engine.analyze({
    positionCommand,
    depth,
    pvPlies,
    label: "root-eval",
  });

  const best = pickBestCpInfo(analysis.infos);
  if (!best) return null;

  const sideToMove = getTurnFromSfen(rootSfen);
  return normalizeCpToSentePerspective(best.eval, sideToMove);
}
