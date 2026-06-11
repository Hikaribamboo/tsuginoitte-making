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

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256(text: string): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const bytes = Array.from(new TextEncoder().encode(text));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 56; shift >= 0; shift -= 8) {
    bytes.push(Math.floor(bitLength / (2 ** shift)) & 0xff);
  }

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(64);
    for (let index = 0; index < 16; index += 1) {
      const byteIndex = offset + index * 4;
      words[index] = (
        (bytes[byteIndex] << 24)
        | (bytes[byteIndex + 1] << 16)
        | (bytes[byteIndex + 2] << 8)
        | bytes[byteIndex + 3]
      );
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) | 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const choice = (e & f) ^ (~e & g);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const temporary1 = (h + sum1 + choice + constants[index] + words[index]) | 0;
      const temporary2 = (sum0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) | 0;
    }
    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  return hash.map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('');
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
  const kifuHash = sha256(`${normalized.initialSfen}\n${movesText}`);

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
