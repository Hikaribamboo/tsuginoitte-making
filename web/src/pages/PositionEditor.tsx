import React, { useState, useCallback, useMemo } from 'react';
import Board from '../components/Board';
import type { ArrowInfo } from '../components/Board';
import TagSelector from '../components/TagSelector';
import AnalysisPanel from '../components/AnalysisPanel';
import type { BestMove } from '../components/AnalysisPanel';
import { useBoardStore } from '../hooks/useBoardStore';
import { createFavorite, updateFavorite } from '../api/favorites';
import { toUsiSquare, parseSfen, applyUsiMove } from '../lib/sfen';
import { usiToLabel } from '../lib/usi-to-label';
import { getValidDestinations, getValidDropSquares } from '../lib/legal-moves';
import type { HandPieceType, PieceType, Side } from '../types/shogi';
import { CAN_PROMOTE, pieceKanji } from '../types/shogi';

interface PositionEditorProps {
  editId?: number;
  initialTags?: string[];
  initialSfen?: string;
  onSaved?: () => void;
}

const PositionEditor: React.FC<PositionEditorProps> = ({
  editId,
  initialTags = [],
  initialSfen,
  onSaved,
}) => {
  const store = useBoardStore();
  const [tags, setTags] = useState<string[]>(initialTags);
  const [sfenInput, setSfenInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [promotionChoice, setPromotionChoice] = useState<{
    fromSq: string;
    toSq: string;
    pieceType: PieceType;
  } | null>(null);
  const [candidateMoves, setCandidateMoves] = useState<BestMove[]>([]);

  const handleCandidateMoves = useCallback((moves: BestMove[]) => {
    setCandidateMoves(moves.slice(0, 3));
  }, []);

  const arrows: ArrowInfo[] = candidateMoves
    .filter((m) => m.from !== null)
    .slice(0, 3)
    .map((m, idx) => ({
      from: m.from,
      to: m.to,
      style: idx === 0 ? 'primary' : idx === 1 ? 'secondary' : 'tertiary',
      showNextLabel: idx === 1,
    }));

  React.useEffect(() => {
    if (initialSfen) {
      store.loadFromSfen(initialSfen);
    } else {
      store.resetToInitial();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentSfen = store.getSfen();

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      const { selectedCell, selectedHandPiece, board, sideToMove } = store;

      // If promotion choice is pending, ignore board clicks
      if (promotionChoice) return;

      // If a hand piece is selected, try to drop it
      if (selectedHandPiece) {
        const validDrops = getValidDropSquares(board, sideToMove, selectedHandPiece.type);
        if (!validDrops.some(s => s.row === row && s.col === col)) {
          const piece = board[row][col];
          if (piece && piece.side === sideToMove) {
            store.clearSelection();
            store.selectCell(row, col);
          }
          return;
        }
        const usi = `${selectedHandPiece.type}*${toUsiSquare(row, col)}`;
        store.applyMove(usi);
        return;
      }

      // If no cell selected, select a cell with a piece of the current side
      if (!selectedCell) {
        const piece = board[row][col];
        if (piece && piece.side === sideToMove) {
          store.selectCell(row, col);
        }
        return;
      }

      // Clicking the same cell again deselects
      if (selectedCell.row === row && selectedCell.col === col) {
        store.clearSelection();
        return;
      }

      // Clicking another own piece re-selects
      const targetPiece = board[row][col];
      if (targetPiece && targetPiece.side === sideToMove) {
        store.selectCell(row, col);
        return;
      }

      // Validate the move against legal destinations
      const validMoves = getValidDestinations(board, selectedCell.row, selectedCell.col, sideToMove);
      if (!validMoves.some(s => s.row === row && s.col === col)) {
        return;
      }

      // Build USI move
      const fromSq = toUsiSquare(selectedCell.row, selectedCell.col);
      const toSq = toUsiSquare(row, col);
      const piece = board[selectedCell.row][selectedCell.col];

      if (piece && !piece.promoted && CAN_PROMOTE[piece.type]) {
        const inPromotionZone =
          (sideToMove === 'sente' && (row <= 2 || selectedCell.row <= 2)) ||
          (sideToMove === 'gote' && (row >= 6 || selectedCell.row >= 6));
        if (inPromotionZone) {
          const mustPromote =
            (piece.type === 'P' && ((sideToMove === 'sente' && row === 0) || (sideToMove === 'gote' && row === 8))) ||
            (piece.type === 'L' && ((sideToMove === 'sente' && row === 0) || (sideToMove === 'gote' && row === 8))) ||
            (piece.type === 'N' && ((sideToMove === 'sente' && row <= 1) || (sideToMove === 'gote' && row >= 7)));
          if (mustPromote) {
            store.applyMove(`${fromSq}${toSq}+`);
          } else {
            setPromotionChoice({ fromSq, toSq, pieceType: piece.type });
          }
          return;
        }
      }

      store.applyMove(`${fromSq}${toSq}`);
    },
    [store, promotionChoice],
  );

  const handlePromotionSelect = useCallback(
    (promote: boolean) => {
      if (!promotionChoice) return;
      const usi = `${promotionChoice.fromSq}${promotionChoice.toSq}${promote ? '+' : ''}`;
      store.applyMove(usi);
      setPromotionChoice(null);
    },
    [store, promotionChoice],
  );

  const handleHandPieceClick = useCallback(
    (side: Side, type: HandPieceType) => {
      if (side !== store.sideToMove) return;
      const { selectedHandPiece } = store;
      if (selectedHandPiece?.side === side && selectedHandPiece?.type === type) {
        store.clearSelection();
      } else {
        store.selectHandPiece(side, type);
      }
    },
    [store],
  );

  const handleLoadSfen = () => {
    const input = sfenInput.trim();
    if (!input) return;

    // Parse "position sfen <sfen> moves <m1> <m2> ..." format
    const posMatch = input.match(/^position\s+sfen\s+(.+?)\s+moves\s+(.+)$/);
    if (posMatch) {
      const sfen = posMatch[1].trim();
      const moves = posMatch[2].trim().split(/\s+/);
      store.loadFromSfen(sfen);
      for (const m of moves) {
        store.applyMove(m);
      }
    } else {
      // Strip leading "position sfen " if present
      const cleaned = input.replace(/^position\s+sfen\s+/, '');
      store.loadFromSfen(cleaned);
    }
    setSfenInput('');
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        name: `局面_${new Date().toLocaleString('ja-JP')}`,
        root_sfen: currentSfen,
        memo: null,
        tags: tags.length > 0 ? tags : null,
        last_move: store.moveHistory.length > 0 ? store.moveHistory[store.moveHistory.length - 1] : null,
      };
      if (editId) {
        await updateFavorite(editId, payload);
        setMessage('更新しました');
      } else {
        await createFavorite(payload);
        setMessage('保存しました');
      }
      onSaved?.();
    } catch (e: any) {
      setMessage(`エラー: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCopySfen = () => {
    navigator.clipboard.writeText(currentSfen);
    setMessage('SFENをコピーしました');
    setTimeout(() => setMessage(''), 2000);
  };

  const nodeLabelMap = useMemo(() => {
    const labels: Record<string, string> = {
      [store.rootNodeId]: '開始局面',
    };

    const root = parseSfen(store.baseSfen);

    const walk = (
      nodeId: string,
      board: ReturnType<typeof parseSfen>['board'],
      senteHand: ReturnType<typeof parseSfen>['senteHand'],
      goteHand: ReturnType<typeof parseSfen>['goteHand'],
      sideToMove: ReturnType<typeof parseSfen>['sideToMove'],
    ) => {
      const node = store.moveTree[nodeId];
      if (!node) return;

      for (const childId of node.children) {
        const child = store.moveTree[childId];
        if (!child?.move) continue;

        labels[childId] = usiToLabel(child.move, board, sideToMove);
        const result = applyUsiMove(board, senteHand, goteHand, sideToMove, child.move);
        const nextSide: Side = sideToMove === 'sente' ? 'gote' : 'sente';
        walk(childId, result.board, result.senteHand, result.goteHand, nextSide);
      }
    };

    walk(store.rootNodeId, root.board, root.senteHand, root.goteHand, root.sideToMove);
    return labels;
  }, [store.baseSfen, store.moveTree, store.rootNodeId]);

  const renderTree = useCallback((nodeId: string, hasParent = false, isLast = true): React.ReactNode => {
    const node = store.moveTree[nodeId];
    if (!node) return null;

    const isCurrent = nodeId === store.currentNodeId;
    const title = nodeLabelMap[nodeId] ?? (node.move ?? '開始局面');

    return (
      <div key={nodeId} className="relative flex flex-col gap-1">
        {hasParent && (
          <>
            <span className="absolute left-0 top-3 w-2 border-t border-slate-300" />
            <span className={`absolute left-0 border-l border-slate-300 ${isLast ? 'top-0 h-3' : 'top-0 bottom-0'}`} />
          </>
        )}
        <button
          type="button"
          className={`ml-3 w-[80px] text-left text-[11px] px-1.5 py-0.5 rounded border leading-tight truncate ${isCurrent ? 'bg-sky-100 border-sky-400 text-sky-900' : 'bg-white border-gray-200 text-gray-700'}`}
          onClick={() => store.jumpToNode(nodeId)}
          title={title}
        >
          {title}
        </button>
        {node.children.length > 0 && (
          <div className="ml-3 pl-2 border-l border-slate-200/80 flex flex-col gap-1">
            {node.children.map((childId, idx) => renderTree(childId, true, idx === node.children.length - 1))}
          </div>
        )}
      </div>
    );
  }, [store, nodeLabelMap]);

  return (
    <div className="flex gap-6 items-start">
      <div className="flex flex-col gap-2 flex-shrink-0">
        <div className="flex-shrink-0">
          <Board
            board={store.board}
            senteHand={store.senteHand}
            goteHand={store.goteHand}
            sideToMove={store.sideToMove}
            selectedCell={store.selectedCell}
            arrows={arrows}
            onCellClick={handleCellClick}
            onHandPieceClick={handleHandPieceClick}
          />
        </div>

        <div className="flex gap-4 text-[13px] text-gray-500">
          <span>手番: {store.sideToMove === 'sente' ? '☗先手' : '☖後手'}</span>
          <span>手数: {store.moveNumber}</span>
          {store.selectedHandPiece && (
            <span className="text-blue-600 font-semibold">
              打: {store.selectedHandPiece.type}
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={() => store.undoMove()} disabled={store.moveHistory.length === 0}>
            ↩ 一手戻す
          </button>
          <button onClick={() => store.redoMove()} disabled={!store.canRedo()}>
            ↪ 一手進める
          </button>
          <button onClick={() => store.resetToInitial()}>初期配置に戻す</button>
        </div>

        {promotionChoice && (
          <div className="flex items-center gap-2.5 px-3 py-2 bg-amber-50 border-2 border-amber-400 rounded-md text-[13px] font-semibold">
            <span>成りますか？</span>
            <button
              className="w-12 h-12 text-2xl font-bold flex items-center justify-center border-2 border-gray-300 rounded bg-white cursor-pointer hover:border-blue-600 hover:bg-blue-100"
              onClick={() => handlePromotionSelect(false)}
            >
              {pieceKanji({ type: promotionChoice.pieceType, side: store.sideToMove, promoted: false })}
            </button>
            <button
              className="w-12 h-12 text-2xl font-bold flex items-center justify-center border-2 border-gray-300 rounded bg-white cursor-pointer hover:border-blue-600 hover:bg-blue-100 text-red-700"
              onClick={() => handlePromotionSelect(true)}
            >
              {pieceKanji({ type: promotionChoice.pieceType, side: store.sideToMove, promoted: true })}
            </button>
          </div>
        )}

        <AnalysisPanel sfen={currentSfen} onCandidateMoves={handleCandidateMoves} />
      </div>

      <div className="flex-1 basis-[620px] max-w-[820px] min-w-[420px] flex flex-col gap-3">
        <div className="self-start w-[820px] flex flex-col gap-1 p-1.5 bg-white/80 border border-gray-200 rounded">
          <div className="text-[11px] font-semibold text-gray-500">手順ツリー</div>
          <div className="h-[120px] overflow-auto">
            <div className="flex flex-col gap-1 pr-1">
              {renderTree(store.rootNodeId)}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="text-[13px] font-semibold text-gray-500">SFEN</div>
          <div className="font-mono text-xs p-2 bg-white border border-gray-200 rounded break-all cursor-pointer hover:bg-gray-100" onClick={handleCopySfen} title="クリックでコピー">
            {currentSfen}
          </div>
          <div className="flex gap-1">
            <input
              type="text"
              placeholder="SFEN or position sfen ... moves ..."
              value={sfenInput}
              onChange={(e) => setSfenInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoadSfen()}
            />
            <button onClick={handleLoadSfen}>読み込み</button>
          </div>
        </div>

        <hr />

        <div className="flex flex-col gap-1.5">
          <div className="text-[13px] font-semibold text-gray-500">お気に入り保存</div>
          <TagSelector selected={tags} onChange={setTags} />
          <button
            className="w-full py-2 text-sm bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '保存中...' : editId ? '更新' : 'お気に入り保存'}
          </button>
        </div>

        {message && <div className="p-2 bg-emerald-50 border border-emerald-300 rounded text-[13px] text-emerald-800">{message}</div>}
      </div>
    </div>
  );
};

export default PositionEditor;
