import { applyUsiMove, parseSfen } from './sfen';
import type { HandPieceType, Side } from '../types/shogi';

export type BasicMoveApplyResult =
  | { ok: true }
  | { ok: false; message: string; failedMove?: string };

export function validateBasicAppliedMoves(
  rootSfen: string,
  introMovesUsi: string[],
  moves: string[],
): BasicMoveApplyResult {
  try {
    let state = parseSfen(rootSfen);
    const allMoves = [...introMovesUsi, ...moves];

    for (const token of allMoves) {
      const move = token.trim();
      if (!isValidUsiToken(move)) {
        return { ok: false, message: `USI形式が不正です: ${move}`, failedMove: move };
      }

      const currentSide: Side = state.sideToMove;
      if (!canApplyBasicMove(state, currentSide, move)) {
        return { ok: false, message: '局面に適用できない手です', failedMove: move };
      }

      const applied = applyUsiMove(
        state.board,
        state.senteHand,
        state.goteHand,
        state.sideToMove,
        move,
      );
      state = {
        board: applied.board,
        senteHand: applied.senteHand,
        goteHand: applied.goteHand,
        sideToMove: state.sideToMove === 'sente' ? 'gote' : 'sente',
        moveNumber: state.moveNumber + 1,
      };
    }

    return { ok: true };
  } catch (error: any) {
    return { ok: false, message: error?.message ?? String(error) };
  }
}

export function isValidUsiToken(token: string): boolean {
  return /^[1-9][a-i][1-9][a-i]\+?$/i.test(token) || /^[PLNSGBRK]\*[1-9][a-i]$/i.test(token);
}

function canApplyBasicMove(
  state: ReturnType<typeof parseSfen>,
  side: Side,
  token: string,
): boolean {
  if (token[1] === '*') {
    const pieceType = token[0].toUpperCase() as HandPieceType;
    if (!['R', 'B', 'G', 'S', 'N', 'L', 'P'].includes(pieceType)) return false;
    const to = parseUsiSquareStrict(token.slice(2, 4));
    const boardPiece = state.board[to.row]?.[to.col] ?? null;
    if (boardPiece) return false;
    const hand = side === 'sente' ? state.senteHand : state.goteHand;
    return (hand[pieceType] ?? 0) > 0;
  }

  const from = parseUsiSquareStrict(token.slice(0, 2));
  const to = parseUsiSquareStrict(token.slice(2, 4));
  const fromPiece = state.board[from.row]?.[from.col] ?? null;
  if (!fromPiece || fromPiece.side !== side) return false;
  const toPiece = state.board[to.row]?.[to.col] ?? null;
  if (toPiece && toPiece.side === side) return false;
  return true;
}

function parseUsiSquareStrict(square: string): { row: number; col: number } {
  const file = Number.parseInt(square[0] ?? '', 10);
  const rank = square[1] ?? '';
  const row = rank.charCodeAt(0) - 'a'.charCodeAt(0);
  const col = 9 - file;

  if (!Number.isInteger(file) || file < 1 || file > 9 || row < 0 || row > 8 || col < 0 || col > 8) {
    throw new Error(`USI座標が不正です: ${square}`);
  }
  return { row, col };
}
