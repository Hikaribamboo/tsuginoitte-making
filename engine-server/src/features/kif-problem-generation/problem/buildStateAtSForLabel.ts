// src/problem/buildStateAtSForLabel.ts
import { parseSfen, applyUsiMove, type Position } from "../shogi/sfenEngine";

function extractTo(usi: string): string {
  if (usi.includes("*")) return usi.split("*")[1];
  const core = usi.endsWith("+") ? usi.slice(0, -1) : usi;
  return core.slice(2, 4);
}

export type StateForLabel = {
  position: Position;
  lastMoveTo: string | null;
};

export function buildStateAtSForLabel(rootSfen: string, introMoveUsi: string): StateForLabel {
  const base = parseSfen(rootSfen);

  const maybeNext = applyUsiMove(base, introMoveUsi) as unknown;

  // applyUsiMove が Position を返す場合と，破壊的に base を更新して void を返す場合の両対応
  const position =
    maybeNext && typeof maybeNext === "object" && "board" in (maybeNext as any)
      ? (maybeNext as Position)
      : base;

  return {
    position,
    lastMoveTo: extractTo(introMoveUsi),
  };
}