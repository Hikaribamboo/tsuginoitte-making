import { create } from 'zustand';
import type { Board, HandPieceType, HandPieces, Side } from '../types/shogi';
import { parseSfen, boardToSfen, applyUsiMove, INITIAL_SFEN } from '../lib/sfen';

interface BoardState {
  // Board data
  board: Board;
  senteHand: HandPieces;
  goteHand: HandPieces;
  sideToMove: Side;
  moveNumber: number;

  // Move history for undo
  moveHistory: string[];

  // Selected cell / hand piece for move input
  selectedCell: { row: number; col: number } | null;
  selectedHandPiece: { side: Side; type: HandPieceType } | null;

  // Actions
  selectCell: (row: number, col: number) => void;
  selectHandPiece: (side: Side, type: HandPieceType) => void;
  clearSelection: () => void;
  applyMove: (usi: string) => void;
  undoMove: () => void;
  loadFromSfen: (sfen: string) => void;
  resetToInitial: () => void;
  getSfen: () => string;
}

function rebuildFromHistory(baseSfen: string, moves: string[]) {
  const state = parseSfen(baseSfen);
  let { board, senteHand, goteHand, sideToMove, moveNumber } = state;

  for (const usi of moves) {
    const result = applyUsiMove(board, senteHand, goteHand, sideToMove, usi);
    board = result.board;
    senteHand = result.senteHand;
    goteHand = result.goteHand;
    sideToMove = sideToMove === 'sente' ? 'gote' : 'sente';
    moveNumber++;
  }

  return { board, senteHand, goteHand, sideToMove, moveNumber };
}

export const useBoardStore = create<BoardState>((set, get) => {
  const initial = parseSfen(INITIAL_SFEN);

  return {
    board: initial.board,
    senteHand: initial.senteHand,
    goteHand: initial.goteHand,
    sideToMove: initial.sideToMove,
    moveNumber: initial.moveNumber,
    moveHistory: [],
    selectedCell: null,
    selectedHandPiece: null,

    selectCell: (row, col) =>
      set({ selectedCell: { row, col }, selectedHandPiece: null }),

    selectHandPiece: (side, type) =>
      set({ selectedHandPiece: { side, type }, selectedCell: null }),

    clearSelection: () =>
      set({ selectedCell: null, selectedHandPiece: null }),

    applyMove: (usi: string) =>
      set((s) => {
        const result = applyUsiMove(s.board, s.senteHand, s.goteHand, s.sideToMove, usi);
        return {
          board: result.board,
          senteHand: result.senteHand,
          goteHand: result.goteHand,
          sideToMove: s.sideToMove === 'sente' ? 'gote' : 'sente',
          moveNumber: s.moveNumber + 1,
          moveHistory: [...s.moveHistory, usi],
          selectedCell: null,
          selectedHandPiece: null,
        };
      }),

    undoMove: () =>
      set((s) => {
        if (s.moveHistory.length === 0) return s;
        const newHistory = s.moveHistory.slice(0, -1);
        const rebuilt = rebuildFromHistory(INITIAL_SFEN, newHistory);
        return {
          ...rebuilt,
          moveHistory: newHistory,
          selectedCell: null,
          selectedHandPiece: null,
        };
      }),

    loadFromSfen: (sfen: string) => {
      const state = parseSfen(sfen);
      set({
        board: state.board,
        senteHand: state.senteHand,
        goteHand: state.goteHand,
        sideToMove: state.sideToMove,
        moveNumber: state.moveNumber,
        moveHistory: [],
        selectedCell: null,
        selectedHandPiece: null,
      });
    },

    resetToInitial: () => {
      const state = parseSfen(INITIAL_SFEN);
      set({
        board: state.board,
        senteHand: state.senteHand,
        goteHand: state.goteHand,
        sideToMove: state.sideToMove,
        moveNumber: state.moveNumber,
        moveHistory: [],
        selectedCell: null,
        selectedHandPiece: null,
      });
    },

    getSfen: () => {
      const s = get();
      return boardToSfen(s.board, s.sideToMove, s.senteHand, s.goteHand, s.moveNumber);
    },
  };
});
