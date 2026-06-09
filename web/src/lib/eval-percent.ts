import { parseSfen } from './sfen';
import type { Side } from '../types/shogi';

export const WIN_RATE_K = 1000;

function toUserPerspectiveCp(cp: number, userColor: Side): number {
  return userColor === 'sente' ? cp : -cp;
}

export function cpToWinRatePercent(args: {
  cp: number;
  userColor: Side;
}): number {
  const { cp, userColor } = args;

  if (!Number.isFinite(cp)) {
    throw new Error(`[cpToWinRate] cp must be finite: ${cp}`);
  }

  const effectiveCp = toUserPerspectiveCp(cp, userColor);
  return evalToWinRatePercent(effectiveCp);
}

export function evalToWinRate(evalCp: number, k = WIN_RATE_K): number {
  return 1 / (1 + Math.exp(-evalCp / k));
}

export function evalToWinRatePercent(evalCp: number, k = WIN_RATE_K): number {
  return Math.round(evalToWinRate(evalCp, k) * 100);
}

export function cpToWinRatePercentFromRootSfen(args: {
  cp: number;
  rootSfen: string;
}): number {
  const { cp, rootSfen } = args;
  const userColor = parseSfen(rootSfen).sideToMove;
  return cpToWinRatePercent({ cp, userColor });
}

// Backward-compatible helper used in older call sites
export function evalCpToPercent(cp: number): number {
  return cpToWinRatePercent({ cp, userColor: 'sente' });
}
