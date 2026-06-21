import {
  applyUsiMove,
  parseSfen,
  usiToIdx,
  type Color,
  type Piece,
  type PieceBase,
  type Position,
} from '../kif-problem-generation/shogi/sfenEngine.js';
import type { DraftPositionFeatures, DraftProblem, DraftProblemChoice } from './types.js';

type BoardIndex = { r: number; f: number };
type MoveEndpoints = { from: string | null; to: string | null; isDrop: boolean; isPromotion: boolean; dropPiece: PieceBase | null };

const HIGH_VALUE_PIECES = new Set(['飛車', '角', '金', '銀']);
const LONG_RANGE_BASES = new Set<PieceBase>(['R', 'B', 'L']);

const PIECE_VALUES: Record<string, number> = {
  歩: 1,
  香: 3,
  桂: 3,
  銀: 5,
  金: 6,
  角: 8,
  飛車: 10,
  と金: 6,
  成香: 6,
  成桂: 6,
  成銀: 6,
  馬: 10,
  龍: 12,
  玉: 0,
};

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

function idxToJapanese(idx: BoardIndex): string {
  const file = 9 - idx.f;
  const rank = idx.r + 1;
  return `${zenkakuDigits[file] ?? String(file)}${kansuji[rank] ?? String(rank)}`;
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

function pieceValue(piece: string | null): number | null {
  if (!piece) return null;
  return PIECE_VALUES[piece] ?? null;
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
  const kingSteps = [
    { r: -1, f: -1 },
    { r: -1, f: 0 },
    { r: -1, f: 1 },
    { r: 0, f: -1 },
    { r: 0, f: 1 },
    { r: 1, f: -1 },
    { r: 1, f: 0 },
    { r: 1, f: 1 },
  ];

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
      addStepAttacks(pos, from, piece.c, kingSteps, result);
      break;
    default:
      break;
  }

  return result;
}

function attacksByMovedPiece(pos: Position, toIdx: BoardIndex | null): DraftPositionFeatures['material']['attackedPieces'] {
  if (!toIdx) return [];
  const movedAfter = pos.board[toIdx.r][toIdx.f];
  if (!movedAfter) return [];

  return attackSquaresForPiece(pos, toIdx, movedAfter)
    .map((idx) => ({ idx, piece: pos.board[idx.r][idx.f] }))
    .filter((entry): entry is { idx: BoardIndex; piece: Piece } => Boolean(entry.piece && entry.piece.c === other(movedAfter.c)))
    .map((entry) => {
      const name = pieceName(entry.piece) ?? entry.piece.base;
      return {
        square: idxToJapanese(entry.idx),
        piece: name,
        value: pieceValue(name) ?? 0,
      };
    });
}

function findKing(pos: Position, color: Color): BoardIndex | null {
  for (let r = 0; r < 9; r += 1) {
    for (let f = 0; f < 9; f += 1) {
      const piece = pos.board[r][f];
      if (piece?.c === color && piece.base === 'K') return { r, f };
    }
  }
  return null;
}

function nearbySquares(center: BoardIndex | null): BoardIndex[] {
  if (!center) return [];
  const result: BoardIndex[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let df = -1; df <= 1; df += 1) {
      if (dr === 0 && df === 0) continue;
      const idx = { r: center.r + dr, f: center.f + df };
      if (inBoard(idx)) result.push(idx);
    }
  }
  return result;
}

function nearbyDefenderCount(pos: Position, king: BoardIndex | null, color: Color): number | null {
  if (!king) return null;
  return nearbySquares(king).filter((idx) => pos.board[idx.r][idx.f]?.c === color).length;
}

function opponentAttacksNearKing(pos: Position, king: BoardIndex | null, color: Color): number | null {
  if (!king) return null;
  const near = new Set(nearbySquares(king).map((idx) => `${idx.r},${idx.f}`));
  let count = 0;
  const opponent = other(color);

  for (let r = 0; r < 9; r += 1) {
    for (let f = 0; f < 9; f += 1) {
      const piece = pos.board[r][f];
      if (!piece || piece.c !== opponent) continue;
      for (const attack of attackSquaresForPiece(pos, { r, f }, piece)) {
        if (near.has(`${attack.r},${attack.f}`)) count += 1;
      }
    }
  }
  return count;
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

function materialPhrases(params: {
  capturedPiece: string | null;
  attackedHighValuePieces: DraftPositionFeatures['material']['attackedHighValuePieces'];
}): string[] {
  const { capturedPiece, attackedHighValuePieces } = params;
  const phrases: string[] = [];
  const firstHigh = attackedHighValuePieces[0];

  if (capturedPiece && firstHigh) {
    phrases.push(`${capturedPiece}を取りながら${firstHigh.piece}に当たる`);
  } else if (capturedPiece) {
    phrases.push(`${capturedPiece}を取れる`);
  }

  for (const attack of attackedHighValuePieces) {
    if (attack.piece === '飛車') {
      phrases.push('飛車取りになる');
    } else {
      phrases.push(`${attack.piece}に当たる`);
    }
  }

  return unique(phrases);
}

function activityPhrases(params: {
  movedPieceAfterMove: string | null;
  isDrop: boolean;
  isPromotion: boolean;
  promotedPiece: string | null;
  attackedHighValuePieces: DraftPositionFeatures['material']['attackedHighValuePieces'];
  afterAttackCount: number;
  beforeAttackCount: number | null;
}): { phrases: string[]; openedLongRangeLines: string[]; blockedOwnLongRangeLines: string[] } {
  const { movedPieceAfterMove, isDrop, isPromotion, promotedPiece, attackedHighValuePieces, afterAttackCount, beforeAttackCount } = params;
  const phrases: string[] = [];
  const openedLongRangeLines: string[] = [];
  const blockedOwnLongRangeLines: string[] = [];
  const firstHigh = attackedHighValuePieces[0];

  if (isDrop && movedPieceAfterMove && firstHigh) {
    phrases.push(`${movedPieceAfterMove}を打って${firstHigh.piece}に当てる`);
  }
  if (isPromotion && promotedPiece) {
    phrases.push(`${promotedPiece}になって働きが強い`);
  }
  if (movedPieceAfterMove === '馬') phrases.push('馬を作れる');
  if (movedPieceAfterMove === '龍') phrases.push('龍を作れる');

  if (beforeAttackCount !== null && afterAttackCount >= beforeAttackCount + 2 && movedPieceAfterMove) {
    openedLongRangeLines.push(`${movedPieceAfterMove}の利きが広がる`);
  }
  if (beforeAttackCount !== null && beforeAttackCount >= afterAttackCount + 2 && movedPieceAfterMove) {
    blockedOwnLongRangeLines.push(`${movedPieceAfterMove}の利きが狭くなる`);
  }

  return {
    phrases: unique([...phrases, ...openedLongRangeLines]),
    openedLongRangeLines,
    blockedOwnLongRangeLines,
  };
}

export function extractDraftPositionFeatures(problem: DraftProblem, choice: DraftProblemChoice): DraftPositionFeatures {
  const posBefore = parseSfen(problem.root_sfen);
  applyMoves(posBefore, problem.intro_moves_usi);

  const endpoints = parseMoveEndpoints(choice.usi);
  const movingColor = posBefore.turn;
  const fromIdx = endpoints.from ? usiToIdx(endpoints.from) : null;
  const toIdx = endpoints.to ? usiToIdx(endpoints.to) : null;
  const movingBefore = fromIdx ? posBefore.board[fromIdx.r][fromIdx.f] : endpoints.dropPiece ? { c: movingColor, base: endpoints.dropPiece, prom: false } : null;
  const capturedBefore = toIdx ? posBefore.board[toIdx.r][toIdx.f] : null;
  const movedPiece = pieceName(movingBefore);
  const capturedPiece = pieceName(capturedBefore);
  const capturedPieceValue = pieceValue(capturedPiece);
  const beforeAttackCount = fromIdx && movingBefore ? attackSquaresForPiece(posBefore, fromIdx, movingBefore).length : null;

  const ownKingBefore = findKing(posBefore, movingColor);
  const opponentKingBefore = findKing(posBefore, other(movingColor));
  const ownDefendersBefore = nearbyDefenderCount(posBefore, ownKingBefore, movingColor);
  const opponentAttacksBefore = opponentAttacksNearKing(posBefore, ownKingBefore, movingColor);

  const posAfter = parseSfen(problem.root_sfen);
  applyMoves(posAfter, problem.intro_moves_usi);
  applyUsiMove(posAfter, choice.usi);

  const movedAfter = toIdx ? posAfter.board[toIdx.r][toIdx.f] : null;
  const movedPieceAfterMove = pieceName(movedAfter);
  const attackedPieces = attacksByMovedPiece(posAfter, toIdx);
  const attackedHighValuePieces = attackedPieces.filter((attack) => HIGH_VALUE_PIECES.has(attack.piece));
  const afterAttackCount = movedAfter && toIdx ? attackSquaresForPiece(posAfter, toIdx, movedAfter).length : 0;

  const ownKingAfter = findKing(posAfter, movingColor);
  const ownDefendersAfter = nearbyDefenderCount(posAfter, ownKingAfter, movingColor);
  const opponentAttacksAfter = opponentAttacksNearKing(posAfter, ownKingAfter, movingColor);
  const defenderDelta = ownDefendersBefore !== null && ownDefendersAfter !== null ? ownDefendersAfter - ownDefendersBefore : null;
  const attackDelta = opponentAttacksBefore !== null && opponentAttacksAfter !== null ? opponentAttacksAfter - opponentAttacksBefore : null;
  const ownKingSafetyDelta = defenderDelta !== null && attackDelta !== null ? defenderDelta - attackDelta : null;

  const materialPhraseList = materialPhrases({ capturedPiece, attackedHighValuePieces });
  const activity = activityPhrases({
    movedPieceAfterMove,
    isDrop: endpoints.isDrop,
    isPromotion: endpoints.isPromotion,
    promotedPiece: endpoints.isPromotion ? movedPieceAfterMove : null,
    attackedHighValuePieces,
    afterAttackCount,
    beforeAttackCount,
  });

  const kingSafetyPhrases: string[] = [];
  let kingSafetyConfidence: DraftPositionFeatures['kingSafety']['confidence'] = 'none';
  if (defenderDelta !== null && defenderDelta <= -1) {
    kingSafetyPhrases.push('玉周りの守りが少し薄くなる');
    kingSafetyConfidence = 'low';
  }
  if (attackDelta !== null && attackDelta >= 2) {
    kingSafetyPhrases.push('自玉周辺に相手の利きが増える');
    kingSafetyConfidence = 'medium';
  }
  if (fromIdx && ownKingBefore && Math.abs(fromIdx.r - ownKingBefore.r) <= 1 && Math.abs(fromIdx.f - ownKingBefore.f) <= 1 && movedPiece) {
    kingSafetyPhrases.push('守りの駒が離れる');
    if (kingSafetyConfidence === 'none') kingSafetyConfidence = 'low';
  }

  const roughImmediateMaterialGain =
    (capturedPieceValue ?? 0) + attackedHighValuePieces.reduce((sum, attack) => sum + attack.value, 0);

  const isLongRangeMove = Boolean(movedAfter && LONG_RANGE_BASES.has(movedAfter.base));

  return {
    choiceId: choice.choice_id,
    material: {
      capturedPiece,
      capturedPieceValue,
      attackedPieces,
      attackedHighValuePieces,
      roughImmediateMaterialGain,
      materialPhrases: materialPhraseList,
    },
    pieceActivity: {
      movedPiece,
      movedPieceAfterMove,
      from: squareToJapanese(endpoints.from),
      to: squareToJapanese(endpoints.to),
      isDrop: endpoints.isDrop,
      isPromotion: endpoints.isPromotion,
      promotedPiece: endpoints.isPromotion ? movedPieceAfterMove : null,
      attacksAfterMoveCount: afterAttackCount,
      attacksHighValuePiece: attackedHighValuePieces.length > 0,
      openedLongRangeLines: isLongRangeMove ? activity.openedLongRangeLines : [],
      blockedOwnLongRangeLines: isLongRangeMove ? activity.blockedOwnLongRangeLines : [],
      activityPhrases: activity.phrases,
    },
    kingSafety: {
      ownKingSquare: ownKingAfter ? idxToJapanese(ownKingAfter) : null,
      opponentKingSquare: opponentKingBefore ? idxToJapanese(opponentKingBefore) : null,
      ownKingNearbyDefendersBefore: ownDefendersBefore,
      ownKingNearbyDefendersAfter: ownDefendersAfter,
      opponentAttacksNearOwnKingBefore: opponentAttacksBefore,
      opponentAttacksNearOwnKingAfter: opponentAttacksAfter,
      ownKingSafetyDelta,
      kingSafetyPhrases: unique(kingSafetyPhrases),
      confidence: kingSafetyConfidence,
    },
    summaryPhrases: unique([
      ...materialPhraseList,
      ...activity.phrases,
      ...(kingSafetyConfidence === 'medium' ? kingSafetyPhrases : []),
    ]),
  };
}

export function extractDraftPositionFeaturesForChoices(
  problem: DraftProblem,
  choices: DraftProblemChoice[],
): DraftPositionFeatures[] {
  return choices.map((choice) => extractDraftPositionFeatures(problem, choice));
}
