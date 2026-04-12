import { INITIAL_SFEN, parseSfen, applyUsiMove, boardToSfen } from './sfen';

// ---- Fullwidth / Kanji → number ----

const FW_TO_NUM: Record<string, number> = {
  '１': 1, '２': 2, '３': 3, '４': 4, '５': 5,
  '６': 6, '７': 7, '８': 8, '９': 9,
};

const KANJI_TO_NUM: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9,
};

// Piece kanji → uppercase piece letter (for drop moves)
const KANJI_TO_PIECE_CHAR: Record<string, string> = {
  '歩': 'P', '香': 'L', '桂': 'N', '銀': 'S',
  '金': 'G', '角': 'B', '飛': 'R', '玉': 'K', '王': 'K',
};

function rankToUsiChar(rank: number): string {
  return String.fromCharCode('a'.charCodeAt(0) + rank - 1);
}

// ---- Single KIF move parser ----

export interface ParsedKifMove {
  usi: string;
  dest: { file: number; rank: number };
}

/**
 * Parse a single KIF move token (e.g. "７六歩(77)", "△同歩(23)", "５五角打",
 * "２三銀成(24)") and return USI notation.
 *
 * `prevDest` is needed to resolve "同" (same-square) notation.
 */
export function parseKifMoveToken(
  token: string,
  prevDest: { file: number; rank: number } | null,
): ParsedKifMove | null {
  let s = token.trim().replace(/[ \t　]+/g, '');

  // Strip side marker ▲△☗☖
  if (/^[▲△☗☖]/.test(s)) {
    s = s.slice(1);
  }

  // ---- Destination square ----
  let destFile: number;
  let destRank: number;
  let rest: string;

  if (s.startsWith('同')) {
    if (!prevDest) return null;
    destFile = prevDest.file;
    destRank = prevDest.rank;
    rest = s.slice(1).replace(/^[\s　]+/, ''); // skip full/half-width spaces
  } else {
    const fw = FW_TO_NUM[s[0]];
    if (fw == null) return null;
    const kn = KANJI_TO_NUM[s[1]];
    if (kn == null) return null;
    destFile = fw;
    destRank = kn;
    rest = s.slice(2);
  }

  const destUsi = `${destFile}${rankToUsiChar(destRank)}`;

  // ---- Drop move (打) ----
  if (rest.includes('打')) {
    const piecePart = rest.replace('打', '').trim();
    const pieceChar = KANJI_TO_PIECE_CHAR[piecePart];
    if (!pieceChar) return null;
    return { usi: `${pieceChar}*${destUsi}`, dest: { file: destFile, rank: destRank } };
  }

  // ---- Regular move ----
  // Extract from-square "(NN)" at the end
  const fromIdx = rest.search(/\(\d\d\)\s*$/);
  if (fromIdx < 0) return null;
  const fromMatch = rest.match(/\((\d)(\d)\)\s*$/);
  if (!fromMatch) return null;
  const fromFile = parseInt(fromMatch[1], 10);
  const fromRank = parseInt(fromMatch[2], 10);
  const fromUsi = `${fromFile}${rankToUsiChar(fromRank)}`;

  // Piece + promotion part
  let piecePart = rest.slice(0, fromIdx).trim();

  let promote = false;
  if (piecePart.endsWith('不成')) {
    piecePart = piecePart.slice(0, -2);
  } else if (piecePart.endsWith('成')) {
    promote = true;
    piecePart = piecePart.slice(0, -1);
  }

  return {
    usi: `${fromUsi}${destUsi}${promote ? '+' : ''}`,
    dest: { file: destFile, rank: destRank },
  };
}

// ---- SFEN detection ----

function isLikelySfen(text: string): boolean {
  if (text.includes('\n')) return false;
  const parts = text.split(/\s+/);
  return parts.length >= 3 && parts[0].includes('/') && /^[bw]$/.test(parts[1]);
}

// ---- Full KIF record parser ----

export interface KifParseResult {
  sfen: string;
  moves: string[];
  moveLabels: string[];
}

export function parseKifRecord(text: string): KifParseResult | null {
  const trimmed = text.trim();

  // Allow pasting a plain SFEN string
  if (isLikelySfen(trimmed)) {
    return { sfen: trimmed, moves: [], moveLabels: [] };
  }

  const lines = trimmed.split('\n');
  const moves: string[] = [];
  const moveLabels: string[] = [];
  let prevDest: { file: number; rank: number } | null = null;

  for (const line of lines) {
    // Skip comment lines
    if (line.trimStart().startsWith('*')) continue;

    // Match move lines: "   1 ７六歩(77) ..."
    const m = line.match(/^\s*(\d+)\s+(.+)/);
    if (!m) continue;

    let moveText = m[2].trim();
    // Strip trailing time section (always contains ":")
    moveText = moveText.replace(/\s+\([^)]*:[^)]*\)\s*$/, '').trim();

    // Skip end-of-game tokens
    if (/^(投了|中断|千日手|持将棋|反則|詰み)/.test(moveText)) continue;

    const parsed = parseKifMoveToken(moveText, prevDest);
    if (!parsed) continue;

    moves.push(parsed.usi);
    moveLabels.push(moveText);
    prevDest = parsed.dest;
  }

  if (moves.length === 0) return null;

  // Apply moves from initial position to compute final SFEN
  const state = parseSfen(INITIAL_SFEN);
  let { board, senteHand, goteHand, sideToMove } = state;

  for (const usi of moves) {
    const result = applyUsiMove(board, senteHand, goteHand, sideToMove, usi);
    board = result.board;
    senteHand = result.senteHand;
    goteHand = result.goteHand;
    sideToMove = sideToMove === 'sente' ? 'gote' : 'sente';
  }

  const sfen = boardToSfen(board, sideToMove, senteHand, goteHand, moves.length + 1);
  return { sfen, moves, moveLabels };
}

// ---- Reading line parser ----

export interface ReadingLineResult {
  evalCp: number | null;
  moves: string[];   // All USI moves (first one = candidate move)
  labels: string[];  // Original KIF labels
}

/**
 * Parse engine analysis reading-line text.
 *
 * Example input:
 *   *検討 候補1 時間 00:06.0 深さ 27/43 ノード数 44995318 評価値 -7 読み筋 △８四歩(83) ▲７八金(69) ...
 */
export function parseReadingLine(text: string): ReadingLineResult | null {
  const normalizedText = text.replace(/\r\n?/g, '\n');

  // Extract evaluation value
  const evalMatch = normalizedText.match(/評価値\s+(-?\d+)/);
  const evalCp = evalMatch ? parseInt(evalMatch[1], 10) : null;

  // Extract move sequence after "読み筋"
  const lineMatch = normalizedText.match(/読み筋[\s　]+([\s\S]+)/);
  if (!lineMatch) return null;
  const lineText = lineMatch[1].replace(/\n/g, ' ').replace(/[ \t　]+/g, ' ').trim();

  // Split by side markers (▲△☗☖)
  const moveTexts = lineText.match(/[▲△☗☖][^▲△☗☖]+/g);
  if (!moveTexts || moveTexts.length === 0) return null;

  const moves: string[] = [];
  const labels: string[] = [];
  let prevDest: { file: number; rank: number } | null = null;

  for (const mt of moveTexts) {
    const trimmed = mt.trim();
    const parsed = parseKifMoveToken(trimmed, prevDest);
    if (!parsed) continue;
    moves.push(parsed.usi);
    labels.push(trimmed);
    prevDest = parsed.dest;
  }

  if (moves.length === 0) return null;
  return { evalCp, moves, labels };
}
