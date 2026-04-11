import { create } from 'zustand';
import type { Board, HandPieceType, HandPieces, Side } from '../types/shogi';
import { parseSfen, boardToSfen, applyUsiMove, INITIAL_SFEN } from '../lib/sfen';

const MOVE_TREE_STORAGE_KEY = 'position_editor_move_tree_v1';

interface MoveNode {
  id: string;
  parentId: string | null;
  move: string | null;
  children: string[];
  lastVisitedChildId: string | null;
}

interface PersistedMoveTree {
  version: 1;
  baseSfen: string;
  rootNodeId: string;
  currentNodeId: string;
  nextNodeSeq: number;
  moveTree: Record<string, MoveNode>;
}

interface BoardState {
  // Board data
  board: Board;
  senteHand: HandPieces;
  goteHand: HandPieces;
  sideToMove: Side;
  moveNumber: number;

  // Move history for undo
  moveHistory: string[];
  moveTree: Record<string, MoveNode>;
  rootNodeId: string;
  currentNodeId: string;
  nextNodeSeq: number;
  baseSfen: string;

  // Selected cell / hand piece for move input
  selectedCell: { row: number; col: number } | null;
  selectedHandPiece: { side: Side; type: HandPieceType } | null;

  // Actions
  selectCell: (row: number, col: number) => void;
  selectHandPiece: (side: Side, type: HandPieceType) => void;
  clearSelection: () => void;
  applyMove: (usi: string) => void;
  undoMove: () => void;
  redoMove: () => void;
  canRedo: () => boolean;
  jumpToNode: (nodeId: string) => void;
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

function getNodePathIds(moveTree: Record<string, MoveNode>, nodeId: string): string[] {
  const ids: string[] = [];
  let current: string | null = nodeId;
  while (current) {
    ids.push(current);
    current = moveTree[current]?.parentId ?? null;
  }
  return ids.reverse();
}

function getMovesFromNode(moveTree: Record<string, MoveNode>, rootNodeId: string, nodeId: string): string[] {
  const pathIds = getNodePathIds(moveTree, nodeId);
  return pathIds
    .filter((id) => id !== rootNodeId)
    .map((id) => moveTree[id]?.move)
    .filter((m): m is string => Boolean(m));
}

function persistMoveTree(snapshot: PersistedMoveTree): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MOVE_TREE_STORAGE_KEY, JSON.stringify(snapshot));
}

function loadPersistedMoveTree(): PersistedMoveTree | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(MOVE_TREE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedMoveTree;
    if (parsed?.version !== 1) return null;
    if (!parsed.moveTree || !parsed.rootNodeId || !parsed.currentNodeId) return null;
    if (!parsed.moveTree[parsed.rootNodeId]) return null;
    if (!parsed.moveTree[parsed.currentNodeId]) return null;
    return parsed;
  } catch {
    return null;
  }
}

function createRootState(baseSfen: string) {
  const rootNode: MoveNode = {
    id: 'root',
    parentId: null,
    move: null,
    children: [],
    lastVisitedChildId: null,
  };
  const parsed = parseSfen(baseSfen);
  const moveTree: Record<string, MoveNode> = { root: rootNode };

  return {
    board: parsed.board,
    senteHand: parsed.senteHand,
    goteHand: parsed.goteHand,
    sideToMove: parsed.sideToMove,
    moveNumber: parsed.moveNumber,
    moveHistory: [] as string[],
    moveTree,
    rootNodeId: 'root',
    currentNodeId: 'root',
    nextNodeSeq: 1,
    baseSfen,
  };
}

export const useBoardStore = create<BoardState>((set, get) => {
  const persisted = loadPersistedMoveTree();
  let initialState = createRootState(INITIAL_SFEN);

  if (persisted) {
    const moves = getMovesFromNode(persisted.moveTree, persisted.rootNodeId, persisted.currentNodeId);
    const rebuilt = rebuildFromHistory(persisted.baseSfen, moves);
    initialState = {
      ...initialState,
      ...rebuilt,
      moveHistory: moves,
      moveTree: persisted.moveTree,
      rootNodeId: persisted.rootNodeId,
      currentNodeId: persisted.currentNodeId,
      nextNodeSeq: persisted.nextNodeSeq,
      baseSfen: persisted.baseSfen,
    };
  }

  return {
    board: initialState.board,
    senteHand: initialState.senteHand,
    goteHand: initialState.goteHand,
    sideToMove: initialState.sideToMove,
    moveNumber: initialState.moveNumber,
    moveHistory: initialState.moveHistory,
    moveTree: initialState.moveTree,
    rootNodeId: initialState.rootNodeId,
    currentNodeId: initialState.currentNodeId,
    nextNodeSeq: initialState.nextNodeSeq,
    baseSfen: initialState.baseSfen,
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
        const parentNode = s.moveTree[s.currentNodeId];
        if (!parentNode) return s;

        const existingChildId = parentNode.children.find((cid) => s.moveTree[cid]?.move === usi) ?? null;
        const childId = existingChildId ?? `n${s.nextNodeSeq}`;

        const nextMoveTree: Record<string, MoveNode> = {
          ...s.moveTree,
          [s.currentNodeId]: {
            ...parentNode,
            children: existingChildId ? parentNode.children : [...parentNode.children, childId],
            lastVisitedChildId: childId,
          },
        };

        if (!existingChildId) {
          nextMoveTree[childId] = {
            id: childId,
            parentId: s.currentNodeId,
            move: usi,
            children: [],
            lastVisitedChildId: null,
          };
        }

        const newHistory = getMovesFromNode(nextMoveTree, s.rootNodeId, childId);
        const rebuilt = rebuildFromHistory(s.baseSfen, newHistory);

        persistMoveTree({
          version: 1,
          baseSfen: s.baseSfen,
          rootNodeId: s.rootNodeId,
          currentNodeId: childId,
          nextNodeSeq: existingChildId ? s.nextNodeSeq : s.nextNodeSeq + 1,
          moveTree: nextMoveTree,
        });

        return {
          ...rebuilt,
          moveHistory: newHistory,
          moveTree: nextMoveTree,
          currentNodeId: childId,
          nextNodeSeq: existingChildId ? s.nextNodeSeq : s.nextNodeSeq + 1,
          selectedCell: null,
          selectedHandPiece: null,
        };
      }),

    undoMove: () =>
      set((s) => {
        const current = s.moveTree[s.currentNodeId];
        if (!current || !current.parentId) return s;
        const parentId = current.parentId;
        const newHistory = getMovesFromNode(s.moveTree, s.rootNodeId, parentId);
        const rebuilt = rebuildFromHistory(s.baseSfen, newHistory);

        persistMoveTree({
          version: 1,
          baseSfen: s.baseSfen,
          rootNodeId: s.rootNodeId,
          currentNodeId: parentId,
          nextNodeSeq: s.nextNodeSeq,
          moveTree: s.moveTree,
        });

        return {
          ...rebuilt,
          moveHistory: newHistory,
          currentNodeId: parentId,
          selectedCell: null,
          selectedHandPiece: null,
        };
      }),

    redoMove: () =>
      set((s) => {
        const current = s.moveTree[s.currentNodeId];
        if (!current || current.children.length === 0) return s;
        const childId = (current.lastVisitedChildId && current.children.includes(current.lastVisitedChildId))
          ? current.lastVisitedChildId
          : current.children[current.children.length - 1];
        const newHistory = getMovesFromNode(s.moveTree, s.rootNodeId, childId);
        const rebuilt = rebuildFromHistory(s.baseSfen, newHistory);

        persistMoveTree({
          version: 1,
          baseSfen: s.baseSfen,
          rootNodeId: s.rootNodeId,
          currentNodeId: childId,
          nextNodeSeq: s.nextNodeSeq,
          moveTree: s.moveTree,
        });

        return {
          ...rebuilt,
          moveHistory: newHistory,
          currentNodeId: childId,
          selectedCell: null,
          selectedHandPiece: null,
        };
      }),

    canRedo: () => {
      const s = get();
      const current = s.moveTree[s.currentNodeId];
      return Boolean(current && current.children.length > 0);
    },

    jumpToNode: (nodeId: string) =>
      set((s) => {
        if (!s.moveTree[nodeId]) return s;
        const newHistory = getMovesFromNode(s.moveTree, s.rootNodeId, nodeId);
        const rebuilt = rebuildFromHistory(s.baseSfen, newHistory);

        persistMoveTree({
          version: 1,
          baseSfen: s.baseSfen,
          rootNodeId: s.rootNodeId,
          currentNodeId: nodeId,
          nextNodeSeq: s.nextNodeSeq,
          moveTree: s.moveTree,
        });

        return {
          ...rebuilt,
          moveHistory: newHistory,
          currentNodeId: nodeId,
          selectedCell: null,
          selectedHandPiece: null,
        };
      }),

    loadFromSfen: (sfen: string) => {
      const next = createRootState(sfen);
      persistMoveTree({
        version: 1,
        baseSfen: sfen,
        rootNodeId: next.rootNodeId,
        currentNodeId: next.currentNodeId,
        nextNodeSeq: next.nextNodeSeq,
        moveTree: next.moveTree,
      });
      set({
        board: next.board,
        senteHand: next.senteHand,
        goteHand: next.goteHand,
        sideToMove: next.sideToMove,
        moveNumber: next.moveNumber,
        moveHistory: next.moveHistory,
        moveTree: next.moveTree,
        rootNodeId: next.rootNodeId,
        currentNodeId: next.currentNodeId,
        nextNodeSeq: next.nextNodeSeq,
        baseSfen: next.baseSfen,
        selectedCell: null,
        selectedHandPiece: null,
      });
    },

    resetToInitial: () => {
      const next = createRootState(INITIAL_SFEN);
      persistMoveTree({
        version: 1,
        baseSfen: INITIAL_SFEN,
        rootNodeId: next.rootNodeId,
        currentNodeId: next.currentNodeId,
        nextNodeSeq: next.nextNodeSeq,
        moveTree: next.moveTree,
      });
      set({
        board: next.board,
        senteHand: next.senteHand,
        goteHand: next.goteHand,
        sideToMove: next.sideToMove,
        moveNumber: next.moveNumber,
        moveHistory: next.moveHistory,
        moveTree: next.moveTree,
        rootNodeId: next.rootNodeId,
        currentNodeId: next.currentNodeId,
        nextNodeSeq: next.nextNodeSeq,
        baseSfen: next.baseSfen,
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
