// src/eval/cpToWinRate.ts
export type Color = "b" | "w";

export const WIN_RATE_K = 1000;

export function getRootTurnFromSfen(rootSfen: string): Color {
  const parts = rootSfen.trim().split(/\s+/);
  const turn = parts[1];
  if (turn !== "b" && turn !== "w") {
    throw new Error(`[cpToWinRate] invalid root turn in sfen: ${rootSfen}`);
  }
  return turn;
}

export function getUserColorFromRootSfen(rootSfen: string): Color {
  const rootTurn = getRootTurnFromSfen(rootSfen);
  return rootTurn;
}

export function toUserPerspectiveCp(cp: number, userColor: Color): number {
  return userColor === "b" ? cp : -cp;
}

export function evalToWinRate(evalCp: number, k = WIN_RATE_K): number {
  return 1 / (1 + Math.exp(-evalCp / k));
}

export function evalToWinRatePercent(evalCp: number, k = WIN_RATE_K): number {
  return Math.round(evalToWinRate(evalCp, k) * 100);
}

/**
 * Convert cp to user-perspective winrate percent using logistic function.
 *
 * - cp is ALWAYS sente perspective (positive = sente better).
 * - userColor converts cp to user's perspective (effectiveCp).
 */
export function cpToWinRatePercent(args: {
  cp: number;
  userColor: Color;
}): number {
  const { cp, userColor } = args;

  if (!Number.isFinite(cp)) {
    throw new Error(`[cpToWinRate] cp must be finite: ${cp}`);
  }

  const effectiveCp = toUserPerspectiveCp(cp, userColor);
  return evalToWinRatePercent(effectiveCp);
}

export function cpToWinRatePercentFromRootSfen(args: {
  cp: number;
  rootSfen: string;
}): number {
  const { cp, rootSfen } = args;
  const userColor = getUserColorFromRootSfen(rootSfen);
  return cpToWinRatePercent({ cp, userColor });
}
