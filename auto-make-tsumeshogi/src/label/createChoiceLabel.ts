import type { StateForLabel } from "../problem/buildStateAtSForLabel";

type Turn = "b" | "w";

const zenkakuDigits: Record<number, string> = {
  1: "１",
  2: "２",
  3: "３",
  4: "４",
  5: "５",
  6: "６",
  7: "７",
  8: "８",
  9: "９",
};

const kansuji: Record<number, string> = {
  1: "一",
  2: "二",
  3: "三",
  4: "四",
  5: "五",
  6: "六",
  7: "七",
  8: "八",
  9: "九",
};

function prefixOf(turn: Turn): string {
  return turn === "b" ? "▲" : "△";
}

function pieceNameFromChar(c: string): string {
  switch (c) {
    case "P":
      return "歩";
    case "L":
      return "香";
    case "N":
      return "桂";
    case "S":
      return "銀";
    case "G":
      return "金";
    case "B":
      return "角";
    case "R":
      return "飛";
    case "K":
      return "玉";
    default:
      throw new Error(`unknown pieceChar: ${c}`);
  }
}

function promotedName(kind: string): string {
  switch (kind) {
    case "P":
      return "と";
    case "L":
      return "成香";
    case "N":
      return "成桂";
    case "S":
      return "成銀";
    case "B":
      return "馬";
    case "R":
      return "龍";
    case "G":
      return "金";
    case "K":
      return "玉";
    default:
      return pieceNameFromChar(kind);
  }
}

function isPromotable(kind: string): boolean {
  return kind === "P" || kind === "L" || kind === "N" || kind === "S" || kind === "B" || kind === "R";
}

function parseSquareUSI(sq: string): { file: number; rank: number } {
  if (sq.length !== 2) throw new Error(`invalid usi square: ${sq}`);
  const file = Number(sq[0]);
  const rankChar = sq[1];
  const rank = rankChar.charCodeAt(0) - "a".charCodeAt(0) + 1;
  if (file < 1 || file > 9 || rank < 1 || rank > 9) throw new Error(`invalid usi square: ${sq}`);
  return { file, rank };
}

function toJapaneseDest(file: number, rank: number): string {
  const f = zenkakuDigits[file];
  const r = kansuji[rank];
  if (!f || !r) throw new Error(`invalid square: ${file}${rank}`);
  return `${f}${r}`;
}

function usiToIdx(sq: string): { r: number; f: number } {
  const { file, rank } = parseSquareUSI(sq);
  const f = 9 - file;
  const r = rank - 1;
  return { r, f };
}

function extractKindAndPromoted(piece: any): { kind: string; promoted: boolean } {
  // sfenEngineの駒表現差を吸収
  const kind = (piece?.base ?? piece?.k) as string;
  const promoted = Boolean(piece?.prom ?? piece?.p);
  if (!kind) throw new Error("createLabel: piece has no kind");
  return { kind, promoted };
}

function getBoardPiece(state: StateForLabel, fromSq: string): { kind: string; promoted: boolean } {
  const { r, f } = usiToIdx(fromSq);
  const p = state.position.board?.[r]?.[f] ?? null;
  if (!p) throw new Error(`createLabel: no piece on from square: ${fromSq}`);
  return extractKindAndPromoted(p);
}

export function createChoiceLabel(args: { state: StateForLabel; usi: string }): string {
  const { state, usi } = args;

  const prefix = prefixOf(state.position.turn as Turn);

  // drop: "P*6f"
  if (usi.includes("*")) {
    const [pieceChar, toSq] = usi.split("*");
    if (!pieceChar || !toSq) throw new Error(`invalid drop usi: ${usi}`);

    const dest = state.lastMoveTo && state.lastMoveTo === toSq ? "同" : toJapaneseDest(Number(toSq[0]), toSq[1].charCodeAt(0) - 96);

    const pieceName = pieceNameFromChar(pieceChar);
    return `${prefix}${dest}${pieceName}打`;
  }

  // move: "7g7f" or "2d2i+"
  const promote = usi.endsWith("+");
  const core = promote ? usi.slice(0, -1) : usi;
  if (core.length !== 4) throw new Error(`invalid move usi: ${usi}`);

  const fromSq = core.slice(0, 2);
  const toSq = core.slice(2, 4);

  const dest = state.lastMoveTo && state.lastMoveTo === toSq ? "同" : toJapaneseDest(Number(toSq[0]), toSq[1].charCodeAt(0) - 96);

  const { kind, promoted } = getBoardPiece(state, fromSq);
  const baseName = promoted ? promotedName(kind) : pieceNameFromChar(kind);

  const addNari = promote && isPromotable(kind) && !promoted;

  return `${prefix}${dest}${baseName}${addNari ? "成" : ""}`;
}
