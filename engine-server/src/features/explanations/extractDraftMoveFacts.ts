import {
  applyUsiMove,
  parseSfen,
  usiToIdx,
  type Color,
  type Piece,
  type PieceBase,
  type Position,
} from '../kif-problem-generation/shogi/sfenEngine.js';
import type { DraftMoveFacts, DraftProblem, DraftProblemChoice } from './types.js';

type BoardIndex = { r: number; f: number };
type MoveEndpoints = { from: string | null; to: string | null; isDrop: boolean; isPromotion: boolean; dropPiece: PieceBase | null };

const HIGH_VALUE_ATTACK_PIECES = ['飛車', '角', '金', '銀'];
const INITIATIVE_PIECES = ['飛車', '角', '金'];

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

function normalizeLine(choice: DraftProblemChoice): string[] {
  const line = Array.isArray(choice.line) ? choice.line.filter((move) => typeof move === 'string' && move.length > 0) : [];
  if (line.length === 0) return [choice.usi];
  if (line[0] === choice.usi) return line;
  return [choice.usi, ...line];
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

function other(color: Color): Color {
  return color === 'b' ? 'w' : 'b';
}

function inBoard(idx: BoardIndex): boolean {
  return idx.r >= 0 && idx.r < 9 && idx.f >= 0 && idx.f < 9;
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
  const name = pieceName(piece);
  if (!name) return null;

  const promotedName = endpoints.isPromotion ? pieceName({ base: piece.base, prom: true }) : null;
  return `${turnPrefix(pos.turn)}${destination}${promotedName ?? name}${endpoints.isDrop ? '打' : ''}`;
}

function highValueAttacks(attacksAfterMove: DraftMoveFacts['attacksAfterMove']): DraftMoveFacts['attacksAfterMove'] {
  return attacksAfterMove.filter((attack) => HIGH_VALUE_ATTACK_PIECES.includes(attack.piece));
}

function buildMotifs(movedPieceAfterMove: string | null, attacksAfterMove: DraftMoveFacts['attacksAfterMove']): string[] {
  if (!movedPieceAfterMove) return [];

  const motifs: string[] = [];
  const attackedPieces = attacksAfterMove.map((attack) => attack.piece);
  if (attackedPieces.includes('角')) motifs.push(`${movedPieceAfterMove}が角に当たる`);
  if (attackedPieces.includes('飛車')) {
    motifs.push(`${movedPieceAfterMove}が飛車に当たる`);
    motifs.push('飛車取りになる');
  }
  if (attackedPieces.includes('金')) motifs.push(`${movedPieceAfterMove}が金に当たる`);
  if (highValueAttacks(attacksAfterMove).length >= 2) motifs.push('両取りになる');
  if (attackedPieces.some((piece) => piece === '角' || piece === '飛車' || piece === '金')) {
    motifs.push('先手で入る');
    motifs.push('相手は対応が必要');
  }

  return Array.from(new Set(motifs));
}

function buildFactPhrases(params: {
  capturedPiece: string | null;
  movedPieceAfterMove: string | null;
  attacksAfterMove: DraftMoveFacts['attacksAfterMove'];
}): string[] {
  const { capturedPiece, movedPieceAfterMove, attacksAfterMove } = params;
  if (!movedPieceAfterMove) return [];

  const phrases: string[] = [];
  const highAttacks = highValueAttacks(attacksAfterMove);
  const firstHighAttack = highAttacks[0];
  if (capturedPiece && firstHighAttack) {
    phrases.push(`${capturedPiece}を取りながら${movedPieceAfterMove}が${firstHighAttack.piece}に当たる`);
  }

  for (const attack of highAttacks) {
    if (attack.piece === '飛車') {
      phrases.push('飛車取りになる');
      phrases.push('飛車取りで先手を取れる');
    } else {
      phrases.push(`${movedPieceAfterMove}が${attack.piece}に当たる`);
      if (attack.piece === '角') phrases.push('角に当たる');
      if (attack.piece === '金') phrases.push('金に当たる');
    }
  }

  const firstInitiativeAttack = highAttacks.find((attack) => INITIATIVE_PIECES.includes(attack.piece));
  if (firstInitiativeAttack?.piece === '飛車') phrases.push('飛車取りで先手を取れる');
  return Array.from(new Set(phrases));
}

function buildFirstResponseFacts(params: {
  firstResponse: string | null;
  posAfterChoice: Position;
  attacksAfterMove: DraftMoveFacts['attacksAfterMove'];
}): string[] {
  const { firstResponse, posAfterChoice, attacksAfterMove } = params;
  if (!firstResponse) return [];

  const endpoints = parseMoveEndpoints(firstResponse);
  if (!endpoints.from) return [];

  const fromSquare = squareToJapanese(endpoints.from);
  if (!fromSquare || !attacksAfterMove.some((attack) => attack.square === fromSquare)) return [];

  const fromIdx = usiToIdx(endpoints.from);
  const escapingPiece = posAfterChoice.board[fromIdx.r]?.[fromIdx.f] ?? null;
  const escapingPieceName = pieceName(escapingPiece);
  return escapingPieceName ? [`${escapingPieceName}を逃げられる`] : [];
}

function applyMoves(pos: Position, moves: string[]): void {
  for (const move of moves) {
    if (!move) continue;
    applyUsiMove(pos, move);
  }
}

export function extractDraftMoveFacts(problem: DraftProblem, choice: DraftProblemChoice): DraftMoveFacts {
  const pos = parseSfen(problem.root_sfen);
  applyMoves(pos, problem.intro_moves_usi);

  const endpoints = parseMoveEndpoints(choice.usi);
  const turn = pos.turn;
  const fromIdx = endpoints.from ? usiToIdx(endpoints.from) : null;
  const toIdx = endpoints.to ? usiToIdx(endpoints.to) : null;
  const movingBefore = fromIdx ? pos.board[fromIdx.r][fromIdx.f] : endpoints.dropPiece ? { c: turn, base: endpoints.dropPiece, prom: false } : null;
  const capturedBefore = toIdx ? pos.board[toIdx.r][toIdx.f] : null;

  applyUsiMove(pos, choice.usi);

  const movedAfter = toIdx ? pos.board[toIdx.r][toIdx.f] : null;
  const attacksAfterMove = movedAfter && toIdx
    ? attackSquaresForPiece(pos, toIdx, movedAfter)
        .map((idx) => ({ idx, piece: pos.board[idx.r][idx.f] }))
        .filter((entry): entry is { idx: BoardIndex; piece: Piece } => Boolean(entry.piece && entry.piece.c === other(movedAfter.c)))
        .map((entry) => ({
          square: idxToJapanese(entry.idx),
          piece: pieceName(entry.piece) ?? entry.piece.base,
        }))
    : [];
  const movedPieceAfterMove = pieceName(movedAfter);
  const line = normalizeLine(choice);
  const firstResponse = line.length >= 2 ? line[1] : null;
  const firstResponseLabel = firstResponse ? labelMove(pos, firstResponse) : null;
  const capturedPiece = pieceName(capturedBefore);

  return {
    choiceId: choice.choice_id,
    usi: choice.usi,
    label: choice.label,
    movedPiece: pieceName(movingBefore),
    from: squareToJapanese(endpoints.from),
    to: squareToJapanese(endpoints.to),
    isDrop: endpoints.isDrop,
    isPromotion: endpoints.isPromotion,
    promotedPiece: endpoints.isPromotion ? movedPieceAfterMove : null,
    capturedPiece,
    attacksAfterMove,
    attacksHighValuePiece: highValueAttacks(attacksAfterMove).length > 0,
    givesCheck: null,
    firstResponse,
    firstResponseLabel,
    firstResponseFacts: buildFirstResponseFacts({
      firstResponse,
      posAfterChoice: pos,
      attacksAfterMove,
    }),
    lineFirstMoves: line.slice(0, 6),
    factPhrases: buildFactPhrases({
      capturedPiece,
      movedPieceAfterMove,
      attacksAfterMove,
    }),
    tacticalMotifs: buildMotifs(movedPieceAfterMove, attacksAfterMove),
  };
}

export function extractDraftMoveFactsForChoices(problem: DraftProblem, choices: DraftProblemChoice[]): DraftMoveFacts[] {
  return choices.map((choice) => extractDraftMoveFacts(problem, choice));
}
