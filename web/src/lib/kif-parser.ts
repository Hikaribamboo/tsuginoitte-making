import { INITIAL_SFEN, parseSfen, applyUsiMove, boardToSfen, parseUsiSquare } from './sfen';
import { createEmptyBoard, EMPTY_HAND } from '../types/shogi';
import type { Board, HandPieceType, PieceType, Side } from '../types/shogi';

// ---- Fullwidth / Kanji → number ----

const FW_TO_NUM: Record<string, number> = {
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
  '6': 6, '7': 7, '8': 8, '9': 9,
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

const DIAGRAM_PIECE_MAP: Record<string, { type: PieceType; promoted: boolean }> = {
  '玉': { type: 'K', promoted: false },
  '王': { type: 'K', promoted: false },
  '飛': { type: 'R', promoted: false },
  '角': { type: 'B', promoted: false },
  '金': { type: 'G', promoted: false },
  '銀': { type: 'S', promoted: false },
  '桂': { type: 'N', promoted: false },
  '香': { type: 'L', promoted: false },
  '歩': { type: 'P', promoted: false },
  '龍': { type: 'R', promoted: true },
  '竜': { type: 'R', promoted: true },
  '馬': { type: 'B', promoted: true },
  'と': { type: 'P', promoted: true },
  '全': { type: 'S', promoted: true },
  '圭': { type: 'N', promoted: true },
  '杏': { type: 'L', promoted: true },
  '成銀': { type: 'S', promoted: true },
  '成桂': { type: 'N', promoted: true },
  '成香': { type: 'L', promoted: true },
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

function parseJapaneseCount(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 1;

  const asciiDigits = normalized.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  if (/^\d+$/.test(asciiDigits)) return parseInt(asciiDigits, 10);

  const values: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9,
  };

  if (asciiDigits === '十') return 10;
  const tenIndex = asciiDigits.indexOf('十');
  if (tenIndex >= 0) {
    const tensText = asciiDigits.slice(0, tenIndex);
    const onesText = asciiDigits.slice(tenIndex + 1);
    const tens = tensText ? (values[tensText] ?? 0) : 1;
    const ones = onesText ? (values[onesText] ?? 0) : 0;
    return tens * 10 + ones;
  }

  return values[asciiDigits] ?? 1;
}

function parseHandText(text: string): Record<HandPieceType, number> {
  const hand = { ...EMPTY_HAND };
  const normalized = text.trim();
  if (!normalized || normalized === 'なし') return hand;

  const tokenRe = /(飛|角|金|銀|桂|香|歩)([一二三四五六七八九十0-9０-９]*)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(normalized)) !== null) {
    const pieceChar = KANJI_TO_PIECE_CHAR[match[1]];
    if (!pieceChar || pieceChar === 'K') continue;
    hand[pieceChar as HandPieceType] = parseJapaneseCount(match[2] ?? '');
  }

  return hand;
}

interface ParsedPositionText {
  sfen: string;
  moves: string[];
  moveNumber: number;
}

function inferSideToMoveFromFirstMove(
  moveText: string,
  board: Board,
  senteHand: Record<HandPieceType, number>,
  goteHand: Record<HandPieceType, number>,
): Side | null {
  const marker = moveText.trim().charAt(0);
  if (marker === '▲' || marker === '☗') return 'sente';
  if (marker === '△' || marker === '☖') return 'gote';

  const parsed = parseKifMoveToken(moveText, null);
  if (!parsed) return null;

  if (parsed.usi.includes('*')) {
    const handType = parsed.usi.charAt(0) as HandPieceType;
    const senteHas = (senteHand[handType] ?? 0) > 0;
    const goteHas = (goteHand[handType] ?? 0) > 0;
    if (senteHas && !goteHas) return 'sente';
    if (goteHas && !senteHas) return 'gote';
    return null;
  }

  const fromSq = parsed.usi.slice(0, 2);
  const { row, col } = parseUsiSquare(fromSq);
  const piece = board[row]?.[col] ?? null;
  return piece?.side ?? null;
}

function computeSfenFromMoves(initialSfen: string, initialMoveNumber: number, moves: string[]): string {
  const state = parseSfen(initialSfen);
  let { board, senteHand, goteHand, sideToMove } = state;

  for (const usi of moves) {
    const result = applyUsiMove(board, senteHand, goteHand, sideToMove, usi);
    board = result.board;
    senteHand = result.senteHand;
    goteHand = result.goteHand;
    sideToMove = sideToMove === 'sente' ? 'gote' : 'sente';
  }

  return boardToSfen(board, sideToMove, senteHand, goteHand, initialMoveNumber + moves.length);
}

function parseSfenWithMovesText(text: string): ParsedPositionText | null {
  const singleLine = text.replace(/\r\n?/g, '\n').trim().replace(/\s+/g, ' ');
  if (!singleLine) return null;

  let source = singleLine;

  const embeddedPosition = singleLine.match(/position\s+sfen\s+(.+)$/i);
  if (embeddedPosition?.[1]) {
    source = embeddedPosition[1].trim();
  }

  if (/^sfen\s+/i.test(source)) {
    source = source.replace(/^sfen\s+/i, '').trim();
  }

  const moveSplit = source.split(/\s+moves\s+/i);
  const sfen = moveSplit[0]?.trim() ?? '';
  if (!isLikelySfen(sfen)) return null;

  const moves = moveSplit[1]?.trim() ? moveSplit[1].trim().split(/\s+/) : [];
  const moveNumber = parseSfen(sfen).moveNumber;
  return {
    sfen: moves.length > 0 ? computeSfenFromMoves(sfen, moveNumber, moves) : sfen,
    moves,
    moveNumber,
  };
}

function parseBoardDiagramPosition(text: string): ParsedPositionText | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const goteHandLine = lines.find((line) => line.includes('後手の持駒'));
  const senteHandLine = lines.find((line) => line.includes('先手の持駒'));
  const boardLineRegex = /^\s*\|(.+)\|(?:[一二三四五六七八九1-9１-９])?\s*$/;
  const boardLines = lines.filter((line) => boardLineRegex.test(line));

  if (!goteHandLine || !senteHandLine || boardLines.length !== 9) return null;

  const board: Board = createEmptyBoard();

  function tokenizeDiagramRow(rowText: string): string[] {
    const compact = rowText.replace(/[\s　]+/g, '');
    const out: string[] = [];
    let i = 0;

    while (i < compact.length) {
      let prefix = '';
      if (compact[i] === 'v' || compact[i] === 'V') {
        prefix = 'v';
        i += 1;
      }

      if (i >= compact.length) break;

      let piece = compact[i];
      if (piece === '成' && i + 1 < compact.length) {
        const next = compact[i + 1];
        if (next === '銀' || next === '桂' || next === '香') {
          piece = `成${next}`;
          i += 2;
        } else {
          i += 1;
        }
      } else {
        i += 1;
      }

      out.push(`${prefix}${piece}`);
    }

    return out;
  }

  for (let row = 0; row < 9; row++) {
    const match = boardLines[row].match(boardLineRegex);
    if (!match) return null;
    const cells = tokenizeDiagramRow(match[1]);
    if (cells.length !== 9) return null;

    for (let col = 0; col < 9; col++) {
      const rawCell = cells[col];
      if (rawCell === '・') continue;

      let side: Side = 'sente';
      let pieceText = rawCell;
      if (pieceText.startsWith('v') || pieceText.startsWith('V')) {
        side = 'gote';
        pieceText = pieceText.slice(1);
      }

      const piece = DIAGRAM_PIECE_MAP[pieceText];
      if (!piece) return null;
      board[row][col] = { type: piece.type, side, promoted: piece.promoted };
    }
  }

  const goteHandMatch = goteHandLine.match(/後手の持駒[:：]\s*(.*)$/);
  const senteHandMatch = senteHandLine.match(/先手の持駒[:：]\s*(.*)$/);
  const goteHand = parseHandText(goteHandMatch?.[1] ?? '');
  const senteHand = parseHandText(senteHandMatch?.[1] ?? '');

  const firstMove = lines.map((line) => extractKifMoveFromLine(line)).find(Boolean) ?? null;
  const moveNumber = firstMove?.moveNumber ?? 1;
  const inferredSide = firstMove
    ? inferSideToMoveFromFirstMove(firstMove.moveText, board, senteHand, goteHand)
    : null;
  const sideToMove: Side = inferredSide ?? (moveNumber % 2 === 1 ? 'sente' : 'gote');
  const sfen = boardToSfen(board, sideToMove, senteHand, goteHand, moveNumber);

  return { sfen, moves: [], moveNumber };
}

function extractKifMoveFromLine(line: string): { moveNumber: number; moveText: string } | null {
  const m = line.match(/^\s*(\d+)\s+(.+)/);
  if (!m) return null;

  const moveNumber = parseInt(m[1], 10);
  let moveText = m[2].trim();

  // Strip trailing elapsed/consumed time section if present.
  // Example: "７六歩(77)        ( 0:00/00:00:00)" -> "７六歩(77)"
  moveText = moveText.replace(/\s+\([^)]*:[^)]*\)\s*\+?\s*$/, '').trim();

  return { moveNumber, moveText };
}

// ---- Full KIF record parser ----

export interface KifParseResult {
  sfen: string;
  moves: string[];
  moveLabels: string[];
}

export function parseKifRecord(text: string): KifParseResult | null {
  const trimmed = text.trim();

  const parsedSfenText = parseSfenWithMovesText(trimmed);
  if (parsedSfenText) {
    return { sfen: parsedSfenText.sfen, moves: parsedSfenText.moves, moveLabels: [] };
  }

  // Allow pasting a plain SFEN string
  if (isLikelySfen(trimmed)) {
    return { sfen: trimmed, moves: [], moveLabels: [] };
  }

  const basePosition = parseBoardDiagramPosition(trimmed);
  const initialSfen = basePosition?.sfen ?? INITIAL_SFEN;
  const initialMoveNumber = basePosition?.moveNumber ?? 1;
  const lines = trimmed.split('\n');
  const moves: string[] = [];
  const moveLabels: string[] = [];
  let prevDest: { file: number; rank: number } | null = null;

  for (const line of lines) {
    // Skip comment lines
    if (line.trimStart().startsWith('*')) continue;

    // Stop at first branch marker
    if (/^変化：/.test(line.trim())) break;

    const lineMove = extractKifMoveFromLine(line);
    if (!lineMove) continue;
    const moveText = lineMove.moveText;

    // Skip end-of-game tokens
    if (/^(投了|中断|千日手|持将棋|反則|詰み)/.test(moveText)) continue;

    const parsed = parseKifMoveToken(moveText, prevDest);
    if (!parsed) continue;

    moves.push(parsed.usi);
    moveLabels.push(moveText);
    prevDest = parsed.dest;
  }

  if (moves.length === 0) {
    return basePosition ? { sfen: basePosition.sfen, moves: [], moveLabels: [] } : null;
  }

  const sfen = computeSfenFromMoves(initialSfen, initialMoveNumber, moves);
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

  const parsedSfenText = parseSfenWithMovesText(trimmed);
  if (parsedSfenText) {
    const branch: KifBranch = {
      id: 0,
      name: '本譜',
      branchPoint: 0,
      moves: parsedSfenText.moves,
      moveLabels: [],
      sfen: parsedSfenText.sfen,
    };
    return { branches: [branch], tree: [] };
  }

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

  const basePosition = parseBoardDiagramPosition(trimmed);
  const initialSfen = basePosition?.sfen ?? INITIAL_SFEN;
  const initialMoveNumber = basePosition?.moveNumber ?? 1;
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
      const lineMove = extractKifMoveFromLine(line);
      if (!lineMove) continue;

      const moveNum = lineMove.moveNumber;
      const moveText = lineMove.moveText;

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
  if (mainParsed.moves.length === 0) {
    if (!basePosition) return null;
    return {
      branches: [{
        id: 0,
        name: '本譜',
        branchPoint: 0,
        moves: [],
        moveLabels: [],
        sfen: basePosition.sfen,
      }],
      tree: [],
    };
  }

  // Compute SFEN for a given moves array
  function computeSfen(moves: string[]): string {
    return computeSfenFromMoves(initialSfen, initialMoveNumber, moves);
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

export interface ReadingLineParseOptions {
  initialPrevDest?: { file: number; rank: number };
}

/**
 * Parse engine analysis reading-line text.
 *
 * Example input:
 *   *検討 候補1 時間 00:06.0 深さ 27/43 ノード数 44995318 評価値 -7 読み筋 △８四歩(83) ▲７八金(69) ...
 */
export function parseReadingLine(
  text: string,
  options?: ReadingLineParseOptions,
): ReadingLineResult | null {
  const normalizedText = text.replace(/\r\n?/g, '\n');

  // Extract evaluation value from either "*#評価値=..." or "評価値 ..." forms.
  let evalCp: number | null = null;
  const evalMatch = normalizedText.match(/(?:\*#評価値=|評価値(?:=|\s+))\s*(-?\d+)/);
  if (evalMatch) {
    evalCp = parseInt(evalMatch[1], 10);
  }

  // 1) KIF手順リスト形式: " 46 ６六角(44) ..."
  const kifLines = normalizedText.split('\n').filter(l => l.match(/^\s*\d+\s+/));
  let moveTexts: string[] | null = null;
  if (kifLines.length > 0) {
    moveTexts = kifLines
      .map((l) => extractKifMoveFromLine(l)?.moveText ?? '')
      .filter(Boolean);
  }

  // 2) 1行読み筋形式: "*検討 ... 評価値 454 読み筋 ▲８五飛(25) △６四角打 ..."
  if (!moveTexts || moveTexts.length === 0) {
    const readingStart = normalizedText.search(/(?:\*#)?読み筋(?:=|\s+)/);
    if (readingStart >= 0) {
      const readingPart = normalizedText
        .slice(readingStart)
        .replace(/^(?:\*#)?読み筋(?:=|\s+)/, '');

      // Match shogi move labels starting with side marker.
      // Supports examples like "▲８五飛(25)", "△６四角打", "▲同　角(66)".
      const tokenRe = /[▲△☗☖](?:同[ 　]*(?:歩|香|桂|銀|金|角|飛|玉|王|と|馬|龍|竜)(?:不成|成|打)?(?:\(\d\d\))?|[１２３４５６７８９1-9][一二三四五六七八九](?:歩|香|桂|銀|金|角|飛|玉|王|と|馬|龍|竜)(?:不成|成|打)?(?:\(\d\d\))?)/g;
      const matches = readingPart.match(tokenRe);
      if (matches && matches.length > 0) {
        moveTexts = matches;
      }
    }
  }

  if (!moveTexts || moveTexts.length === 0) return null;

  // 3) フォールバック: ヘッダーなしで直接手順が貼り付けられた場合
  //    例: "△７六飛(86) ▲５三歩打 ..." や読み筋ヘッダー未検出の形式
  if (!moveTexts || moveTexts.length === 0) {
    const tokenRe = /[▲△☗☖](?:同[ 　]*(?:歩|香|桂|銀|金|角|飛|玉|王|と|馬|龍|竜)(?:不成|成|打)?(?:\(\d\d\))?|[１２３４５６７８９1-9][一二三四五六七八九](?:歩|香|桂|銀|金|角|飛|玉|王|と|馬|龍|竜)(?:不成|成|打)?(?:\(\d\d\))?)/g;
    const matches = normalizedText.match(tokenRe);
    if (matches && matches.length > 0) {
      moveTexts = matches;
    }
  }

  const moves: string[] = [];
  const labels: string[] = [];
  let prevDest: { file: number; rank: number } | null = options?.initialPrevDest ?? null;

  for (let i = 0; i < moveTexts.length; i++) {
    const mt = moveTexts[i];
    const trimmed = mt.trim();
    const parsed = parseKifMoveToken(trimmed, prevDest);
    if (!parsed) continue;
    moves.push(parsed.usi);
    labels.push(trimmed);
    // 1手目のfrom→toをprevDestにセット（途中局面対応）
    if (i === 0) {
      prevDest = parsed.dest;
    } else {
      prevDest = parsed.dest;
    }
  }

  if (moves.length === 0) return null;
  return { evalCp, moves, labels };
}
