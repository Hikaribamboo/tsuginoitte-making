import { parseSfen } from './sfen';
import type { Side } from '../types/shogi';

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toUserPerspectiveCp(cp: number, userColor: Side): number {
  return userColor === 'sente' ? cp : -cp;
}

export function cpToWinRatePercent(args: {
  cp: number;
  userColor: Side;
  scale: number;
}): number {
  const { cp, userColor, scale } = args;

  if (!Number.isFinite(cp)) {
    throw new Error(`[cpToWinRate] cp must be finite: ${cp}`);
  }
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`[cpToWinRate] scale must be > 0: ${scale}`);
  }

  const effectiveCp = toUserPerspectiveCp(cp, userColor);
  const rawPercent = 100 * sigmoid(effectiveCp / scale);
  return clamp(Math.round(rawPercent), 1, 99);
}

export function cpToWinRatePercentFromRootSfen(args: {
  cp: number;
  rootSfen: string;
  scale: number;
}): number {
  const { cp, rootSfen, scale } = args;
  const userColor = parseSfen(rootSfen).sideToMove;
  return cpToWinRatePercent({ cp, userColor, scale });
}

// Backward-compatible helper used in older call sites
export function evalCpToPercent(cp: number): number {
  return cpToWinRatePercent({ cp, userColor: 'sente', scale: 500 });
}
