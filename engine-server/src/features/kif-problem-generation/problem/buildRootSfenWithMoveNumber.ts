// src/problem/buildRootSfenWithMoveNumber.ts
import { sfenAtPly } from "../shogi/sfenEngine";

// beforeMoveIndex = moves の何手目を指す直前か
// 0 なら初期局面，i なら moves[0..i-1] を適用した局面
export function buildRootSfenWithMoveNumber(
  startSfen: string,
  moves: string[],
  beforeMoveIndex: number
): string {
  if (beforeMoveIndex < 0) throw new Error("beforeMoveIndex must be >= 0");
  if (beforeMoveIndex > moves.length) throw new Error("beforeMoveIndex out of range");

  return sfenAtPly(startSfen, moves, beforeMoveIndex);
}