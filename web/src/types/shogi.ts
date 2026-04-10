// ---- Piece types ----
export type PieceType = 'K' | 'R' | 'B' | 'G' | 'S' | 'N' | 'L' | 'P';
export type HandPieceType = Exclude<PieceType, 'K'>;
export type Side = 'sente' | 'gote';

export interface Piece {
  type: PieceType;
  side: Side;
  promoted: boolean;
}

export type BoardCell = Piece | null;
export type Board = BoardCell[][]; // [row 0‑8][col 0‑8]

export type HandPieces = Record<HandPieceType, number>;

// ---- Constants ----
export const HAND_PIECE_TYPES: HandPieceType[] = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];

export const EMPTY_HAND: HandPieces = { R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 };

export const MAX_HAND: Record<HandPieceType, number> = {
  R: 2, B: 2, G: 4, S: 4, N: 4, L: 4, P: 18,
};

export function createEmptyBoard(): Board {
  return Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
}

// ---- Kanji mappings ----
export const PIECE_KANJI: Record<PieceType, string> = {
  K: '玉', R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩',
};

export const PROMOTED_KANJI: Record<PieceType, string> = {
  K: '玉', R: '龍', B: '馬', G: '金', S: '成銀', N: '成桂', L: '成香', P: 'と',
};

export const CAN_PROMOTE: Record<PieceType, boolean> = {
  K: false, R: true, B: true, G: false, S: true, N: true, L: true, P: true,
};

// ---- Helper ----
export function pieceKanji(p: Piece): string {
  return p.promoted ? PROMOTED_KANJI[p.type] : PIECE_KANJI[p.type];
}
