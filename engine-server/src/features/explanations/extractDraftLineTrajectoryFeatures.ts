import {
  applyUsiMove,
  parseSfen,
  usiToIdx,
  type Color,
  type Piece,
  type PieceBase,
  type Position,
} from '../kif-problem-generation/shogi/sfenEngine.js';
import type {
  ChoiceEvalFeature,
  DraftEvidenceChain,
  DraftEvidenceChainStep,
  DraftFeatureCategory,
  DraftFeatureEvidenceLevel,
  DraftLineSnapshot,
  DraftLineTrajectoryFeatures,
  DraftMoveFacts,
  DraftPositionFeatures,
  DraftProblem,
  DraftProblemChoice,
  DraftUsableExplanationEvidence,
} from './types.js';

type BoardIndex = { r: number; f: number };
type MoveEndpoints = { from: string | null; to: string | null; isDrop: boolean; isPromotion: boolean; dropPiece: PieceBase | null };
type LineMoveEvent = {
  ply: number;
  usi: string;
  label: string | null;
  capturedPiece: string | null;
  promotedPiece: string | null;
  isDrop: boolean;
  isPromotion: boolean;
};

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

function normalizeLine(choice: DraftProblemChoice): string[] {
  const line = Array.isArray(choice.line) ? choice.line.filter((move) => typeof move === 'string' && move.length > 0) : [];
  if (line.length === 0) return [choice.usi];
  if (line[0] === choice.usi) return line;
  return [choice.usi, ...line];
}

function unique(items: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const text = item?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function other(color: Color): Color {
  return color === 'b' ? 'w' : 'b';
}

function inBoard(idx: BoardIndex): boolean {
  return idx.r >= 0 && idx.r < 9 && idx.f >= 0 && idx.f < 9;
}

function idxToJapanese(idx: BoardIndex): string {
  const file = 9 - idx.f;
  const rank = idx.r + 1;
  return `${zenkakuDigits[file] ?? String(file)}${kansuji[rank] ?? String(rank)}`;
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
      case 'P': return 'と金';
      case 'L': return '成香';
      case 'N': return '成桂';
      case 'S': return '成銀';
      case 'B': return '馬';
      case 'R': return '龍';
      default: break;
    }
  }
  switch (piece.base) {
    case 'P': return '歩';
    case 'L': return '香';
    case 'N': return '桂';
    case 'S': return '銀';
    case 'G': return '金';
    case 'B': return '角';
    case 'R': return '飛車';
    case 'K': return '玉';
    default: return null;
  }
}

function pieceValue(piece: string | null): number {
  if (!piece) return 0;
  return PIECE_VALUES[piece] ?? 0;
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
    { r: -1, f: -1 }, { r: -1, f: 0 }, { r: -1, f: 1 },
    { r: 0, f: -1 }, { r: 0, f: 1 },
    { r: 1, f: -1 }, { r: 1, f: 0 }, { r: 1, f: 1 },
  ];
  if (piece.prom && ['P', 'L', 'N', 'S'].includes(piece.base)) {
    addStepAttacks(pos, from, piece.c, goldOffsets(piece.c), result);
    return result;
  }
  switch (piece.base) {
    case 'P': addStepAttacks(pos, from, piece.c, [{ r: forward, f: 0 }], result); break;
    case 'L': addRayAttacks(pos, from, piece.c, [{ r: forward, f: 0 }], result); break;
    case 'N': addStepAttacks(pos, from, piece.c, [{ r: forward * 2, f: -1 }, { r: forward * 2, f: 1 }], result); break;
    case 'S': addStepAttacks(pos, from, piece.c, silverOffsets(piece.c), result); break;
    case 'G': addStepAttacks(pos, from, piece.c, goldOffsets(piece.c), result); break;
    case 'B':
      addRayAttacks(pos, from, piece.c, [{ r: -1, f: -1 }, { r: -1, f: 1 }, { r: 1, f: -1 }, { r: 1, f: 1 }], result);
      if (piece.prom) addStepAttacks(pos, from, piece.c, [{ r: -1, f: 0 }, { r: 0, f: -1 }, { r: 0, f: 1 }, { r: 1, f: 0 }], result);
      break;
    case 'R':
      addRayAttacks(pos, from, piece.c, [{ r: -1, f: 0 }, { r: 0, f: -1 }, { r: 0, f: 1 }, { r: 1, f: 0 }], result);
      if (piece.prom) addStepAttacks(pos, from, piece.c, [{ r: -1, f: -1 }, { r: -1, f: 1 }, { r: 1, f: -1 }, { r: 1, f: 1 }], result);
      break;
    case 'K': addStepAttacks(pos, from, piece.c, kingSteps, result); break;
    default: break;
  }
  return result;
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

function attacksNear(pos: Position, squares: BoardIndex[], attacker: Color): number | null {
  if (squares.length === 0) return null;
  const near = new Set(squares.map((idx) => `${idx.r},${idx.f}`));
  let count = 0;
  for (let r = 0; r < 9; r += 1) {
    for (let f = 0; f < 9; f += 1) {
      const piece = pos.board[r][f];
      if (!piece || piece.c !== attacker) continue;
      for (const attack of attackSquaresForPiece(pos, { r, f }, piece)) {
        if (near.has(`${attack.r},${attack.f}`)) count += 1;
      }
    }
  }
  return count;
}

function attacksByColor(pos: Position, color: Color): DraftLineSnapshot['pieceActivity']['attackedPieces'] {
  const result: DraftLineSnapshot['pieceActivity']['attackedPieces'] = [];
  for (let r = 0; r < 9; r += 1) {
    for (let f = 0; f < 9; f += 1) {
      const piece = pos.board[r][f];
      if (!piece || piece.c !== color) continue;
      for (const idx of attackSquaresForPiece(pos, { r, f }, piece)) {
        const target = pos.board[idx.r][idx.f];
        if (!target || target.c === color) continue;
        const name = pieceName(target) ?? target.base;
        result.push({
          square: idxToJapanese(idx),
          piece: name,
          value: pieceValue(name),
        });
      }
    }
  }
  return result;
}

function materialScore(pos: Position, color: Color): number {
  let score = 0;
  for (let r = 0; r < 9; r += 1) {
    for (let f = 0; f < 9; f += 1) {
      const piece = pos.board[r][f];
      if (!piece || piece.c !== color) continue;
      score += pieceValue(pieceName(piece));
    }
  }
  for (const [base, count] of Object.entries(pos.hands[color])) {
    const name = pieceName({ base: base as PieceBase, prom: false });
    score += (count ?? 0) * pieceValue(name);
  }
  return score;
}

function longRangePieceActivityCount(pos: Position, color: Color): number {
  let count = 0;
  for (let r = 0; r < 9; r += 1) {
    for (let f = 0; f < 9; f += 1) {
      const piece = pos.board[r][f];
      if (!piece || piece.c !== color || !LONG_RANGE_BASES.has(piece.base)) continue;
      count += attackSquaresForPiece(pos, { r, f }, piece).length;
    }
  }
  return count;
}

function turnPrefix(color: Color): '▲' | '△' {
  return color === 'b' ? '▲' : '△';
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

function makeSnapshot(params: {
  pos: Position;
  choiceColor: Color;
  ply: number;
  moveUsi: string | null;
  moveLabel: string | null;
  capturedPieces: string[];
  promotedPieces: string[];
}): DraftLineSnapshot {
  const own = params.choiceColor;
  const opponent = other(own);
  const ownMaterialScore = materialScore(params.pos, own);
  const opponentMaterialScore = materialScore(params.pos, opponent);
  const attackedPieces = attacksByColor(params.pos, own);
  const ownKing = findKing(params.pos, own);
  const opponentKing = findKing(params.pos, opponent);
  const ownKingNearby = nearbySquares(ownKing);
  const opponentKingNearby = nearbySquares(opponentKing);
  return {
    ply: params.ply,
    moveUsi: params.moveUsi,
    moveLabel: params.moveLabel,
    material: {
      ownMaterialScore,
      opponentMaterialScore,
      materialBalanceFromChoiceSide: ownMaterialScore - opponentMaterialScore,
      capturedPieces: params.capturedPieces,
      promotedPieces: params.promotedPieces,
    },
    pieceActivity: {
      attackedPieces,
      attackedHighValuePieces: attackedPieces.filter((attack) => HIGH_VALUE_PIECES.has(attack.piece)),
      longRangePieceActivityCount: longRangePieceActivityCount(params.pos, own),
      ownAttacksNearOpponentKing: attacksNear(params.pos, opponentKingNearby, own),
    },
    kingSafety: {
      ownKingSquare: ownKing ? idxToJapanese(ownKing) : null,
      opponentKingSquare: opponentKing ? idxToJapanese(opponentKing) : null,
      ownKingNearbyDefenders: nearbyDefenderCount(params.pos, ownKing, own),
      opponentAttacksNearOwnKing: attacksNear(params.pos, ownKingNearby, opponent),
      ownAttacksNearOpponentKing: attacksNear(params.pos, opponentKingNearby, own),
    },
  };
}

function evalSupport(feature: ChoiceEvalFeature | undefined): DraftUsableExplanationEvidence['evalSupport'] {
  if (!feature) return 'unknown';
  if (feature.isCorrect || feature.quality === 'best') return 'positive';
  if (feature.quality === 'bad' || feature.quality === 'blunder' || (feature.gapFromBest ?? 0) >= 200) return 'negative';
  return 'neutral';
}

function evidence(params: {
  category: DraftFeatureCategory;
  phrase: string;
  evidenceLevel: DraftFeatureEvidenceLevel;
  confidence: DraftUsableExplanationEvidence['confidence'];
  source: DraftUsableExplanationEvidence['source'];
  ply?: number;
  evalSupport?: DraftUsableExplanationEvidence['evalSupport'];
}): DraftUsableExplanationEvidence {
  return {
    category: params.category,
    phrase: params.phrase,
    evidenceLevel: params.evidenceLevel,
    confidence: params.confidence,
    source: params.source,
    ply: params.ply,
    evalSupport: params.evalSupport ?? 'unknown',
  };
}

function applyMoveWithEvents(pos: Position, usi: string): { capturedPiece: string | null; promotedPiece: string | null; label: string | null } {
  const label = labelMove(pos, usi);
  const endpoints = parseMoveEndpoints(usi);
  const toIdx = endpoints.to ? usiToIdx(endpoints.to) : null;
  const capturedPiece = toIdx ? pieceName(pos.board[toIdx.r]?.[toIdx.f] ?? null) : null;
  const movingBefore = endpoints.from ? pos.board[usiToIdx(endpoints.from).r]?.[usiToIdx(endpoints.from).f] ?? null : null;
  applyUsiMove(pos, usi);
  const promotedPiece = endpoints.isPromotion && movingBefore ? pieceName({ base: movingBefore.base, prom: true }) : null;
  return { capturedPiece, promotedPiece, label };
}

function snapshotByPly(snapshots: DraftLineSnapshot[], ply: number): DraftLineSnapshot | undefined {
  return snapshots.find((snapshot) => snapshot.ply === ply);
}

function deltaFromBase(base: DraftLineSnapshot, snapshot: DraftLineSnapshot | undefined): number | null {
  return snapshot ? snapshot.material.materialBalanceFromChoiceSide - base.material.materialBalanceFromChoiceSide : null;
}

function trendConfidence(phrases: string[], high = false): 'none' | 'low' | 'medium' | 'high' {
  if (phrases.length === 0) return 'none';
  return high ? 'high' : 'medium';
}

function stepSide(ply: number): DraftEvidenceChainStep['side'] {
  if (ply === 0) return 'choice';
  return ply % 2 === 1 ? 'opponent' : 'self';
}

function moveStep(
  event: LineMoveEvent | undefined,
  role: DraftEvidenceChainStep['role'],
  fact: string,
): DraftEvidenceChainStep {
  return {
    ply: event?.ply ?? -1,
    usi: event?.usi ?? null,
    label: event?.label ?? null,
    side: event ? stepSide(event.ply) : 'unknown',
    role,
    fact,
  };
}

function promotePhrase(piece: string | null): string | null {
  if (!piece) return null;
  if (piece === '馬') return '馬を作れる';
  if (piece === '龍') return '龍を作れる';
  return `${piece}が残る`;
}

function chainUsablePhrase(resultPhrase: string, nextOwnEvent: LineMoveEvent | undefined): string {
  if (!nextOwnEvent?.label) return resultPhrase;
  if (resultPhrase.includes('飛車を逃げても') && resultPhrase.includes('角成')) {
    return `飛車を逃げても${nextOwnEvent.label}が残る`;
  }
  if (resultPhrase === '角成が残る' || resultPhrase === '角が成れる') {
    return `${nextOwnEvent.label}が残る`;
  }
  if (resultPhrase.includes('馬を作れる') || resultPhrase.includes('龍を作れる')) {
    return `${nextOwnEvent.label}で${resultPhrase}`;
  }
  return resultPhrase;
}

function buildEvidenceChains(params: {
  choiceId: number;
  moveFacts?: DraftMoveFacts;
  lineContinuationFeatures?: { continuationPhrases: string[]; nextOwnMoveFacts: string[] };
  events: LineMoveEvent[];
  materialPhrases: string[];
  pieceActivityPhrases: string[];
  kingSafetyPhrases: string[];
}): DraftEvidenceChain[] {
  const chains: DraftEvidenceChain[] = [];
  const candidate = params.events[0];
  const firstResponse = params.events[1];
  const nextOwn = params.events[2];
  const candidateFact = params.moveFacts?.factPhrases[0] ??
    params.pieceActivityPhrases[0] ??
    params.materialPhrases[0] ??
    '候補手';

  for (const phrase of unique(params.lineContinuationFeatures?.continuationPhrases ?? [])) {
    const steps: DraftEvidenceChainStep[] = [
      moveStep(candidate, 'candidate_move', candidateFact),
    ];
    if (firstResponse) {
      const responseFact = params.moveFacts?.firstResponseFacts[0] ??
        (phrase.includes('逃げても') ? '飛車を逃げる' : '応手');
      steps.push(moveStep(firstResponse, 'opponent_response', responseFact));
    }
    if (nextOwn) {
      const nextFact = params.lineContinuationFeatures?.nextOwnMoveFacts[0] ??
        promotePhrase(nextOwn.promotedPiece) ??
        (nextOwn.capturedPiece ? `${nextOwn.capturedPiece}を取れる` : '継続手');
      steps.push(moveStep(nextOwn, 'next_own_move', nextFact));
    }
    chains.push({
      id: `${params.choiceId}:line:${chains.length + 1}`,
      choiceId: params.choiceId,
      category: 'lineContinuation',
      confidence: 'high',
      evidenceLevel: 'line_observed',
      priority: 100,
      steps,
      resultPhrase: phrase,
      usablePhrase: chainUsablePhrase(phrase, nextOwn),
      limitations: [],
    });
  }

  if (candidate?.capturedPiece) {
    const resultPhrase = candidate.capturedPiece === '歩' ? '一歩取れる' : `${candidate.capturedPiece}を取れる`;
    chains.push({
      id: `${params.choiceId}:material:candidate`,
      choiceId: params.choiceId,
      category: 'material',
      confidence: candidate.capturedPiece === '歩' ? 'medium' : 'high',
      evidenceLevel: 'line_observed',
      priority: candidate.capturedPiece === '歩' ? 80 : 95,
      steps: [
        moveStep(candidate, 'candidate_move', resultPhrase),
        ...(firstResponse ? [moveStep(firstResponse, 'opponent_response', '応手')] : []),
      ],
      resultPhrase,
      usablePhrase: candidate.label ? `${candidate.label}で${resultPhrase}` : resultPhrase,
      limitations: ['line上で確認できる範囲の駒得'],
    });
  }

  if (nextOwn?.capturedPiece || nextOwn?.promotedPiece) {
    const nextResult = promotePhrase(nextOwn.promotedPiece) ??
      (nextOwn.capturedPiece === '歩' ? '一歩取れる' : `${nextOwn.capturedPiece}を取れる`);
    chains.push({
      id: `${params.choiceId}:threat:next-own`,
      choiceId: params.choiceId,
      category: nextOwn.isDrop ? 'threat' : 'lineContinuation',
      confidence: 'medium',
      evidenceLevel: 'line_observed',
      priority: nextOwn.isDrop ? 90 : 85,
      steps: [
        moveStep(candidate, 'candidate_move', candidateFact),
        ...(firstResponse ? [moveStep(firstResponse, 'opponent_response', '応手')] : []),
        moveStep(nextOwn, 'next_own_move', nextResult),
      ],
      resultPhrase: nextResult,
      usablePhrase: nextOwn.label ? `${nextOwn.label}で${nextResult}` : nextResult,
      limitations: ['line上の応手に対する確認'],
    });
  }

  if (params.kingSafetyPhrases.length > 0 && nextOwn) {
    chains.push({
      id: `${params.choiceId}:king-safety:1`,
      choiceId: params.choiceId,
      category: 'kingSafety',
      confidence: 'low',
      evidenceLevel: 'heuristic',
      priority: 30,
      steps: [
        moveStep(candidate, 'candidate_move', candidateFact),
        moveStep(nextOwn, 'king_safety', params.kingSafetyPhrases[0]),
      ],
      resultPhrase: params.kingSafetyPhrases[0],
      usablePhrase: params.kingSafetyPhrases[0],
      limitations: ['玉の安全は簡易特徴量による推定'],
    });
  }

  const seen = new Set<string>();
  return chains.filter((chain) => {
    const key = `${chain.category}:${chain.usablePhrase}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.priority - a.priority);
}

export function extractDraftLineTrajectoryFeatures(params: {
  problem: DraftProblem;
  choice: DraftProblemChoice;
  feature?: ChoiceEvalFeature;
  moveFacts?: DraftMoveFacts;
  positionFeatures?: DraftPositionFeatures;
  lineContinuationFeatures?: { continuationPhrases: string[]; nextOwnMoveFacts: string[] };
}): DraftLineTrajectoryFeatures {
  const basePos = parseSfen(params.problem.root_sfen);
  for (const move of params.problem.intro_moves_usi) applyUsiMove(basePos, move);
  const choiceColor = basePos.turn;
  const pos = parseSfen(params.problem.root_sfen);
  for (const move of params.problem.intro_moves_usi) applyUsiMove(pos, move);

  const line = normalizeLine(params.choice).slice(0, 6);
  const snapshots: DraftLineSnapshot[] = [];
  const events: LineMoveEvent[] = [];
  let capturedPieces: string[] = [];
  let promotedPieces: string[] = [];

  snapshots.push(makeSnapshot({
    pos,
    choiceColor,
    ply: 0,
    moveUsi: null,
    moveLabel: null,
    capturedPieces,
    promotedPieces,
  }));

  for (let index = 0; index < line.length; index += 1) {
    const move = line[index];
    const event = applyMoveWithEvents(pos, move);
    capturedPieces = unique([...capturedPieces, event.capturedPiece]);
    promotedPieces = unique([...promotedPieces, event.promotedPiece]);
    events.push({
      ply: index,
      usi: move,
      label: event.label,
      capturedPiece: event.capturedPiece,
      promotedPiece: event.promotedPiece,
      isDrop: parseMoveEndpoints(move).isDrop,
      isPromotion: parseMoveEndpoints(move).isPromotion,
    });
    const snapshotPly = index + 1;
    if ([1, 2, 4, 6].includes(snapshotPly)) {
      snapshots.push(makeSnapshot({
        pos,
        choiceColor,
        ply: snapshotPly,
        moveUsi: move,
        moveLabel: event.label,
        capturedPieces,
        promotedPieces,
      }));
    }
  }

  const base = snapshotByPly(snapshots, 0) ?? snapshots[0];
  const afterChoice = snapshotByPly(snapshots, 1);
  const afterPly3 = snapshotByPly(snapshots, 4);
  const afterPly5 = snapshotByPly(snapshots, 6);
  const materialPhrases: string[] = [];
  const afterChoiceDelta = deltaFromBase(base, afterChoice);
  const afterPly3Delta = deltaFromBase(base, afterPly3);
  const afterPly5Delta = deltaFromBase(base, afterPly5);
  if ((afterChoiceDelta ?? 0) >= 5 || (afterPly5Delta ?? 0) >= 5) materialPhrases.push('駒得を主張できる');
  for (const piece of afterChoice?.material.capturedPieces ?? []) {
    if (piece === '歩') materialPhrases.push('一歩取れる');
    else materialPhrases.push(`${piece}を取れる`);
  }
  for (const piece of afterPly5?.material.promotedPieces ?? []) {
    if (piece === '馬') materialPhrases.push('馬を作れる');
    else if (piece === '龍') materialPhrases.push('龍を作れる');
    else materialPhrases.push(`${piece}が残る`);
  }

  const afterChoiceHigh = (afterChoice?.pieceActivity.attackedHighValuePieces.length ?? 0) > 0;
  const afterPly5High = (afterPly5?.pieceActivity.attackedHighValuePieces.length ?? 0) > 0;
  const pieceActivityPhrases: string[] = [];
  const firstHigh = afterChoice?.pieceActivity.attackedHighValuePieces[0];
  if (firstHigh) {
    pieceActivityPhrases.push(firstHigh.piece === '飛車' ? '飛車取りになる' : `${firstHigh.piece}に当たる`);
  }
  if (afterChoiceHigh && afterPly5High) pieceActivityPhrases.push('大きな当たりが残る');
  const attackNearOpponentKingDeltaPly5 = afterPly5?.pieceActivity.ownAttacksNearOpponentKing !== null &&
    afterPly5?.pieceActivity.ownAttacksNearOpponentKing !== undefined &&
    base.pieceActivity.ownAttacksNearOpponentKing !== null
    ? afterPly5.pieceActivity.ownAttacksNearOpponentKing - base.pieceActivity.ownAttacksNearOpponentKing
    : null;
  if ((attackNearOpponentKingDeltaPly5 ?? 0) >= 2) pieceActivityPhrases.push('相手玉周辺への利きが増える');

  const ownKingSafetyDeltaPly5 = afterPly5?.kingSafety.ownKingNearbyDefenders !== null &&
    afterPly5?.kingSafety.opponentAttacksNearOwnKing !== null &&
    base.kingSafety.ownKingNearbyDefenders !== null &&
    base.kingSafety.opponentAttacksNearOwnKing !== null
    ? (afterPly5.kingSafety.ownKingNearbyDefenders - afterPly5.kingSafety.opponentAttacksNearOwnKing) -
      (base.kingSafety.ownKingNearbyDefenders - base.kingSafety.opponentAttacksNearOwnKing)
    : null;
  const opponentKingPressureDeltaPly5 = afterPly5?.kingSafety.ownAttacksNearOpponentKing !== null &&
    afterPly5?.kingSafety.ownAttacksNearOpponentKing !== undefined &&
    base.kingSafety.ownAttacksNearOpponentKing !== null
    ? afterPly5.kingSafety.ownAttacksNearOpponentKing - base.kingSafety.ownAttacksNearOpponentKing
    : null;
  const kingSafetyPhrases: string[] = [];
  if ((ownKingSafetyDeltaPly5 ?? 0) <= -2) kingSafetyPhrases.push('自玉周辺の相手利きが増える');
  if ((opponentKingPressureDeltaPly5 ?? 0) >= 2) kingSafetyPhrases.push('相手玉周辺への利きが増える');

  const support = evalSupport(params.feature);
  const usableEvidence = unique([
    ...(params.moveFacts?.factPhrases ?? []),
    ...(params.positionFeatures?.summaryPhrases ?? []),
  ]).map((phrase) => evidence({
    category: phrase.includes('取れる') ? 'material' : 'pieceActivity',
    phrase,
    evidenceLevel: 'direct',
    confidence: 'high',
    source: phrase.includes('取れる') ? 'position_features' : 'move_facts',
    ply: 1,
    evalSupport: support,
  }));
  usableEvidence.push(
    ...unique(params.lineContinuationFeatures?.continuationPhrases ?? []).map((phrase) => evidence({
      category: 'lineContinuation',
      phrase,
      evidenceLevel: 'line_observed',
      confidence: 'high',
      source: 'line_trajectory',
      ply: 3,
      evalSupport: support,
    })),
    ...unique(materialPhrases).map((phrase) => evidence({
      category: 'material',
      phrase,
      evidenceLevel: 'line_observed',
      confidence: phrase === '駒得を主張できる' ? 'medium' : 'high',
      source: 'line_trajectory',
      ply: phrase === '駒得を主張できる' ? 5 : 1,
      evalSupport: support,
    })),
    ...unique(pieceActivityPhrases).map((phrase) => evidence({
      category: 'pieceActivity',
      phrase,
      evidenceLevel: 'line_observed',
      confidence: 'medium',
      source: 'line_trajectory',
      ply: phrase.includes('残る') ? 5 : 1,
      evalSupport: support,
    })),
    ...unique(kingSafetyPhrases).map((phrase) => evidence({
      category: 'kingSafety',
      phrase,
      evidenceLevel: 'heuristic',
      confidence: 'low',
      source: 'line_trajectory',
      ply: 5,
      evalSupport: support,
    })),
  );
  const evidenceChains = buildEvidenceChains({
    choiceId: params.choice.choice_id,
    moveFacts: params.moveFacts,
    lineContinuationFeatures: params.lineContinuationFeatures,
    events,
    materialPhrases: unique(materialPhrases),
    pieceActivityPhrases: unique(pieceActivityPhrases),
    kingSafetyPhrases: unique(kingSafetyPhrases),
  });

  return {
    choiceId: params.choice.choice_id,
    snapshots,
    materialTrend: {
      afterChoiceDelta,
      afterPly3Delta,
      afterPly5Delta,
      phrases: unique(materialPhrases),
      confidence: trendConfidence(materialPhrases, (afterPly5Delta ?? 0) >= 8),
    },
    pieceActivityTrend: {
      highValueAttackCreated: afterChoiceHigh,
      highValueAttackMaintained: afterChoiceHigh && afterPly5High,
      highValueAttackLost: afterChoiceHigh && !afterPly5High,
      attackNearOpponentKingDeltaPly5,
      phrases: unique(pieceActivityPhrases),
      confidence: trendConfidence(pieceActivityPhrases),
    },
    kingSafetyTrend: {
      ownKingSafetyDeltaPly5,
      opponentKingPressureDeltaPly5,
      phrases: unique(kingSafetyPhrases),
      confidence: kingSafetyPhrases.length > 0 ? 'low' : 'none',
    },
    usableEvidence: unique(usableEvidence.map((item) => item.phrase)).map((phrase) =>
      usableEvidence.find((item) => item.phrase === phrase) as DraftUsableExplanationEvidence
    ),
    evidenceChains,
  };
}

export function extractDraftLineTrajectoryFeaturesForChoices(params: {
  problem: DraftProblem;
  choices: DraftProblemChoice[];
  features: ChoiceEvalFeature[];
  moveFactsByChoiceId: Map<number, DraftMoveFacts>;
  positionFeaturesByChoiceId: Map<number, DraftPositionFeatures>;
  lineContinuationFeaturesByChoiceId: Map<number, { continuationPhrases: string[]; nextOwnMoveFacts: string[] }>;
}): DraftLineTrajectoryFeatures[] {
  const featuresByChoiceId = new Map(params.features.map((feature) => [feature.choice_id, feature]));
  return params.choices.map((choice) => extractDraftLineTrajectoryFeatures({
    problem: params.problem,
    choice,
    feature: featuresByChoiceId.get(choice.choice_id),
    moveFacts: params.moveFactsByChoiceId.get(choice.choice_id),
    positionFeatures: params.positionFeaturesByChoiceId.get(choice.choice_id),
    lineContinuationFeatures: params.lineContinuationFeaturesByChoiceId.get(choice.choice_id),
  }));
}
