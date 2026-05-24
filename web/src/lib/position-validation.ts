import { getValidDestinations } from './legal-moves';
import { parseSfen } from './sfen';
import type { Board, PieceType, Side } from '../types/shogi';
import { HAND_PIECE_TYPES, PIECE_KANJI } from '../types/shogi';

export type PositionIssueSeverity = 'error' | 'warning';

export interface PositionIssue {
  severity: PositionIssueSeverity;
  message: string;
}

const TOTAL_PIECES: Record<PieceType, number> = {
  K: 2,
  R: 2,
  B: 2,
  G: 4,
  S: 4,
  N: 4,
  L: 4,
  P: 18,
};

const SIDE_LABEL: Record<Side, string> = {
  sente: '先手',
  gote: '後手',
};

function addIssue(
  issues: PositionIssue[],
  severity: PositionIssueSeverity,
  message: string,
) {
  issues.push({ severity, message });
}

function findKing(board: Board, side: Side): { row: number; col: number } | null {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const piece = board[row][col];
      if (piece?.type === 'K' && piece.side === side) {
        return { row, col };
      }
    }
  }
  return null;
}

function isSquareAttacked(
  board: Board,
  target: { row: number; col: number },
  attacker: Side,
): boolean {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const piece = board[row][col];
      if (!piece || piece.side !== attacker) continue;
      const destinations = getValidDestinations(board, row, col, attacker);
      if (destinations.some((sq) => sq.row === target.row && sq.col === target.col)) {
        return true;
      }
    }
  }
  return false;
}

function validateSfenShape(sfen: string, issues: PositionIssue[]) {
  const parts = sfen.trim().split(/\s+/);
  const boardPart = parts[0] ?? '';
  const rows = boardPart.split('/');

  if (parts.length < 4) {
    addIssue(issues, 'error', 'SFENが4要素（盤面・手番・持駒・手数）になっていません');
  }
  if (rows.length !== 9) {
    addIssue(issues, 'error', 'SFENの盤面が9段になっていません');
    return;
  }

  rows.forEach((rowText, rowIndex) => {
    let colCount = 0;
    let promoted = false;
    for (const ch of rowText) {
      if (ch === '+') {
        promoted = true;
        continue;
      }
      const digit = Number.parseInt(ch, 10);
      if (!Number.isNaN(digit)) {
        colCount += digit;
        promoted = false;
        continue;
      }
      if (!/[KRBGSNLPkrbgsnlp]/.test(ch)) {
        addIssue(issues, 'error', `${rowIndex + 1}段目にSFENで使えない文字があります`);
      }
      colCount += 1;
      promoted = false;
    }
    if (promoted) {
      addIssue(issues, 'error', `${rowIndex + 1}段目の成り記号の後に駒がありません`);
    }
    if (colCount !== 9) {
      addIssue(issues, 'error', `${rowIndex + 1}段目が9マスになっていません`);
    }
  });
}

export function validateSfenPosition(sfen: string): PositionIssue[] {
  const issues: PositionIssue[] = [];
  const trimmed = sfen.trim();
  if (!trimmed) {
    return [{ severity: 'error', message: 'SFENが空です' }];
  }

  validateSfenShape(trimmed, issues);

  const state = parseSfen(trimmed);
  const counts: Record<PieceType, number> = {
    K: 0,
    R: 0,
    B: 0,
    G: 0,
    S: 0,
    N: 0,
    L: 0,
    P: 0,
  };
  const kingCount: Record<Side, number> = { sente: 0, gote: 0 };
  const unpromotedPawnsByFile: Record<Side, number[]> = {
    sente: Array.from({ length: 9 }, () => 0),
    gote: Array.from({ length: 9 }, () => 0),
  };

  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const piece = state.board[row][col];
      if (!piece) continue;

      counts[piece.type] += 1;
      if (piece.type === 'K') kingCount[piece.side] += 1;
      if (piece.type === 'P' && !piece.promoted) {
        unpromotedPawnsByFile[piece.side][col] += 1;
      }

      if (!piece.promoted) {
        const sideLabel = SIDE_LABEL[piece.side];
        if ((piece.type === 'P' || piece.type === 'L')) {
          if (piece.side === 'sente' && row === 0) {
            addIssue(issues, 'error', `${sideLabel}の${PIECE_KANJI[piece.type]}が一段目にあります`);
          }
          if (piece.side === 'gote' && row === 8) {
            addIssue(issues, 'error', `${sideLabel}の${PIECE_KANJI[piece.type]}が九段目にあります`);
          }
        }
        if (piece.type === 'N') {
          if (piece.side === 'sente' && row <= 1) {
            addIssue(issues, 'error', '先手の桂が一・二段目にあります');
          }
          if (piece.side === 'gote' && row >= 7) {
            addIssue(issues, 'error', '後手の桂が八・九段目にあります');
          }
        }
      }
    }
  }

  for (const type of HAND_PIECE_TYPES) {
    counts[type] += state.senteHand[type] + state.goteHand[type];
  }

  if (kingCount.sente !== 1) {
    addIssue(issues, 'error', `先手玉が${kingCount.sente}枚です`);
  }
  if (kingCount.gote !== 1) {
    addIssue(issues, 'error', `後手玉が${kingCount.gote}枚です`);
  }

  (Object.keys(TOTAL_PIECES) as PieceType[]).forEach((type) => {
    const expected = TOTAL_PIECES[type];
    const actual = counts[type];
    const label = PIECE_KANJI[type];
    if (actual > expected) {
      addIssue(issues, 'error', `${label}が${actual - expected}枚多いです`);
    } else if (actual < expected) {
      addIssue(issues, 'warning', `${label}が${expected - actual}枚不足しています`);
    }
  });

  (['sente', 'gote'] as Side[]).forEach((side) => {
    unpromotedPawnsByFile[side].forEach((count, col) => {
      if (count >= 2) {
        const file = 9 - col;
        addIssue(issues, 'error', `${SIDE_LABEL[side]}の${file}筋が二歩です`);
      }
    });
  });

  const senteKing = findKing(state.board, 'sente');
  const goteKing = findKing(state.board, 'gote');
  if (senteKing && goteKing) {
    const adjacent =
      Math.abs(senteKing.row - goteKing.row) <= 1 &&
      Math.abs(senteKing.col - goteKing.col) <= 1;
    if (adjacent) {
      addIssue(issues, 'error', '先手玉と後手玉が隣接しています');
    }

    const senteInCheck = isSquareAttacked(state.board, senteKing, 'gote');
    const goteInCheck = isSquareAttacked(state.board, goteKing, 'sente');
    if (senteInCheck && goteInCheck) {
      addIssue(issues, 'error', '両方の玉に同時に王手がかかっています');
    }

    const previousSide: Side = state.sideToMove === 'sente' ? 'gote' : 'sente';
    const previousKing = previousSide === 'sente' ? senteKing : goteKing;
    const attacker: Side = previousSide === 'sente' ? 'gote' : 'sente';
    const previousKingInCheck = isSquareAttacked(state.board, previousKing, attacker);
    if (previousKingInCheck) {
      addIssue(
        issues,
        'error',
        `手番ではない${SIDE_LABEL[previousSide]}玉に王手がかかっています`,
      );
    }
  }

  return issues;
}

export function hasBlockingPositionIssue(issues: PositionIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
