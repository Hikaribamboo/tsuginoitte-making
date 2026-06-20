import {
  CAN_PROMOTE,
  HAND_PIECE_TYPES,
  type Board as BoardType,
  type HandPieces,
  type HandPieceType,
  type Piece,
  type PieceType,
  type Side,
} from '../types/shogi';

export type PieceSelection =
  | { source: 'board'; row: number; col: number; piece: Piece }
  | { source: 'hand'; side: Side; type: HandPieceType; piece: Piece }
  | { source: 'box'; type: PieceType; piece: Piece };

export const PIECE_TYPES: PieceType[] = ['K', 'R', 'B', 'G', 'S', 'N', 'L', 'P'];

export const TOTAL_PIECES: Record<PieceType, number> = {
  K: 2,
  R: 2,
  B: 2,
  G: 4,
  S: 4,
  N: 4,
  L: 4,
  P: 18,
};

export function cloneBoard(board: BoardType): BoardType {
  return board.map((row) => row.map((piece) => (piece ? { ...piece } : null)));
}

export function cloneHand(hand: HandPieces): HandPieces {
  return { ...hand };
}

export function createFullPieceBox(): Record<PieceType, number> {
  return { ...TOTAL_PIECES };
}

export function isHandPieceType(type: PieceType): type is HandPieceType {
  return type !== 'K';
}

export function rotatePieceVariant(piece: Piece): Piece {
  if (!CAN_PROMOTE[piece.type]) {
    return { ...piece, side: piece.side === 'sente' ? 'gote' : 'sente' };
  }
  if (!piece.promoted) {
    return { ...piece, promoted: true };
  }
  if (piece.side === 'sente') {
    return { ...piece, side: 'gote', promoted: false };
  }
  return { ...piece, side: 'sente', promoted: false };
}

export function countPositionPieces(
  board: BoardType,
  senteHand: HandPieces,
  goteHand: HandPieces,
): Record<PieceType, number> {
  const counts = PIECE_TYPES.reduce((acc, type) => {
    acc[type] = 0;
    return acc;
  }, {} as Record<PieceType, number>);

  for (const row of board) {
    for (const piece of row) {
      if (piece) counts[piece.type] += 1;
    }
  }
  for (const type of HAND_PIECE_TYPES) {
    counts[type] += senteHand[type] + goteHand[type];
  }
  return counts;
}

export function missingPieceCounts(
  board: BoardType,
  senteHand: HandPieces,
  goteHand: HandPieces,
): Record<PieceType, number> {
  const counts = countPositionPieces(board, senteHand, goteHand);
  return PIECE_TYPES.reduce((acc, type) => {
    acc[type] = Math.max(0, TOTAL_PIECES[type] - counts[type]);
    return acc;
  }, {} as Record<PieceType, number>);
}

export function selectionMatchesBoard(selection: PieceSelection | null, row: number, col: number): boolean {
  return selection?.source === 'board' && selection.row === row && selection.col === col;
}
