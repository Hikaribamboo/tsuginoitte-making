import React, { useEffect, useMemo, useState } from 'react';
import { boardToSfen, parseSfen } from '../lib/sfen';
import {
  PIECE_KANJI,
  type Board as BoardType,
  type HandPieces,
  type HandPieceType,
  type PieceType,
  type Side,
} from '../types/shogi';
import {
  cloneBoard,
  cloneHand,
  createFullPieceBox,
  isHandPieceType,
  missingPieceCounts,
  PIECE_TYPES,
  rotatePieceVariant,
  selectionMatchesBoard,
  type PieceSelection,
} from '../lib/position-editor-utils';
import Board from './Board';

export default function PositionEditor({
  rootSfen,
  onChange,
}: {
  rootSfen: string;
  onChange: (nextRootSfen: string) => void;
}) {
  const [selection, setSelection] = useState<PieceSelection | null>(null);

  const parsed = useMemo(() => {
    try {
      return parseSfen(rootSfen);
    } catch {
      return null;
    }
  }, [rootSfen]);

  useEffect(() => {
    setSelection(null);
  }, [rootSfen]);

  const rulePieceBox = useMemo(() => {
    if (!parsed) return createFullPieceBox();
    return missingPieceCounts(parsed.board, parsed.senteHand, parsed.goteHand);
  }, [parsed]);
  const rulePieceBoxTotal = useMemo(
    () => PIECE_TYPES.reduce((total, type) => total + rulePieceBox[type], 0),
    [rulePieceBox],
  );
  const selectedCell =
    selection?.source === 'board' ? { row: selection.row, col: selection.col } : null;
  const selectedHandPiece =
    selection?.source === 'hand' ? { side: selection.side, type: selection.type } : null;
  const selectedBoxType = selection?.source === 'box' ? selection.type : null;

  if (!parsed) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
        root_sfen を解析できないため編集できません。
      </div>
    );
  }

  const commitState = (next: {
    board: BoardType;
    sideToMove: Side;
    senteHand: HandPieces;
    goteHand: HandPieces;
    moveNumber: number;
  }) => {
    onChange(boardToSfen(next.board, next.sideToMove, next.senteHand, next.goteHand, next.moveNumber));
  };

  const updateSideToMove = (sideToMove: Side) => {
    setSelection(null);
    commitState({ ...parsed, sideToMove });
  };

  const removeSelectionFromState = (
    source: PieceSelection,
    board: BoardType,
    senteHand: HandPieces,
    goteHand: HandPieces,
  ) => {
    if (source.source === 'board') {
      board[source.row][source.col] = null;
      return;
    }
    if (source.source === 'hand') {
      const hand = source.side === 'sente' ? senteHand : goteHand;
      hand[source.type] = Math.max(0, hand[source.type] - 1);
    }
  };

  const handleCellClick = (row: number, col: number) => {
    const board = cloneBoard(parsed.board);
    const senteHand = cloneHand(parsed.senteHand);
    const goteHand = cloneHand(parsed.goteHand);

    if (!selection) {
      const piece = board[row][col];
      if (piece) {
        setSelection({ source: 'board', row, col, piece: { ...piece } });
      }
      return;
    }

    if (selectionMatchesBoard(selection, row, col)) {
      setSelection(null);
      return;
    }

    removeSelectionFromState(selection, board, senteHand, goteHand);
    board[row][col] = { ...selection.piece };
    setSelection(null);
    commitState({ ...parsed, board, senteHand, goteHand });
  };

  const handleCellDoubleClick = (row: number, col: number) => {
    const board = cloneBoard(parsed.board);
    const piece = board[row][col];
    if (!piece) return;
    board[row][col] = rotatePieceVariant(piece);
    setSelection(null);
    commitState({ ...parsed, board });
  };

  const handleHandPieceClick = (side: Side, clickedType: HandPieceType) => {
    const board = cloneBoard(parsed.board);
    const senteHand = cloneHand(parsed.senteHand);
    const goteHand = cloneHand(parsed.goteHand);
    const clickedHand = side === 'sente' ? senteHand : goteHand;

    if (!selection) {
      if (clickedHand[clickedType] > 0) {
        setSelection({
          source: 'hand',
          side,
          type: clickedType,
          piece: { type: clickedType, side, promoted: false },
        });
      }
      return;
    }

    if (!isHandPieceType(selection.piece.type)) return;
    if (selection.source === 'hand' && selection.side === side && selection.type === selection.piece.type) {
      setSelection(null);
      return;
    }

    removeSelectionFromState(selection, board, senteHand, goteHand);
    clickedHand[selection.piece.type] = Math.min(99, clickedHand[selection.piece.type] + 1);
    setSelection(null);
    commitState({ ...parsed, board, senteHand, goteHand });
  };

  const handlePieceBoxClick = (type: PieceType) => {
    if (rulePieceBox[type] <= 0) return;
    setSelection({
      source: 'box',
      type,
      piece: { type, side: 'sente', promoted: false },
    });
  };

  const handlePieceBoxReturnClick = () => {
    if (!selection || selection.source === 'box') {
      setSelection(null);
      return;
    }
    const board = cloneBoard(parsed.board);
    const senteHand = cloneHand(parsed.senteHand);
    const goteHand = cloneHand(parsed.goteHand);
    removeSelectionFromState(selection, board, senteHand, goteHand);
    setSelection(null);
    commitState({ ...parsed, board, senteHand, goteHand });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white/85 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[12px] font-semibold text-gray-600">手番</div>
          <div className="grid w-[184px] grid-cols-2 gap-1">
            {([
              ['sente', '先手'],
              ['gote', '後手'],
            ] as const).map(([side, label]) => (
              <button
                key={side}
                type="button"
                onClick={() => updateSideToMove(side)}
                className={`h-8 rounded border text-sm font-semibold ${
                  parsed.sideToMove === side
                    ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Board
          board={parsed.board}
          senteHand={parsed.senteHand}
          goteHand={parsed.goteHand}
          sideToMove={parsed.sideToMove}
          selectedCell={selectedCell}
          selectedHandPiece={selectedHandPiece}
          showAllHandPieces
          onCellClick={handleCellClick}
          onCellDoubleClick={handleCellDoubleClick}
          onHandPieceClick={handleHandPieceClick}
        />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white/85 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[12px] font-semibold text-gray-600">コマ箱</div>
          <div className="text-[12px] text-gray-500">{rulePieceBoxTotal}個</div>
        </div>
        {rulePieceBoxTotal === 0 ? (
          <div
            className="rounded border border-dashed border-gray-200 bg-gray-50 px-2 py-2 text-[12px] text-gray-500"
            onClick={handlePieceBoxReturnClick}
          >
            コマ箱はありません。
          </div>
        ) : (
          <div
            className="grid grid-cols-4 gap-2 sm:grid-cols-8"
            onClick={(event) => {
              if (event.target === event.currentTarget) handlePieceBoxReturnClick();
            }}
          >
            {PIECE_TYPES.filter((type) => rulePieceBox[type] > 0).map((type) => (
              <div
                key={type}
                role="button"
                tabIndex={0}
                onClick={() => handlePieceBoxClick(type)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handlePieceBoxClick(type);
                  }
                }}
                className={`min-h-[56px] cursor-pointer select-none rounded border p-2 text-center hover:bg-amber-100 ${
                  selectedBoxType === type
                    ? 'border-amber-500 bg-amber-200 ring-2 ring-amber-300'
                    : 'border-amber-200 bg-amber-50/80'
                }`}
              >
                <div className="text-[24px] font-bold leading-none text-amber-950">
                  {PIECE_KANJI[type]}
                </div>
                <div className="mt-1 text-[12px] font-semibold text-amber-800">x{rulePieceBox[type]}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
