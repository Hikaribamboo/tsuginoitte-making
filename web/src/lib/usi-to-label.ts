import type { Board, Piece, PieceType, Side } from '../types/shogi';
import { PIECE_KANJI, PROMOTED_KANJI } from '../types/shogi';
import { parseUsiSquare, parseSfen, applyUsiMove } from './sfen';

// ---- Coordinate label helpers ----

const FULLWIDTH_NUMBERS = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９'];
const KANJI_NUMBERS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function fileLabel(file: number): string {
  return FULLWIDTH_NUMBERS[file] ?? String(file);
}

function rankLabel(rank: number): string {
  return KANJI_NUMBERS[rank] ?? String(rank);
}

function sideMarker(side: Side): string {
  return side === 'sente' ? '▲' : '△';
}

function pieceDisplayName(piece: Piece): string {
  return piece.promoted ? PROMOTED_KANJI[piece.type] : PIECE_KANJI[piece.type];
}

// ---- Main conversion ----

/**
 * Convert USI move string to Japanese label.
 *
 * @param usi    USI move, e.g. "7g7f", "P*5e", "2d2c+"
 * @param board  Current board (before the move)
 * @param side   Side making the move
 */
export function usiToLabel(usi: string, board: Board, side: Side): string {
  const marker = sideMarker(side);

  const isDrop = usi[1] === '*';
  if (isDrop) {
    const pieceChar = usi[0] as PieceType;
    const to = parseUsiSquare(usi.slice(2, 4));
    const file = 9 - to.col; // col 0 = file 9
    const rank = to.row + 1;
    const name = PIECE_KANJI[pieceChar];
    return `${marker}${fileLabel(file)}${rankLabel(rank)}${name}打`;
  }

  const from = parseUsiSquare(usi.slice(0, 2));
  const to = parseUsiSquare(usi.slice(2, 4));
  const promote = usi.length > 4 && usi[4] === '+';

  const piece = board[from.row]?.[from.col];
  if (!piece) return `${marker}${usi}`;

  const file = 9 - to.col;
  const rank = to.row + 1;

  let name: string;
  if (promote) {
    name = PIECE_KANJI[piece.type] + '成';
  } else {
    name = pieceDisplayName(piece);
  }

  return `${marker}${fileLabel(file)}${rankLabel(rank)}${name}`;
}

/**
 * Convert a PV (sequence of USI moves) to Japanese notation array.
 * Simulates the board forward to get correct piece names.
 *
 * @param pv      Array of USI moves, e.g. ["8c8d", "2g2f", ...]
 * @param sfen    Starting SFEN position
 * @param maxMoves  Max moves to convert (default 10)
 */
export function pvToJapanese(pv: string[], sfen: string, maxMoves = 10): string[] {
  const state = parseSfen(sfen);
  let { board, senteHand, goteHand, sideToMove } = state;
  const labels: string[] = [];
  let prevToSquare: { row: number; col: number } | null = null;

  const count = Math.min(pv.length, maxMoves);
  for (let i = 0; i < count; i++) {
    const usi = pv[i];
    const marker = sideMarker(sideToMove);
    const isDrop = usi[1] === '*';

    if (isDrop) {
      const pieceChar = usi[0] as PieceType;
      const to = parseUsiSquare(usi.slice(2, 4));
      const file = 9 - to.col;
      const rank = to.row + 1;
      const name = PIECE_KANJI[pieceChar];
      // 同 check
      const isSame = prevToSquare && prevToSquare.row === to.row && prevToSquare.col === to.col;
      const sq = isSame ? '同' : `${fileLabel(file)}${rankLabel(rank)}`;
      labels.push(`${marker}${sq}${name}打`);
      prevToSquare = to;
    } else {
      const from = parseUsiSquare(usi.slice(0, 2));
      const to = parseUsiSquare(usi.slice(2, 4));
      const promote = usi.length > 4 && usi[4] === '+';
      const piece = board[from.row]?.[from.col];

      const file = 9 - to.col;
      const rank = to.row + 1;

      let name: string;
      if (!piece) {
        name = usi;
      } else if (promote) {
        name = PIECE_KANJI[piece.type] + '成';
      } else {
        name = pieceDisplayName(piece);
      }

      // 同 check: same destination as previous move
      const isSame = prevToSquare && prevToSquare.row === to.row && prevToSquare.col === to.col;
      const sq = isSame ? '同' : `${fileLabel(file)}${rankLabel(rank)}`;
      labels.push(`${marker}${sq}${name}`);
      prevToSquare = to;
    }

    // Apply the move to advance the board
    const result = applyUsiMove(board, senteHand, goteHand, sideToMove, usi);
    board = result.board;
    senteHand = result.senteHand;
    goteHand = result.goteHand;
    sideToMove = sideToMove === 'sente' ? 'gote' : 'sente';
  }

  return labels;
}
