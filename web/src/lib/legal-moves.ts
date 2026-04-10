import type { Board, Side, HandPieceType } from '../types/shogi';

type Dir = [number, number];

const KING_DIRS: Dir[] = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

const GOLD_DIRS_SENTE: Dir[] = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,0]];
const GOLD_DIRS_GOTE: Dir[] = [[1,-1],[1,0],[1,1],[0,-1],[0,1],[-1,0]];

const SILVER_DIRS_SENTE: Dir[] = [[-1,-1],[-1,0],[-1,1],[1,-1],[1,1]];
const SILVER_DIRS_GOTE: Dir[] = [[1,-1],[1,0],[1,1],[-1,-1],[-1,1]];

const KNIGHT_DIRS_SENTE: Dir[] = [[-2,-1],[-2,1]];
const KNIGHT_DIRS_GOTE: Dir[] = [[2,-1],[2,1]];

const ROOK_DIRS: Dir[] = [[-1,0],[1,0],[0,-1],[0,1]];
const BISHOP_DIRS: Dir[] = [[-1,-1],[-1,1],[1,-1],[1,1]];

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < 9 && c >= 0 && c < 9;
}

function slideSquares(
  board: Board, row: number, col: number, dr: number, dc: number, side: Side,
): { row: number; col: number }[] {
  const results: { row: number; col: number }[] = [];
  let r = row + dr;
  let c = col + dc;
  while (inBounds(r, c)) {
    const cell = board[r][c];
    if (cell === null) {
      results.push({ row: r, col: c });
    } else if (cell.side !== side) {
      results.push({ row: r, col: c });
      break;
    } else {
      break;
    }
    r += dr;
    c += dc;
  }
  return results;
}

function stepSquares(
  board: Board, row: number, col: number, dirs: Dir[], side: Side,
): { row: number; col: number }[] {
  const results: { row: number; col: number }[] = [];
  for (const [dr, dc] of dirs) {
    const r = row + dr;
    const c = col + dc;
    if (!inBounds(r, c)) continue;
    const cell = board[r][c];
    if (cell === null || cell.side !== side) {
      results.push({ row: r, col: c });
    }
  }
  return results;
}

function mergeSquares(
  a: { row: number; col: number }[],
  b: { row: number; col: number }[],
): { row: number; col: number }[] {
  const seen = new Set(a.map(s => `${s.row},${s.col}`));
  const result = [...a];
  for (const s of b) {
    const key = `${s.row},${s.col}`;
    if (!seen.has(key)) {
      result.push(s);
      seen.add(key);
    }
  }
  return result;
}

export function getValidDestinations(
  board: Board, row: number, col: number, sideToMove: Side,
): { row: number; col: number }[] {
  const piece = board[row][col];
  if (!piece || piece.side !== sideToMove) return [];

  const isSente = sideToMove === 'sente';
  const { type, promoted } = piece;

  // Promoted minor pieces move like gold
  if (promoted && (type === 'P' || type === 'L' || type === 'N' || type === 'S')) {
    return stepSquares(board, row, col, isSente ? GOLD_DIRS_SENTE : GOLD_DIRS_GOTE, sideToMove);
  }

  // Promoted rook (dragon): rook + diagonal king moves
  if (promoted && type === 'R') {
    const rook = ROOK_DIRS.flatMap(([dr, dc]) => slideSquares(board, row, col, dr, dc, sideToMove));
    const diag = stepSquares(board, row, col, [[-1,-1],[-1,1],[1,-1],[1,1]], sideToMove);
    return mergeSquares(rook, diag);
  }

  // Promoted bishop (horse): bishop + orthogonal king moves
  if (promoted && type === 'B') {
    const bishop = BISHOP_DIRS.flatMap(([dr, dc]) => slideSquares(board, row, col, dr, dc, sideToMove));
    const ortho = stepSquares(board, row, col, [[-1,0],[1,0],[0,-1],[0,1]], sideToMove);
    return mergeSquares(bishop, ortho);
  }

  switch (type) {
    case 'K':
      return stepSquares(board, row, col, KING_DIRS, sideToMove);
    case 'G':
      return stepSquares(board, row, col, isSente ? GOLD_DIRS_SENTE : GOLD_DIRS_GOTE, sideToMove);
    case 'S':
      return stepSquares(board, row, col, isSente ? SILVER_DIRS_SENTE : SILVER_DIRS_GOTE, sideToMove);
    case 'N':
      return stepSquares(board, row, col, isSente ? KNIGHT_DIRS_SENTE : KNIGHT_DIRS_GOTE, sideToMove);
    case 'L':
      return slideSquares(board, row, col, isSente ? -1 : 1, 0, sideToMove);
    case 'P':
      return stepSquares(board, row, col, [isSente ? [-1, 0] : [1, 0]], sideToMove);
    case 'R':
      return ROOK_DIRS.flatMap(([dr, dc]) => slideSquares(board, row, col, dr, dc, sideToMove));
    case 'B':
      return BISHOP_DIRS.flatMap(([dr, dc]) => slideSquares(board, row, col, dr, dc, sideToMove));
    default:
      return [];
  }
}

export function getValidDropSquares(
  board: Board, sideToMove: Side, pieceType: HandPieceType,
): { row: number; col: number }[] {
  const results: { row: number; col: number }[] = [];
  const isSente = sideToMove === 'sente';

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] !== null) continue;

      if (pieceType === 'P') {
        if (isSente && r === 0) continue;
        if (!isSente && r === 8) continue;
        // 二歩 check
        let hasPawn = false;
        for (let rr = 0; rr < 9; rr++) {
          const cell = board[rr][c];
          if (cell && cell.type === 'P' && cell.side === sideToMove && !cell.promoted) {
            hasPawn = true;
            break;
          }
        }
        if (hasPawn) continue;
      }

      if (pieceType === 'L') {
        if (isSente && r === 0) continue;
        if (!isSente && r === 8) continue;
      }

      if (pieceType === 'N') {
        if (isSente && r <= 1) continue;
        if (!isSente && r >= 7) continue;
      }

      results.push({ row: r, col: c });
    }
  }
  return results;
}
