import { applyUsiMove, boardToSfen, parseSfen, parseUsiSquare } from './sfen';
import { getValidDestinations, getValidDropSquares } from './legal-moves';
import { pvToJapanese } from './usi-to-label';
import type { ChoiceDraft } from '../types/problem';
import type { HandPieceType } from '../types/shogi';

type BoardCell = { row: number; col: number };

export type MoveValidationResult =
  | { ok: true }
  | { ok: false; message: string; failedMove?: string; moveIndex: number };

export function pickChoiceFields(draft: ChoiceDraft) {
  const line = draft.line[0] === draft.usi ? draft.line.slice(1) : draft.line;
  return {
    usi: draft.usi,
    label: draft.label,
    explanation: draft.explanation,
    line,
    eval_cp: draft.eval_cp,
    eval_percent: draft.eval_percent,
  };
}

export function buildReplayLine(draft: ChoiceDraft, introMoveUsi = ''): string[] {
  const introMoves = introMoveUsi.trim() ? [introMoveUsi.trim()] : [];
  if (!draft.usi) return draft.line;
  const line = draft.line[0] === draft.usi ? draft.line : [draft.usi, ...draft.line];
  return [...introMoves, ...line];
}

export function buildChoiceLineLabels(draft: ChoiceDraft, sfen: string, maxMoves = 13): string {
  const line = buildReplayLine(draft).filter(Boolean);
  if (line.length === 0) return '';
  return pvToJapanese(line, sfen, Math.min(line.length, maxMoves)).join(' ');
}

export function buildLegalChoicePv(args: {
  rootSfen: string;
  introMoves: string[];
  choiceUsi: string;
  enginePv: string[];
  maxMoves: number;
}): string[] {
  const { rootSfen, introMoves, choiceUsi, enginePv, maxMoves } = args;
  const choiceIndex = enginePv.findIndex((move) => move === choiceUsi);
  const continuation = choiceIndex >= 0
    ? enginePv.slice(choiceIndex + 1)
    : enginePv[0] === choiceUsi
      ? enginePv.slice(1)
      : enginePv;
  const fullPv = [choiceUsi];

  for (const move of continuation) {
    if (fullPv.length >= maxMoves) break;
    if (!move || move === choiceUsi) continue;

    const candidate = [...introMoves, ...fullPv, move];
    if (validateMoveSequence(rootSfen, candidate).ok) {
      fullPv.push(move);
    }
  }

  return fullPv;
}

export function buildSfenAfterMoves(rootSfen: string, moves: string[]): string {
  let state = parseSfen(rootSfen);
  for (const move of moves) {
    const applied = applyUsiMove(
      state.board,
      state.senteHand,
      state.goteHand,
      state.sideToMove,
      move,
    );
    state = {
      ...state,
      board: applied.board,
      senteHand: applied.senteHand,
      goteHand: applied.goteHand,
      sideToMove: state.sideToMove === 'sente' ? 'gote' : 'sente',
      moveNumber: state.moveNumber + 1,
    };
  }

  return boardToSfen(
    state.board,
    state.sideToMove,
    state.senteHand,
    state.goteHand,
    state.moveNumber,
  );
}

export function validateMoveSequence(rootSfen: string, moves: string[]): MoveValidationResult {
  try {
    let state = parseSfen(rootSfen);
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i].trim();
      if (!move) continue;

      const single = validateSingleMove(state, move);
      if (single) {
        return { ok: false, message: single, failedMove: move, moveIndex: i + 1 };
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
    return {
      ok: false,
      message: error?.message ?? String(error),
      moveIndex: 1,
    };
  }
}

function validateSingleMove(state: ReturnType<typeof parseSfen>, move: string): string | null {
  if (/^[PLNSGBR]\*[1-9][a-i]$/i.test(move)) {
    const pieceType = move[0].toUpperCase() as HandPieceType;
    const to = parseUsiSquare(move.slice(2, 4));
    if (!isBoardCellInBounds(to)) return '打つマスが盤外です';
    const hand = state.sideToMove === 'sente' ? state.senteHand : state.goteHand;
    if ((hand[pieceType] ?? 0) <= 0) return '持ち駒にない駒を打っています';
    const destinations = getValidDropSquares(state.board, state.sideToMove, pieceType);
    if (!destinations.some((dest) => dest.row === to.row && dest.col === to.col)) {
      return 'そのマスには打てません';
    }
    return null;
  }

  if (!/^[1-9][a-i][1-9][a-i]\+?$/i.test(move)) {
    return 'USI形式が不正です';
  }

  const from = parseUsiSquare(move.slice(0, 2));
  const to = parseUsiSquare(move.slice(2, 4));
  if (!isBoardCellInBounds(from) || !isBoardCellInBounds(to)) return 'USI座標が盤外です';

  const piece = state.board[from.row]?.[from.col] ?? null;
  if (!piece) return '移動元に駒がありません';
  if (piece.side !== state.sideToMove) return '手番と違う側の駒を動かしています';

  const target = state.board[to.row]?.[to.col] ?? null;
  if (target && target.side === state.sideToMove) return '自分の駒があるマスには移動できません';

  const destinations = getValidDestinations(state.board, from.row, from.col, state.sideToMove);
  if (!destinations.some((dest) => dest.row === to.row && dest.col === to.col)) {
    return 'その駒はそのマスへ動けません';
  }

  return null;
}

function isBoardCellInBounds(cell: BoardCell): boolean {
  return cell.row >= 0 && cell.row < 9 && cell.col >= 0 && cell.col < 9;
}

export function formatMoveValidationError(prefix: string, validation: Extract<MoveValidationResult, { ok: false }>): string {
  const move = validation.failedMove ? `（${validation.failedMove}）` : '';
  return `${prefix}: ${validation.moveIndex}手目${move} ${validation.message}`;
}
