import { CAN_PROMOTE, type HandPieceType, type Side } from '../types/shogi';
import { getValidDestinations, getValidDropSquares } from './legal-moves';
import { parseKifRecord, type KifParseResult } from './kif-parser';
import { applyUsiMove, boardToSfen, parseSfen, parseUsiSquare } from './sfen';
import { hasBlockingPositionIssue, validateSfenPosition } from './position-validation';

export interface QuestKifuStepSnapshot {
  ply: number;
  moveNumber: number;
  sideToMove: Side;
  usi: string;
  label: string;
  sfenBefore: string;
  sfenAfter: string;
}

export interface QuestKifuImportError {
  recordIndex: number;
  message: string;
  sourceRef: string;
}

export interface QuestKifuImportRecord {
  initialSfen: string;
  moves: string[];
  moveLabels: string[];
  sourceType: 'quest';
  sourceRef: string;
  sourcePayload: Record<string, unknown>;
  sourceSnapshot: Record<string, unknown>;
  steps: QuestKifuStepSnapshot[];
  finalSfen: string;
}

export interface QuestKifuImportResult {
  records: QuestKifuImportRecord[];
  rows: Array<{
    initialSfen: string;
    moves: string[];
    sourceType: 'quest';
    sourceRef: string;
    sourcePayload: Record<string, unknown>;
    sourceSnapshot: Record<string, unknown>;
  }>;
  errors: QuestKifuImportError[];
  normalizedText: string;
}

export interface QuestKifuImportInput {
  text: string;
  username?: string | null;
  requestedCount?: number | null;
}

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function splitQuestRecords(text: string): string[] {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length <= 1) {
    return [text];
  }

  const parsedBlocks = blocks.filter((block) => {
    const parsed = parseKifRecord(block);
    return Boolean(parsed && parsed.moves.length > 0);
  });

  if (parsedBlocks.length > 1) {
    return parsedBlocks;
  }

  const direct = parseKifRecord(text);
  if (direct && direct.moves.length > 0) {
    return [text];
  }

  return parsedBlocks.length === 1 ? parsedBlocks : [text];
}

function isDropMove(usi: string): boolean {
  return usi.length >= 4 && usi[1] === '*';
}

function validateMoveOnState(
  state: ReturnType<typeof parseSfen>,
  sideToMove: Side,
  usi: string,
): string | null {
  if (!usi || usi.trim().length === 0) {
    return '空の指し手があります';
  }

  if (isDropMove(usi)) {
    const pieceType = usi[0] as HandPieceType;
    const hand = sideToMove === 'sente' ? state.senteHand : state.goteHand;
    if ((hand[pieceType] ?? 0) <= 0) {
      return `持ち駒の ${pieceType} がありません`;
    }

    const to = parseUsiSquare(usi.slice(2, 4));
    const legalDrops = getValidDropSquares(state.board, sideToMove, pieceType);
    if (!legalDrops.some((square) => square.row === to.row && square.col === to.col)) {
      return `${usi} は合法な打ち場所ではありません`;
    }
    return null;
  }

  const from = parseUsiSquare(usi.slice(0, 2));
  const to = parseUsiSquare(usi.slice(2, 4));
  const movingPiece = state.board[from.row]?.[from.col] ?? null;
  if (!movingPiece) {
    return `${usi} の元の升に駒がありません`;
  }
  if (movingPiece.side !== sideToMove) {
    return `${usi} は${sideToMove === 'sente' ? '先手' : '後手'}番ではありません`;
  }

  const legalDestinations = getValidDestinations(state.board, from.row, from.col, sideToMove);
  if (!legalDestinations.some((square) => square.row === to.row && square.col === to.col)) {
    return `${usi} は合法な移動先ではありません`;
  }

  const promotes = usi.length > 4 && usi[4] === '+';
  if (promotes && !CAN_PROMOTE[movingPiece.type]) {
    return `${usi} の駒は成れません`;
  }

  return null;
}

function buildRecord(
  parsed: KifParseResult,
  sourceText: string,
  recordIndex: number,
  username: string | null,
  requestedCount: number | null,
): QuestKifuImportRecord {
  const currentState = parseSfen(parsed.initialSfen);
  let board = currentState.board;
  let senteHand = currentState.senteHand;
  let goteHand = currentState.goteHand;
  let sideToMove = currentState.sideToMove;
  let moveNumber = currentState.moveNumber;

  const steps: QuestKifuStepSnapshot[] = [];

  parsed.moves.forEach((usi, index) => {
    const label = parsed.moveLabels[index] ?? usi;
    const validationError = validateMoveOnState({ board, senteHand, goteHand, sideToMove, moveNumber }, sideToMove, usi);
    if (validationError) {
      throw new Error(validationError);
    }

    const beforeSfen = boardToSfen(board, sideToMove, senteHand, goteHand, moveNumber);
    const result = applyUsiMove(board, senteHand, goteHand, sideToMove, usi);
    const nextSideToMove: Side = sideToMove === 'sente' ? 'gote' : 'sente';
    const nextMoveNumber = moveNumber + 1;
    const afterSfen = boardToSfen(result.board, nextSideToMove, result.senteHand, result.goteHand, nextMoveNumber);
    const issues = validateSfenPosition(afterSfen);
    const blockingIssue = issues.find((issue) => issue.severity === 'error');
    if (blockingIssue) {
      throw new Error(blockingIssue.message);
    }

    steps.push({
      ply: index + 1,
      moveNumber,
      sideToMove,
      usi,
      label,
      sfenBefore: beforeSfen,
      sfenAfter: afterSfen,
    });

    board = result.board;
    senteHand = result.senteHand;
    goteHand = result.goteHand;
    sideToMove = nextSideToMove;
    moveNumber = nextMoveNumber;
  });

  const finalSfen = boardToSfen(board, sideToMove, senteHand, goteHand, moveNumber);
  const sourceRef = `quest:${username ?? 'anonymous'}:${recordIndex + 1}:${hashText(sourceText)}`;

  return {
    initialSfen: parsed.initialSfen,
    moves: parsed.moves,
    moveLabels: parsed.moveLabels,
    sourceType: 'quest',
    sourceRef,
    sourcePayload: {
      importer: 'shogiquest',
      username,
      requestedCount,
      recordIndex: recordIndex + 1,
      moveCount: parsed.moves.length,
      initialMoveNumber: parsed.initialMoveNumber,
      initialSfen: parsed.initialSfen,
      finalSfen,
      steps,
    },
    sourceSnapshot: {
      importer: 'shogiquest',
      rawText: sourceText,
    },
    steps,
    finalSfen,
  };
}

export function parseQuestKifuImport(input: QuestKifuImportInput): QuestKifuImportResult {
  const normalizedText = normalizeText(input.text);
  if (!normalizedText) {
    return {
      records: [],
      rows: [],
      errors: [{ recordIndex: 0, message: '棋譜テキストを貼り付けてください', sourceRef: 'quest:empty' }],
      normalizedText,
    };
  }

  const chunks = splitQuestRecords(normalizedText);
  const records: QuestKifuImportRecord[] = [];
  const errors: QuestKifuImportError[] = [];

  chunks.forEach((chunk, index) => {
    const parsed = parseKifRecord(chunk);
    if (!parsed || parsed.moves.length === 0) {
      errors.push({
        recordIndex: index + 1,
        message: 'KIFとして解析できませんでした。将棋クエストの棋譜テキストをそのまま貼り付けてください。',
        sourceRef: `quest:${input.username ?? 'anonymous'}:${index + 1}:${hashText(chunk)}`,
      });
      return;
    }

    try {
      const record = buildRecord(parsed, chunk, index, input.username?.trim() || null, input.requestedCount ?? null);
      records.push(record);
    } catch (nextError: any) {
      errors.push({
        recordIndex: index + 1,
        message: nextError?.message ?? '棋譜の変換に失敗しました',
        sourceRef: `quest:${input.username ?? 'anonymous'}:${index + 1}:${hashText(chunk)}`,
      });
    }
  });

  return {
    records,
    rows: records.map((record) => ({
      initialSfen: record.initialSfen,
      moves: record.moves,
      sourceType: record.sourceType,
      sourceRef: record.sourceRef,
      sourcePayload: record.sourcePayload,
      sourceSnapshot: record.sourceSnapshot,
    })),
    errors,
    normalizedText,
  };
}