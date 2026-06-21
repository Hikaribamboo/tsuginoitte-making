import {
  applyUsiMove,
  parseSfen,
  usiToIdx,
  type Color,
  type Piece,
  type PieceBase,
  type Position,
} from '../kif-problem-generation/shogi/sfenEngine.js';
import type { DraftLineContinuationFeatures, DraftProblem, DraftProblemChoice } from './types.js';

type BoardIndex = { r: number; f: number };
type MoveEndpoints = { from: string | null; to: string | null; isDrop: boolean; isPromotion: boolean; dropPiece: PieceBase | null };

const zenkakuDigits: Record<number, string> = {
  1: '１',
  2: '２',
  3: '３',
  4: '４',
  5: '５',
  6: '６',
  7: '７',
  8: '８',
  9: '９',
};

const kansuji: Record<number, string> = {
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
  7: '七',
  8: '八',
  9: '九',
};

function other(color: Color): Color {
  return color === 'b' ? 'w' : 'b';
}

function inBoard(idx: BoardIndex): boolean {
  return idx.r >= 0 && idx.r < 9 && idx.f >= 0 && idx.f < 9;
}

function squareToJapanese(square: string | null): string | null {
  if (!square || square.length !== 2) return null;
  const file = Number(square[0]);
  const rank = square.charCodeAt(1) - 'a'.charCodeAt(0) + 1;
  const fileText = zenkakuDigits[file];
  const rankText = kansuji[rank];
  return fileText && rankText ? `${fileText}${rankText}` : null;
}

function pieceName(piece: Pick<Piece, 'base' | 'prom'> | null): string | null {
  if (!piece) return null;
  if (piece.prom) {
    switch (piece.base) {
      case 'P':
        return 'と金';
      case 'L':
        return '成香';
      case 'N':
        return '成桂';
      case 'S':
        return '成銀';
      case 'B':
        return '馬';
      case 'R':
        return '龍';
      default:
        break;
    }
  }

  switch (piece.base) {
    case 'P':
      return '歩';
    case 'L':
      return '香';
    case 'N':
      return '桂';
    case 'S':
      return '銀';
    case 'G':
      return '金';
    case 'B':
      return '角';
    case 'R':
      return '飛車';
    case 'K':
      return '玉';
    default:
      return null;
  }
}

function moveLabelPieceName(piece: Pick<Piece, 'base' | 'prom'> | null): string | null {
  if (!piece) return null;
  switch (piece.base) {
    case 'P':
      return '歩';
    case 'L':
      return '香';
    case 'N':
      return '桂';
    case 'S':
      return '銀';
    case 'G':
      return '金';
    case 'B':
      return '角';
    case 'R':
      return '飛';
    case 'K':
      return '玉';
    default:
      return null;
  }
}

function turnPrefix(color: Color): '▲' | '△' {
  return color === 'b' ? '▲' : '△';
}

function parseMoveEndpoints(usi: string): MoveEndpoints {
  const isPromotion = usi.endsWith('+');
  if (usi.includes('*')) {
    const [dropPiece, to] = usi.split('*');
    return {
      from: null,
      to: to ?? null,
      isDrop: true,
      isPromotion: false,
      dropPiece: (dropPiece ?? null) as PieceBase | null,
    };
  }

  const core = isPromotion ? usi.slice(0, -1) : usi;
  return {
    from: core.slice(0, 2),
    to: core.slice(2, 4),
    isDrop: false,
    isPromotion,
    dropPiece: null,
  };
}

function labelMove(pos: Position, usi: string): string | null {
  const endpoints = parseMoveEndpoints(usi);
  const destination = squareToJapanese(endpoints.to);
  if (!destination) return null;

  const piece = endpoints.isDrop
    ? endpoints.dropPiece
      ? { c: pos.turn, base: endpoints.dropPiece, prom: false }
      : null
    : endpoints.from
      ? pos.board[usiToIdx(endpoints.from).r]?.[usiToIdx(endpoints.from).f] ?? null
      : null;
  const name = moveLabelPieceName(piece);
  if (!name) return null;

  return `${turnPrefix(pos.turn)}${destination}${name}${endpoints.isDrop ? '打' : ''}${endpoints.isPromotion ? '成' : ''}`;
}

function addStepAttacks(pos: Position, from: BoardIndex, color: Color, offsets: BoardIndex[], result: BoardIndex[]): void {
  for (const offset of offsets) {
    const to = { r: from.r + offset.r, f: from.f + offset.f };
    if (!inBoard(to)) continue;
    const target = pos.board[to.r][to.f];
    if (target?.c === color) continue;
    result.push(to);
  }
}

function addRayAttacks(pos: Position, from: BoardIndex, color: Color, directions: BoardIndex[], result: BoardIndex[]): void {
  for (const direction of directions) {
    let to = { r: from.r + direction.r, f: from.f + direction.f };
    while (inBoard(to)) {
      const target = pos.board[to.r][to.f];
      if (target?.c === color) break;
      result.push({ ...to });
      if (target) break;
      to = { r: to.r + direction.r, f: to.f + direction.f };
    }
  }
}

function goldOffsets(color: Color): BoardIndex[] {
  const forward = color === 'b' ? -1 : 1;
  const backward = -forward;
  return [
    { r: forward, f: -1 },
    { r: forward, f: 0 },
    { r: forward, f: 1 },
    { r: 0, f: -1 },
    { r: 0, f: 1 },
    { r: backward, f: 0 },
  ];
}

function silverOffsets(color: Color): BoardIndex[] {
  const forward = color === 'b' ? -1 : 1;
  const backward = -forward;
  return [
    { r: forward, f: -1 },
    { r: forward, f: 0 },
    { r: forward, f: 1 },
    { r: backward, f: -1 },
    { r: backward, f: 1 },
  ];
}

function attackSquaresForPiece(pos: Position, from: BoardIndex, piece: Piece): BoardIndex[] {
  const result: BoardIndex[] = [];
  const forward = piece.c === 'b' ? -1 : 1;

  if (piece.prom && ['P', 'L', 'N', 'S'].includes(piece.base)) {
    addStepAttacks(pos, from, piece.c, goldOffsets(piece.c), result);
    return result;
  }

  switch (piece.base) {
    case 'P':
      addStepAttacks(pos, from, piece.c, [{ r: forward, f: 0 }], result);
      break;
    case 'L':
      addRayAttacks(pos, from, piece.c, [{ r: forward, f: 0 }], result);
      break;
    case 'N':
      addStepAttacks(pos, from, piece.c, [{ r: forward * 2, f: -1 }, { r: forward * 2, f: 1 }], result);
      break;
    case 'S':
      addStepAttacks(pos, from, piece.c, silverOffsets(piece.c), result);
      break;
    case 'G':
      addStepAttacks(pos, from, piece.c, goldOffsets(piece.c), result);
      break;
    case 'B':
      addRayAttacks(pos, from, piece.c, [{ r: -1, f: -1 }, { r: -1, f: 1 }, { r: 1, f: -1 }, { r: 1, f: 1 }], result);
      if (piece.prom) addStepAttacks(pos, from, piece.c, [{ r: -1, f: 0 }, { r: 0, f: -1 }, { r: 0, f: 1 }, { r: 1, f: 0 }], result);
      break;
    case 'R':
      addRayAttacks(pos, from, piece.c, [{ r: -1, f: 0 }, { r: 0, f: -1 }, { r: 0, f: 1 }, { r: 1, f: 0 }], result);
      if (piece.prom) addStepAttacks(pos, from, piece.c, [{ r: -1, f: -1 }, { r: -1, f: 1 }, { r: 1, f: -1 }, { r: 1, f: 1 }], result);
      break;
    case 'K':
      addStepAttacks(pos, from, piece.c, [
        { r: -1, f: -1 },
        { r: -1, f: 0 },
        { r: -1, f: 1 },
        { r: 0, f: -1 },
        { r: 0, f: 1 },
        { r: 1, f: -1 },
        { r: 1, f: 0 },
        { r: 1, f: 1 },
      ], result);
      break;
    default:
      break;
  }

  return result;
}

function continuationLine(choice: DraftProblemChoice): string[] {
  const line = Array.isArray(choice.line) ? choice.line.filter((move) => typeof move === 'string' && move.length > 0) : [];
  return line[0] === choice.usi ? line.slice(1) : line;
}

function applyMoves(pos: Position, moves: string[]): void {
  for (const move of moves) {
    if (!move) continue;
    applyUsiMove(pos, move);
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function extractDraftLineContinuationFeatures(
  problem: DraftProblem,
  choice: DraftProblemChoice,
): DraftLineContinuationFeatures {
  const posBeforeChoice = parseSfen(problem.root_sfen);
  applyMoves(posBeforeChoice, problem.intro_moves_usi);

  const choiceEndpoints = parseMoveEndpoints(choice.usi);
  const choiceToIdx = choiceEndpoints.to ? usiToIdx(choiceEndpoints.to) : null;
  const movingBeforeChoice = choiceEndpoints.isDrop
    ? choiceEndpoints.dropPiece
      ? { c: posBeforeChoice.turn, base: choiceEndpoints.dropPiece, prom: false }
      : null
    : choiceEndpoints.from
      ? posBeforeChoice.board[usiToIdx(choiceEndpoints.from).r]?.[usiToIdx(choiceEndpoints.from).f] ?? null
      : null;

  applyUsiMove(posBeforeChoice, choice.usi);
  const posAfterChoice = posBeforeChoice;
  const movedAfterChoice = choiceToIdx ? posAfterChoice.board[choiceToIdx.r][choiceToIdx.f] : null;
  const attacksAfterChoice = movedAfterChoice && choiceToIdx
    ? attackSquaresForPiece(posAfterChoice, choiceToIdx, movedAfterChoice)
    : [];
  const attackedRookSquares = attacksAfterChoice.filter((idx) => {
    const target = posAfterChoice.board[idx.r][idx.f];
    return target?.c === other(movedAfterChoice?.c ?? 'b') && target.base === 'R';
  });

  const line = continuationLine(choice);
  const firstResponse = line[0] ?? null;
  const nextOwnMove = line[1] ?? null;
  const firstResponseLabel = firstResponse ? labelMove(posAfterChoice, firstResponse) : null;

  const firstResponseEndpoints = firstResponse ? parseMoveEndpoints(firstResponse) : null;
  const firstResponseFromIdx = firstResponseEndpoints?.from ? usiToIdx(firstResponseEndpoints.from) : null;
  const firstResponsePiece = firstResponseFromIdx
    ? posAfterChoice.board[firstResponseFromIdx.r]?.[firstResponseFromIdx.f] ?? null
    : null;
  const firstResponseEscapedRook = Boolean(
    firstResponseFromIdx &&
      firstResponsePiece?.base === 'R' &&
      attackedRookSquares.some((idx) => idx.r === firstResponseFromIdx.r && idx.f === firstResponseFromIdx.f),
  );

  if (firstResponse) {
    applyUsiMove(posAfterChoice, firstResponse);
  }
  const posAfterResponse = posAfterChoice;
  const nextOwnMoveLabel = nextOwnMove ? labelMove(posAfterResponse, nextOwnMove) : null;

  const nextOwnEndpoints = nextOwnMove ? parseMoveEndpoints(nextOwnMove) : null;
  const nextOwnFromIdx = nextOwnEndpoints?.from ? usiToIdx(nextOwnEndpoints.from) : null;
  const nextOwnToIdx = nextOwnEndpoints?.to ? usiToIdx(nextOwnEndpoints.to) : null;
  const nextOwnMovingPiece = nextOwnFromIdx
    ? posAfterResponse.board[nextOwnFromIdx.r]?.[nextOwnFromIdx.f] ?? null
    : null;
  const nextOwnCapturedPiece = nextOwnToIdx
    ? posAfterResponse.board[nextOwnToIdx.r]?.[nextOwnToIdx.f] ?? null
    : null;

  const movedPieceContinuesAfterResponse = Boolean(
    choiceEndpoints.to &&
      nextOwnEndpoints?.from &&
      choiceEndpoints.to === nextOwnEndpoints.from &&
      movingBeforeChoice &&
      nextOwnMovingPiece &&
      movingBeforeChoice.base === nextOwnMovingPiece.base,
  );
  const movedPiecePromotesAfterResponse = Boolean(movedPieceContinuesAfterResponse && nextOwnEndpoints?.isPromotion);
  const movedPieceCapturesAfterResponse = Boolean(movedPieceContinuesAfterResponse && nextOwnCapturedPiece);

  const nextOwnMoveFacts: string[] = [];
  if (movedPiecePromotesAfterResponse && movingBeforeChoice?.base === 'B') {
    nextOwnMoveFacts.push('角が成れる');
    nextOwnMoveFacts.push('馬を作れる');
  }
  if (movedPiecePromotesAfterResponse && movingBeforeChoice?.base === 'R') {
    nextOwnMoveFacts.push('飛車が成れる');
    nextOwnMoveFacts.push('龍を作れる');
  }
  if (movedPieceCapturesAfterResponse) {
    const capturedName = pieceName(nextOwnCapturedPiece);
    if (capturedName) nextOwnMoveFacts.push(`次に${capturedName}を取れる`);
  }

  const continuationPhrases: string[] = [];
  if (
    movingBeforeChoice?.base === 'B' &&
    movedAfterChoice?.base === 'B' &&
    firstResponseEscapedRook &&
    movedPiecePromotesAfterResponse
  ) {
    continuationPhrases.push('飛車を逃げても角が成れる');
  }
  if (movedPiecePromotesAfterResponse && movingBeforeChoice?.base === 'B') {
    continuationPhrases.push('角成が残る');
  }
  if (movedPiecePromotesAfterResponse && movingBeforeChoice?.base === 'R') {
    continuationPhrases.push('龍を作れる');
  }

  return {
    choiceId: choice.choice_id,
    lineFirstMoves: [choice.usi, ...line].slice(0, 6),
    firstResponse,
    firstResponseLabel,
    nextOwnMove,
    nextOwnMoveLabel,
    nextOwnMoveFacts: unique(nextOwnMoveFacts),
    continuationPhrases: unique(continuationPhrases),
    movedPieceContinuesAfterResponse,
    movedPiecePromotesAfterResponse,
    movedPieceCapturesAfterResponse,
  };
}

export function extractDraftLineContinuationFeaturesForChoices(
  problem: DraftProblem,
  choices: DraftProblemChoice[],
): DraftLineContinuationFeatures[] {
  return choices.map((choice) => extractDraftLineContinuationFeatures(problem, choice));
}
