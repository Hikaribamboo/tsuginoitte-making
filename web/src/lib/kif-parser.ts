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

    // Stop at first branch marker
    if (/^変化：/.test(line.trim())) break;

    // Match move lines: "   1 ７六歩(77) ..."
    const m = line.match(/^\s*(\d+)\s+(.+)/);
    if (!m) continue;

    let moveText = m[2].trim();
    // Strip trailing time section (always contains ":") and branch marker "+"
    moveText = moveText.replace(/\s+\([^)]*:[^)]*\)\s*\+?\s*$/, '').trim();

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

// ---- Branching KIF record parser ----

export interface KifBranch {
  id: number;
  name: string;
  branchPoint: number; // 0-based index in the parent moves where this branch diverges
  moves: string[];
  moveLabels: string[];
  sfen: string;
}

/** Tree node for rendering the branch diagram */
export interface KifTreeNode {
  moveNumber: number;  // 1-based
  usi: string;
  label: string;
  branchId: number;    // which branch this node belongs to
  children: KifTreeNode[];
}

export interface KifBranchParseResult {
  branches: KifBranch[];
  tree: KifTreeNode[];
}

/**
 * Parse a KIF record that may contain branches (変化).
 * Returns null if no moves can be parsed.
 * If no branches are present, returns a single branch (main line).
 */
export function parseKifRecordWithBranches(text: string): KifBranchParseResult | null {
  const trimmed = text.trim();

  if (isLikelySfen(trimmed)) {
    const branch: KifBranch = {
      id: 0,
      name: '本譜',
      branchPoint: 0,
      moves: [],
      moveLabels: [],
      sfen: trimmed,
    };
    return { branches: [branch], tree: [] };
  }

  const lines = trimmed.split('\n');

  // Split into segments: main line + each 変化 block
  interface RawSegment {
    name: string;
    branchMoveNumber: number; // 0 for main line
    moveLines: string[];
  }

  const segments: RawSegment[] = [];
  let currentSegment: RawSegment = { name: '本譜', branchMoveNumber: 0, moveLines: [] };

  for (const line of lines) {
    const branchMatch = line.trim().match(/^変化：(\d+)手$/);
    if (branchMatch) {
      segments.push(currentSegment);
      currentSegment = {
        name: `変化：${branchMatch[1]}手`,
        branchMoveNumber: parseInt(branchMatch[1], 10),
        moveLines: [],
      };
      continue;
    }
    currentSegment.moveLines.push(line);
  }
  segments.push(currentSegment);

  // Parse each segment into moves
  function parseMoveLines(
    moveLines: string[],
  ): { moves: string[]; labels: string[]; moveNumbers: number[] } {
    const moves: string[] = [];
    const labels: string[] = [];
    const moveNumbers: number[] = [];
    let prevDest: { file: number; rank: number } | null = null;

    for (const line of moveLines) {
      if (line.trimStart().startsWith('*')) continue;
      const m = line.match(/^\s*(\d+)\s+(.+)/);
      if (!m) continue;

      const moveNum = parseInt(m[1], 10);
      let moveText = m[2].trim();
      moveText = moveText.replace(/\s+\([^)]*:[^)]*\)\s*\+?\s*$/, '').trim();

      if (/^(投了|中断|千日手|持将棋|反則|詰み)/.test(moveText)) continue;

      const parsed = parseKifMoveToken(moveText, prevDest);
      if (!parsed) continue;

      moves.push(parsed.usi);
      labels.push(moveText);
      moveNumbers.push(moveNum);
      prevDest = parsed.dest;
    }
    return { moves, labels, moveNumbers };
  }

  // Parse main line first
  const mainParsed = parseMoveLines(segments[0].moveLines);
  if (mainParsed.moves.length === 0) return null;

  // Compute SFEN for a given moves array
  function computeSfen(moves: string[]): string {
    const state = parseSfen(INITIAL_SFEN);
    let { board, senteHand, goteHand, sideToMove } = state;
    for (const usi of moves) {
      const result = applyUsiMove(board, senteHand, goteHand, sideToMove, usi);
      board = result.board;
      senteHand = result.senteHand;
      goteHand = result.goteHand;
      sideToMove = sideToMove === 'sente' ? 'gote' : 'sente';
    }
    return boardToSfen(board, sideToMove, senteHand, goteHand, moves.length + 1);
  }

  const branches: KifBranch[] = [];

  // Main branch
  branches.push({
    id: 0,
    name: '本譜',
    branchPoint: 0,
    moves: mainParsed.moves,
    moveLabels: mainParsed.labels,
    sfen: computeSfen(mainParsed.moves),
  });

  // Process variation segments
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const varParsed = parseMoveLines(seg.moveLines);
    if (varParsed.moves.length === 0) continue;

    // The branch diverges at branchMoveNumber, so we take the main line
    // up to (branchMoveNumber - 1) as the shared prefix
    const prefixLength = seg.branchMoveNumber - 1;
    const sharedPrefix = mainParsed.moves.slice(0, prefixLength);
    const fullMoves = [...sharedPrefix, ...varParsed.moves];

    branches.push({
      id: i,
      name: seg.name,
      branchPoint: prefixLength, // 0-based index where branch diverges
      moves: fullMoves,
      moveLabels: [
        ...mainParsed.labels.slice(0, prefixLength),
        ...varParsed.labels,
      ],
      sfen: computeSfen(fullMoves),
    });
  }

  // Build tree for diagram
  const tree = buildKifTree(branches);

  return { branches, tree };
}

/** Build a tree structure from branches for rendering */
function buildKifTree(branches: KifBranch[]): KifTreeNode[] {
  if (branches.length === 0) return [];

  // Start with the main line as the trunk
  const mainBranch = branches[0];
  const root: KifTreeNode[] = [];

  // Build main line chain
  let currentChildren = root;
  const mainNodes: KifTreeNode[] = [];
  for (let i = 0; i < mainBranch.moves.length; i++) {
    const node: KifTreeNode = {
      moveNumber: i + 1,
      usi: mainBranch.moves[i],
      label: mainBranch.moveLabels[i],
      branchId: 0,
      children: [],
    };
    currentChildren.push(node);
    mainNodes.push(node);
    currentChildren = node.children;
  }

  // Attach variation branches at their branch points
  for (let b = 1; b < branches.length; b++) {
    const branch = branches[b];
    const parentIdx = branch.branchPoint - 1; // node index before divergence
    const parentNode = parentIdx >= 0 ? mainNodes[parentIdx] : null;
    const attachTo = parentNode ? parentNode.children : root;

    let chainChildren = attachTo;
    for (let i = branch.branchPoint; i < branch.moves.length; i++) {
      const node: KifTreeNode = {
        moveNumber: i + 1,
        usi: branch.moves[i],
        label: branch.moveLabels[i],
        branchId: b,
        children: [],
      };
      chainChildren.push(node);
      chainChildren = node.children;
    }
  }

  return root;
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
