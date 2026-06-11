import type { MakingKifuInsertRow } from '../api/kifus';
import type { HandPieceType, PieceType, Side } from '../types/shogi';
import { applyUsiMove, boardToSfen, INITIAL_SFEN, parseSfen, parseUsiSquare } from './sfen';

export type ShogiQuestMode = '10min' | '5min';

export interface ShogiQuestPlayer {
  id?: string;
  name?: string;
  oldR?: number;
  newR?: number;
  oldD?: number;
  newD?: number;
  avatar?: string;
}

export interface ShogiQuestRawMove {
  t?: number;
  m?: string;
  s?: string;
  capture?: string;
}

export interface ShogiQuestRawGame {
  id?: string;
  gtype?: string;
  attrs?: string[];
  players?: ShogiQuestPlayer[];
  position?: {
    moves?: ShogiQuestRawMove[];
    startPos?: unknown;
    handicap?: string;
  };
  handicap?: string;
  tcb?: number;
  created?: string;
  finished?: boolean;
}

export interface ShogiQuestHistoryGame {
  id?: string;
  created?: string;
  players?: ShogiQuestPlayer[];
  finalStatus?: string;
  length?: number;
  handicap?: string;
}

export interface ShogiQuestFetchedGame {
  gameId: string;
  history: ShogiQuestHistoryGame;
  rawGame: ShogiQuestRawGame;
}

export interface ShogiQuestFetchFailure {
  gameId: string | null;
  stage: 'fetch';
  message: string;
  history?: ShogiQuestHistoryGame;
}

export interface ShogiQuestFetchResult {
  username: string;
  mode: ShogiQuestMode;
  requestedCount: number;
  fetchedAt: string;
  games: ShogiQuestFetchedGame[];
  errors: ShogiQuestFetchFailure[];
}

export interface QuestKifuPreparedRecord {
  sourceRef: string;
  startedAt: string | null;
  players: ShogiQuestPlayer[];
  movesCount: number;
  initialSfen: string;
  moves: string[];
  row: MakingKifuInsertRow;
}

export interface QuestKifuPrepareError {
  sourceRef: string;
  gameId: string | null;
  startedAt: string | null;
  players: ShogiQuestPlayer[];
  stage: 'fetch' | 'parse';
  message: string;
}

export interface QuestKifuPrepareResult {
  records: QuestKifuPreparedRecord[];
  errors: QuestKifuPrepareError[];
}

const CSA_PIECES: Record<string, { type: PieceType; promoted: boolean }> = {
  FU: { type: 'P', promoted: false },
  KY: { type: 'L', promoted: false },
  KE: { type: 'N', promoted: false },
  GI: { type: 'S', promoted: false },
  KI: { type: 'G', promoted: false },
  KA: { type: 'B', promoted: false },
  HI: { type: 'R', promoted: false },
  OU: { type: 'K', promoted: false },
  TO: { type: 'P', promoted: true },
  NY: { type: 'L', promoted: true },
  NK: { type: 'N', promoted: true },
  NG: { type: 'S', promoted: true },
  UM: { type: 'B', promoted: true },
  RY: { type: 'R', promoted: true },
};

function rankNumberToUsi(value: string): string {
  const rank = Number.parseInt(value, 10);
  if (rank < 1 || rank > 9) throw new Error(`盤上座標が不正です: ${value}`);
  return String.fromCharCode('a'.charCodeAt(0) + rank - 1);
}

function csaSquareToUsi(value: string): string {
  if (!/^[1-9]{2}$/.test(value)) throw new Error(`盤上座標が不正です: ${value}`);
  return `${value[0]}${rankNumberToUsi(value[1])}`;
}

function handicapToSfen(handicap: string): string {
  const removals: Record<string, Array<[number, number]>> = {
    HADAKA: [
      ...Array.from({ length: 9 }, (_, col) => [6, col] as [number, number]),
      [7, 1], [7, 7], [8, 0], [8, 8], [8, 1], [8, 7], [8, 2], [8, 6], [8, 3], [8, 5],
    ],
    '10MAI': [[7, 1], [7, 7], [8, 0], [8, 8], [8, 1], [8, 7], [8, 2], [8, 6], [8, 3], [8, 5]],
    '8MAI': [[7, 1], [7, 7], [8, 0], [8, 8], [8, 1], [8, 7], [8, 2], [8, 6]],
    '6MAI': [[7, 1], [7, 7], [8, 0], [8, 8], [8, 1], [8, 7]],
    '4MAI': [[7, 1], [7, 7], [8, 0], [8, 8]],
    '2MAI': [[7, 1], [7, 7]],
    HIKYO: [[7, 7], [8, 0]],
    HISHA: [[7, 7]],
    KAKU: [[7, 1]],
    RYOKYO: [[8, 0], [8, 8]],
    KYO: [[8, 0]],
  };
  const state = parseSfen(INITIAL_SFEN);
  const targets = removals[handicap];
  if (!targets) throw new Error(`駒落ち開始局面に未対応です: ${handicap}`);
  for (const [row, col] of targets) state.board[row][col] = null;
  return boardToSfen(state.board, state.sideToMove, state.senteHand, state.goteHand, state.moveNumber);
}

function resolveInitialSfen(game: ShogiQuestRawGame, history: ShogiQuestHistoryGame): string {
  const startPos = game.position?.startPos;
  if (typeof startPos === 'string') {
    const normalized = startPos.trim().replace(/^position\s+sfen\s+/i, '').replace(/^sfen\s+/i, '');
    if (normalized.includes('/') && /\s[wb]\s/.test(` ${normalized} `)) {
      return normalized.split(/\s+moves\s+/i)[0].trim();
    }
    throw new Error('将棋クエストの開始局面形式をSFENとして解釈できません');
  }
  if (startPos != null) {
    throw new Error('将棋クエストの開始局面形式に未対応です');
  }
  const handicap = game.position?.handicap ?? game.handicap ?? history.handicap;
  if (handicap) return handicapToSfen(handicap);
  return INITIAL_SFEN;
}

function convertQuestMoveToUsi(
  rawMove: string,
  state: ReturnType<typeof parseSfen>,
  sideToMove: Side,
): string {
  const normalized = rawMove.trim().toUpperCase();
  if (!/^(00|[1-9]{2})[1-9]{2}[A-Z]{2}$/.test(normalized)) {
    throw new Error(`指し手形式が不明です: ${rawMove}`);
  }

  const fromText = normalized.slice(0, 2);
  const toText = normalized.slice(2, 4);
  const csaPiece = CSA_PIECES[normalized.slice(4, 6)];
  if (!csaPiece) throw new Error(`駒種が不明です: ${rawMove}`);

  const toUsi = csaSquareToUsi(toText);
  const to = parseUsiSquare(toUsi);
  const destinationPiece = state.board[to.row]?.[to.col] ?? null;
  if (destinationPiece?.side === sideToMove) {
    throw new Error(`自駒のある升へ移動しています: ${rawMove}`);
  }

  if (fromText === '00') {
    if (csaPiece.type === 'K' || csaPiece.promoted) {
      throw new Error(`打ち駒の形式が不正です: ${rawMove}`);
    }
    const hand = sideToMove === 'sente' ? state.senteHand : state.goteHand;
    if ((hand[csaPiece.type as HandPieceType] ?? 0) < 1) {
      throw new Error(`持ち駒がありません: ${rawMove}`);
    }
    return `${csaPiece.type}*${toUsi}`;
  }

  const fromUsi = csaSquareToUsi(fromText);
  const from = parseUsiSquare(fromUsi);
  const movingPiece = state.board[from.row]?.[from.col] ?? null;
  if (!movingPiece) throw new Error(`移動元に駒がありません: ${rawMove}`);
  if (movingPiece.side !== sideToMove) throw new Error(`手番と移動駒が一致しません: ${rawMove}`);
  if (movingPiece.type !== csaPiece.type) throw new Error(`移動駒の種類が一致しません: ${rawMove}`);
  if (movingPiece.promoted && !csaPiece.promoted) throw new Error(`成駒が不成へ戻っています: ${rawMove}`);

  return `${fromUsi}${toUsi}${csaPiece.promoted && !movingPiece.promoted ? '+' : ''}`;
}

function normalizeQuestMoves(game: ShogiQuestRawGame, initialSfen: string): string[] {
  const rawMoves = game.position?.moves;
  if (!Array.isArray(rawMoves) || rawMoves.length === 0) {
    throw new Error('棋譜の指し手がありません');
  }

  let state = parseSfen(initialSfen);
  const moves: string[] = [];

  for (const [index, raw] of rawMoves.entries()) {
    if (!raw?.m) {
      if (raw?.s) continue;
      throw new Error(`${index + 1}手目の指し手がありません`);
    }
    const usi = convertQuestMoveToUsi(raw.m, state, state.sideToMove);
    const applied = applyUsiMove(state.board, state.senteHand, state.goteHand, state.sideToMove, usi);
    state = {
      ...applied,
      sideToMove: state.sideToMove === 'sente' ? 'gote' : 'sente',
      moveNumber: state.moveNumber + 1,
    };
    moves.push(usi);
  }

  if (moves.length === 0) throw new Error('有効な指し手がありません');
  return moves;
}

function stableShortHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function resolveResult(game: ShogiQuestRawGame, history: ShogiQuestHistoryGame): string | null {
  const moves = game.position?.moves ?? [];
  for (let index = moves.length - 1; index >= 0; index -= 1) {
    if (moves[index]?.s) return moves[index].s ?? null;
  }
  return history.finalStatus ?? null;
}

export function normalizeShogiQuestGame(fetched: ShogiQuestFetchedGame): {
  initialSfen: string;
  moves: string[];
  players: ShogiQuestPlayer[];
  startedAt: string | null;
} {
  const initialSfen = resolveInitialSfen(fetched.rawGame, fetched.history);
  const moves = normalizeQuestMoves(fetched.rawGame, initialSfen);
  return {
    initialSfen,
    moves,
    players: fetched.rawGame.players ?? fetched.history.players ?? [],
    startedAt: fetched.rawGame.created ?? fetched.history.created ?? null,
  };
}

export async function convertQuestGameToMakingKifu(
  fetched: ShogiQuestFetchedGame,
  context: Pick<ShogiQuestFetchResult, 'username' | 'mode' | 'fetchedAt'>,
): Promise<QuestKifuPreparedRecord> {
  const normalized = normalizeShogiQuestGame(fetched);
  const movesText = normalized.moves.join(' ');
  const sourceRef = fetched.gameId.trim() || `fallback:${stableShortHash([
    context.username,
    context.mode,
    normalized.startedAt ?? '',
    normalized.players.map((player) => player.id ?? player.name ?? '').join(':'),
    movesText,
  ].join('|'))}`;
  const kifuHash = await sha256(`${normalized.initialSfen}\n${movesText}`);

  return {
    sourceRef,
    startedAt: normalized.startedAt,
    players: normalized.players,
    movesCount: normalized.moves.length,
    initialSfen: normalized.initialSfen,
    moves: normalized.moves,
    row: {
      source_type: 'shogi_quest',
      source_ref: sourceRef,
      initial_sfen: normalized.initialSfen,
      moves: movesText,
      status: 'pending',
      kifu_hash: kifuHash,
      tags: ['shogi_quest', context.mode],
      base_position_id: null,
      source_payload: {
        username: context.username,
        mode: context.mode,
        gameId: fetched.gameId || null,
        source_ref: sourceRef,
        fetchedAt: context.fetchedAt,
        rawKifu: fetched.rawGame,
        history: fetched.history,
        players: normalized.players,
        startedAt: normalized.startedAt,
        endedAt: null,
        result: resolveResult(fetched.rawGame, fetched.history),
      },
    },
  };
}

export async function buildMakingKifuInsertRows(result: ShogiQuestFetchResult): Promise<QuestKifuPrepareResult> {
  const records: QuestKifuPreparedRecord[] = [];
  const errors: QuestKifuPrepareError[] = result.errors.map((error) => ({
    sourceRef: error.gameId ?? '取得失敗',
    gameId: error.gameId,
    startedAt: error.history?.created ?? null,
    players: error.history?.players ?? [],
    stage: 'fetch',
    message: error.message,
  }));

  for (const fetched of result.games) {
    try {
      records.push(await convertQuestGameToMakingKifu(fetched, result));
    } catch (error) {
      errors.push({
        sourceRef: fetched.gameId || '形式不明',
        gameId: fetched.gameId || null,
        startedAt: fetched.rawGame.created ?? fetched.history.created ?? null,
        players: fetched.rawGame.players ?? fetched.history.players ?? [],
        stage: 'parse',
        message: error instanceof Error ? error.message : '棋譜の変換に失敗しました',
      });
    }
  }

  return { records, errors };
}
