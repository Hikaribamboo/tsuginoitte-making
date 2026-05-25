// src/shogi/sfenEngine.ts

export type Color = "b" | "w";

export type PieceBase = "K" | "R" | "B" | "G" | "S" | "N" | "L" | "P";

export type Piece = {
  c: Color;
  base: PieceBase;
  prom: boolean;
};

export type Square = Piece | null;

export type Position = {
  board: Square[][];
  turn: Color;
  hands: Record<Color, Record<PieceBase, number>>;
  moveNumber: number;
};

function other(c: Color): Color {
  return c === "b" ? "w" : "b";
}

function emptyBoard(): Square[][] {
  return Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => null)
  );
}

function cloneHands(): Position["hands"] {
  return {
    b: { K: 0, R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 },
    w: { K: 0, R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 }
  };
}

// ---------- 座標 ----------

export function usiToIdx(sq: string) {
  const file = Number(sq[0]);
  const rank = sq.charCodeAt(1) - "a".charCodeAt(0) + 1;
  return {
    r: rank - 1,
    f: 9 - file
  };
}

// ---------- SFEN parse ----------

function pieceFromToken(tok: string): Piece {
  let prom = false;
  let ch = tok;

  if (tok.startsWith("+")) {
    prom = true;
    ch = tok.slice(1);
  }

  const isUpper = ch === ch.toUpperCase();
  return {
    c: isUpper ? "b" : "w",
    base: ch.toUpperCase() as PieceBase,
    prom
  };
}

export function parseSfen(sfen: string): Position {
  const [boardStr, turnStr, handsStr, moveStr] = sfen.split(" ");
  const board = emptyBoard();

  const ranks = boardStr.split("/");
  for (let r = 0; r < 9; r++) {
    let f = 0;
    for (let i = 0; i < ranks[r].length; i++) {
      const ch = ranks[r][i];

      if (ch >= "1" && ch <= "9") {
        f += Number(ch);
        continue;
      }

      if (ch === "+") {
        const next = ranks[r][++i];
        board[r][f++] = pieceFromToken("+" + next);
        continue;
      }

      board[r][f++] = pieceFromToken(ch);
    }
  }

  const hands = cloneHands();

  if (handsStr !== "-") {
    let i = 0;
    while (i < handsStr.length) {
      let num = "";
      while (/\d/.test(handsStr[i])) {
        num += handsStr[i++];
      }
      const count = num ? Number(num) : 1;
      const ch = handsStr[i++];
      const isUpper = ch === ch.toUpperCase();
      const c: Color = isUpper ? "b" : "w";
      const base = ch.toUpperCase() as PieceBase;
      hands[c][base] += count;
    }
  }

  return {
    board,
    turn: turnStr as Color,
    hands,
    moveNumber: Number(moveStr)
  };
}

export function toSfen(pos: Position): string {
  const rows: string[] = [];

  for (let r = 0; r < 9; r++) {
    let row = "";
    let empty = 0;

    for (let f = 0; f < 9; f++) {
      const sq = pos.board[r][f];
      if (!sq) {
        empty++;
        continue;
      }

      if (empty > 0) {
        row += empty;
        empty = 0;
      }

      const ch =
        sq.c === "b" ? sq.base : sq.base.toLowerCase();

      row += sq.prom ? "+" + ch : ch;
    }

    if (empty > 0) row += empty;
    rows.push(row);
  }

  const boardStr = rows.join("/");

  const handsStr = (() => {
    const order: PieceBase[] = ["R","B","G","S","N","L","P"];
    const parts: string[] = [];

    const push = (c: Color) => {
      for (const k of order) {
        const n = pos.hands[c][k];
        if (n > 0) {
          const ch = c === "b" ? k : k.toLowerCase();
          parts.push(n === 1 ? ch : `${n}${ch}`);
        }
      }
    };

    push("b");
    push("w");

    return parts.length === 0 ? "-" : parts.join("");
  })();

  return `${boardStr} ${pos.turn} ${handsStr} ${pos.moveNumber}`;
}

// ---------- USI適用 ----------

export function applyUsiMove(pos: Position, usi: string) {
  const turn = pos.turn;

  if (usi.includes("*")) {
    const [piece, toSq] = usi.split("*");
    const to = usiToIdx(toSq);

    pos.hands[turn][piece as PieceBase]--;
    pos.board[to.r][to.f] = {
      c: turn,
      base: piece as PieceBase,
      prom: false
    };
  } else {
    const from = usiToIdx(usi.slice(0,2));
    const to = usiToIdx(usi.slice(2,4));
    const promote = usi.endsWith("+");

    const moving = pos.board[from.r][from.f]!;
    const captured = pos.board[to.r][to.f];

    if (captured) {
      pos.hands[turn][captured.base]++;
    }

    pos.board[from.r][from.f] = null;
    pos.board[to.r][to.f] = {
      c: turn,
      base: moving.base,
      prom: promote ? true : moving.prom
    };
  }

  pos.turn = other(pos.turn);
  pos.moveNumber++;
}

// ---------- ply指定 ----------

export function sfenAtPly(
  startSfen: string,
  moves: string[],
  ply: number
): string {
  const pos = parseSfen(startSfen);

  for (let i = 0; i < Math.min(ply, moves.length); i++) {
    applyUsiMove(pos, moves[i]);
  }

  return toSfen(pos);
}