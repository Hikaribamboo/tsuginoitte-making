import type {
  Board,
  BoardCell,
  HandPieces,
  HandPieceType,
  Piece,
  PieceType,
  Side,
} from '../types/shogi';
import { createEmptyBoard, EMPTY_HAND, HAND_PIECE_TYPES } from '../types/shogi';

// ---- SFEN → Board state ----

const PIECE_CHAR_TO_TYPE: Record<string, PieceType> = {
  K: 'K', R: 'R', B: 'B', G: 'G', S: 'S', N: 'N', L: 'L', P: 'P',
  k: 'K', r: 'R', b: 'B', g: 'G', s: 'S', n: 'N', l: 'L', p: 'P',
};

export interface SfenState {
  board: Board;
  sideToMove: Side;
  senteHand: HandPieces;
  goteHand: HandPieces;
  moveNumber: number;
}

export function parseSfen(sfen: string): SfenState {
  const parts = sfen.split(' ');
  const boardStr = parts[0] ?? '';
  const sideChar = parts[1] ?? 'b';
  const handStr = parts[2] ?? '-';
  const moveNum = parseInt(parts[3] ?? '1', 10);

  // Parse board
  const board = createEmptyBoard();
  const rows = boardStr.split('/');
  for (let row = 0; row < 9; row++) {
    const rowStr = rows[row] ?? '';
    let col = 0;
    let promoted = false;
    for (let i = 0; i < rowStr.length; i++) {
      const ch = rowStr[i];
      if (ch === '+') {
        promoted = true;
        continue;
      }
      const digit = parseInt(ch, 10);
      if (!isNaN(digit)) {
        col += digit;
        promoted = false;
        continue;
      }
      const type = PIECE_CHAR_TO_TYPE[ch];
      if (type) {
        const side: Side = ch === ch.toUpperCase() ? 'sente' : 'gote';
        board[row][col] = { type, side, promoted };
        col++;
      }
      promoted = false;
    }
  }

  // Parse side to move
  const sideToMove: Side = sideChar === 'w' ? 'gote' : 'sente';

  // Parse hand pieces
  const senteHand: HandPieces = { ...EMPTY_HAND };
  const goteHand: HandPieces = { ...EMPTY_HAND };
  if (handStr !== '-') {
    let count = 0;
    for (let i = 0; i < handStr.length; i++) {
      const ch = handStr[i];
      const digit = parseInt(ch, 10);
      if (!isNaN(digit)) {
        count = count * 10 + digit;
        continue;
      }
      const type = PIECE_CHAR_TO_TYPE[ch];
      if (type && type !== 'K') {
        const handType = type as HandPieceType;
        const n = count === 0 ? 1 : count;
        if (ch === ch.toUpperCase()) {
          senteHand[handType] = n;
        } else {
          goteHand[handType] = n;
        }
      }
      count = 0;
    }
  }

  return { board, sideToMove, senteHand, goteHand, moveNumber: moveNum };
}

// ---- Board state → SFEN ----

function pieceToSfenChar(p: Piece): string {
  const typeMap: Record<PieceType, string> = {
    K: 'K', R: 'R', B: 'B', G: 'G', S: 'S', N: 'N', L: 'L', P: 'P',
  };
  let ch = typeMap[p.type];
  if (p.side === 'gote') ch = ch.toLowerCase();
  return p.promoted ? `+${ch}` : ch;
}

export function boardToSfen(
  board: Board,
  sideToMove: Side,
  senteHand: HandPieces,
  goteHand: HandPieces,
  moveNumber: number,
): string {
  // Board part
  const rows: string[] = [];
  for (let row = 0; row < 9; row++) {
    let rowStr = '';
    let emptyCount = 0;
    for (let col = 0; col < 9; col++) {
      const cell = board[row][col];
      if (cell === null) {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          rowStr += emptyCount;
          emptyCount = 0;
        }
        rowStr += pieceToSfenChar(cell);
      }
    }
    if (emptyCount > 0) rowStr += emptyCount;
    rows.push(rowStr);
  }
  const boardPart = rows.join('/');

  // Side to move
  const sidePart = sideToMove === 'sente' ? 'b' : 'w';

  // Hand pieces
  let handPart = '';
  const handOrder: HandPieceType[] = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
  for (const t of handOrder) {
    if (senteHand[t] > 0) {
      handPart += (senteHand[t] > 1 ? senteHand[t] : '') + t.toUpperCase();
    }
  }
  for (const t of handOrder) {
    if (goteHand[t] > 0) {
      handPart += (goteHand[t] > 1 ? goteHand[t] : '') + t.toLowerCase();
    }
  }
  if (handPart === '') handPart = '-';

  return `${boardPart} ${sidePart} ${handPart} ${moveNumber}`;
}

// ---- Coordinate converters ----

/** USI file (1-9) → board col index (0-8). File 9 = col 0, File 1 = col 8 */
export function fileToCol(file: number): number {
  return 9 - file;
}

/** USI rank (a-i) → board row index (0-8). Rank a = row 0 */
export function rankToRow(rank: string): number {
  return rank.charCodeAt(0) - 'a'.charCodeAt(0);
}

/** Board col → USI file number */
export function colToFile(col: number): number {
  return 9 - col;
}

/** Board row → USI rank char */
export function rowToRank(row: number): string {
  return String.fromCharCode('a'.charCodeAt(0) + row);
}

/** Parse a USI square like "7g" → { row, col } */
export function parseUsiSquare(sq: string): { row: number; col: number } {
  const file = parseInt(sq[0], 10);
  const rank = sq[1];
  return { row: rankToRow(rank), col: fileToCol(file) };
}

/** Format board position to USI square */
export function toUsiSquare(row: number, col: number): string {
  return `${colToFile(col)}${rowToRank(row)}`;
}

// ---- Apply a USI move to board (returns new state) ----

export interface MoveResult {
  board: Board;
  senteHand: HandPieces;
  goteHand: HandPieces;
}

export function applyUsiMove(
  board: Board,
  senteHand: HandPieces,
  goteHand: HandPieces,
  sideToMove: Side,
  usi: string,
): MoveResult {
  const newBoard = board.map((r) => [...r]);
  const newSenteHand = { ...senteHand };
  const newGoteHand = { ...goteHand };
  const myHand = sideToMove === 'sente' ? newSenteHand : newGoteHand;
  const oppHand = sideToMove === 'sente' ? newGoteHand : newSenteHand;

  const isDrop = usi[1] === '*';
  if (isDrop) {
    const pieceType = usi[0] as HandPieceType;
    const to = parseUsiSquare(usi.slice(2, 4));
    newBoard[to.row][to.col] = { type: pieceType, side: sideToMove, promoted: false };
    myHand[pieceType] = Math.max(0, myHand[pieceType] - 1);
  } else {
    const from = parseUsiSquare(usi.slice(0, 2));
    const to = parseUsiSquare(usi.slice(2, 4));
    const promote = usi.length > 4 && usi[4] === '+';

    const movingPiece = newBoard[from.row][from.col];
    if (!movingPiece) return { board: newBoard, senteHand: newSenteHand, goteHand: newGoteHand };

    // Capture
    const captured = newBoard[to.row][to.col];
    if (captured && captured.type !== 'K') {
      const handType = captured.type as HandPieceType;
      myHand[handType] = (myHand[handType] ?? 0) + 1;
    }

    newBoard[to.row][to.col] = {
      ...movingPiece,
      promoted: promote ? true : movingPiece.promoted,
    };
    newBoard[from.row][from.col] = null;
  }

  return { board: newBoard, senteHand: newSenteHand, goteHand: newGoteHand };
}

// ---- Initial position SFEN ----
export const INITIAL_SFEN = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
export const EMPTY_SFEN = '9/9/9/9/9/9/9/9/9 b - 1';
