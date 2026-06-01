// src/eval/cpToWinRate.ts
export type Color = "b" | "w";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

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

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Convert cp to user-perspective winrate percent using logistic function.
 *
 * p = 1 / (1 + exp(-effectiveCp / K))
 *
 * - cp is ALWAYS sente perspective (positive = sente better).
 * - userColor converts cp to user's perspective (effectiveCp).
 * - scale is used as K (often ~600, sometimes called "Ponanza constant" in explanations).
 */
export function cpToWinRatePercent(args: {
  cp: number;
  userColor: Color;
  scale: number; // treated as K
}): number {
  const { cp, userColor, scale } = args;

  if (!Number.isFinite(cp)) {
    throw new Error(`[cpToWinRate] cp must be finite: ${cp}`);
  }
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`[cpToWinRate] scale must be > 0: ${scale}`);
  }

  const effectiveCp = toUserPerspectiveCp(cp, userColor);

  // Logistic winrate in [0, 1]
  const p = sigmoid(effectiveCp / scale);

  // Convert to percent, keep your existing rounding & clamp policy (1..99)
  const rawPercent = 100 * p;
  return clamp(Math.round(rawPercent), 1, 99);
}

export function cpToWinRatePercentFromRootSfen(args: {
  cp: number;
  rootSfen: string;
  scale: number;
}): number {
  const { cp, rootSfen, scale } = args;
  const userColor = getUserColorFromRootSfen(rootSfen);
  return cpToWinRatePercent({ cp, userColor, scale });
}