import React, { useCallback, useMemo, useRef, useState } from 'react';
import { evaluatePosition, type EngineEvalResult } from '../api/backend';
import { getValidDestinations, getValidDropSquares } from '../lib/legal-moves';
import { applyUsiMove, boardToSfen, parseSfen, parseUsiSquare, toUsiSquare } from '../lib/sfen';
import { pvToJapanese } from '../lib/usi-to-label';
import type { HandPieceType, PieceType, Side } from '../types/shogi';
import { CAN_PROMOTE, pieceKanji } from '../types/shogi';
import Board, { type ArrowInfo } from './Board';

interface ReadingLineModalProps {
  rootSfen: string;
  line: string[];
  onClose: () => void;
}

type Cell = { row: number; col: number };
type PromotionChoice = { fromSq: string; toSq: string; pieceType: PieceType };

function sfenAtStep(rootSfen: string, line: string[], step: number): string {
  let state = parseSfen(rootSfen);
  for (let i = 0; i < step && i < line.length; i++) {
    const result = applyUsiMove(state.board, state.senteHand, state.goteHand, state.sideToMove, line[i]);
    const nextSide = state.sideToMove === 'sente' ? 'gote' : 'sente';
    state = {
      ...result,
      sideToMove: nextSide,
      moveNumber: state.moveNumber + 1,
    };
  }
  return boardToSfen(state.board, state.sideToMove, state.senteHand, state.goteHand, state.moveNumber);
}

function applyMoveToSfen(sfen: string, usi: string): string {
  const state = parseSfen(sfen);
  const result = applyUsiMove(state.board, state.senteHand, state.goteHand, state.sideToMove, usi);
  const nextSide = state.sideToMove === 'sente' ? 'gote' : 'sente';
  return boardToSfen(result.board, nextSide, result.senteHand, result.goteHand, state.moveNumber + 1);
}

function moveToArrow(usi: string | undefined): ArrowInfo | null {
  if (!usi || usi === 'resign' || usi === 'win') return null;
  if (usi[1] === '*') {
    return { from: null, to: parseUsiSquare(usi.slice(2, 4)), style: 'primary', showNextLabel: true };
  }
  return {
    from: parseUsiSquare(usi.slice(0, 2)),
    to: parseUsiSquare(usi.slice(2, 4)),
    style: 'primary',
    showNextLabel: true,
  };
}

const ReadingLineModal: React.FC<ReadingLineModalProps> = ({ rootSfen, line, onClose }) => {
  const [step, setStep] = useState(0);
  const [editSfens, setEditSfens] = useState<string[]>([]);
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [selectedHandPiece, setSelectedHandPiece] = useState<{ side: Side; type: HandPieceType } | null>(null);
  const [promotionChoice, setPromotionChoice] = useState<PromotionChoice | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<EngineEvalResult | null>(null);
  const [evaluationError, setEvaluationError] = useState('');
  const evaluationRequestRef = useRef(0);

  const labels = useMemo(() => pvToJapanese(line, rootSfen, line.length), [line, rootSfen]);
  const replaySfen = useMemo(() => sfenAtStep(rootSfen, line, step), [rootSfen, line, step]);
  const currentSfen = editSfens.length > 0 ? editSfens[editSfens.length - 1] : replaySfen;
  const position = useMemo(() => parseSfen(currentSfen), [currentSfen]);
  const evaluationLabels = useMemo(
    () => evaluation ? pvToJapanese(evaluation.pv, currentSfen, 10) : [],
    [evaluation, currentSfen],
  );
  const bestMoveArrow = useMemo(() => moveToArrow(evaluation?.bestmove ?? evaluation?.pv[0]), [evaluation]);

  const clearInteraction = useCallback(() => {
    evaluationRequestRef.current += 1;
    setSelectedCell(null);
    setSelectedHandPiece(null);
    setPromotionChoice(null);
    setEvaluating(false);
    setEvaluation(null);
    setEvaluationError('');
  }, []);

  const navigateToStep = useCallback((nextStep: number) => {
    setStep(Math.max(0, Math.min(line.length, nextStep)));
    setEditSfens([]);
    clearInteraction();
  }, [clearInteraction, line.length]);

  const applyLocalMove = useCallback((usi: string) => {
    const nextSfen = applyMoveToSfen(currentSfen, usi);
    setEditSfens((prev) => [...prev, nextSfen]);
    clearInteraction();
  }, [clearInteraction, currentSfen]);

  const handleCellClick = useCallback((row: number, col: number) => {
    const { board, sideToMove } = position;

    if (selectedHandPiece) {
      const validDrops = getValidDropSquares(board, sideToMove, selectedHandPiece.type);
      if (validDrops.some((square) => square.row === row && square.col === col)) {
        applyLocalMove(`${selectedHandPiece.type}*${toUsiSquare(row, col)}`);
        return;
      }
      const piece = board[row][col];
      setSelectedHandPiece(null);
      setSelectedCell(piece?.side === sideToMove ? { row, col } : null);
      return;
    }

    if (!selectedCell) {
      if (board[row][col]?.side === sideToMove) setSelectedCell({ row, col });
      return;
    }
    if (selectedCell.row === row && selectedCell.col === col) {
      setSelectedCell(null);
      return;
    }
    if (board[row][col]?.side === sideToMove) {
      setSelectedCell({ row, col });
      return;
    }

    const validMoves = getValidDestinations(board, selectedCell.row, selectedCell.col, sideToMove);
    if (!validMoves.some((square) => square.row === row && square.col === col)) return;

    const fromSq = toUsiSquare(selectedCell.row, selectedCell.col);
    const toSq = toUsiSquare(row, col);
    const piece = board[selectedCell.row][selectedCell.col];
    setSelectedCell(null);
    if (!piece) return;

    if (!piece.promoted && CAN_PROMOTE[piece.type]) {
      const inPromotionZone =
        (sideToMove === 'sente' && (row <= 2 || selectedCell.row <= 2)) ||
        (sideToMove === 'gote' && (row >= 6 || selectedCell.row >= 6));
      if (inPromotionZone) {
        const mustPromote =
          ((piece.type === 'P' || piece.type === 'L') && ((sideToMove === 'sente' && row === 0) || (sideToMove === 'gote' && row === 8))) ||
          (piece.type === 'N' && ((sideToMove === 'sente' && row <= 1) || (sideToMove === 'gote' && row >= 7)));
        if (mustPromote) {
          applyLocalMove(`${fromSq}${toSq}+`);
        } else {
          setPromotionChoice({ fromSq, toSq, pieceType: piece.type });
        }
        return;
      }
    }
    applyLocalMove(`${fromSq}${toSq}`);
  }, [applyLocalMove, position, selectedCell, selectedHandPiece]);

  const handleHandPieceClick = useCallback((side: Side, type: HandPieceType) => {
    if (side !== position.sideToMove || position[side === 'sente' ? 'senteHand' : 'goteHand'][type] <= 0) return;
    setSelectedCell(null);
    setSelectedHandPiece((previous) => previous?.side === side && previous.type === type ? null : { side, type });
  }, [position]);

  const handleEvaluate = useCallback(async () => {
    const requestId = evaluationRequestRef.current + 1;
    evaluationRequestRef.current = requestId;
    setEvaluating(true);
    setEvaluation(null);
    setEvaluationError('');
    try {
      const result = await evaluatePosition(currentSfen, [], { multipv: 1 });
      if (evaluationRequestRef.current !== requestId) return;
      setEvaluation(result);
    } catch (error) {
      if (evaluationRequestRef.current !== requestId) return;
      setEvaluationError(error instanceof Error ? error.message : String(error));
    } finally {
      if (evaluationRequestRef.current === requestId) setEvaluating(false);
    }
  }, [currentSfen]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-[980px] max-h-[95vh] overflow-y-auto flex flex-col mx-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold">読み筋再生・局面検討</h3>
            <p className="text-[11px] text-gray-500">この画面で動かした局面は保存されません。</p>
          </div>
          <button type="button" className="text-gray-400 hover:text-gray-600 border-0 bg-transparent text-xl leading-none px-2 py-0.5" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="flex justify-center">
          <Board
            board={position.board}
            senteHand={position.senteHand}
            goteHand={position.goteHand}
            sideToMove={position.sideToMove}
            selectedCell={selectedCell}
            selectedHandPiece={selectedHandPiece}
            arrow={bestMoveArrow}
            onCellClick={handleCellClick}
            onHandPieceClick={handleHandPieceClick}
          />
        </div>

        {promotionChoice && (
          <div className="mt-2 flex items-center justify-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold">
            <span>成りますか？</span>
            <button type="button" onClick={() => applyLocalMove(`${promotionChoice.fromSq}${promotionChoice.toSq}`)}>
              {pieceKanji({ type: promotionChoice.pieceType, side: position.sideToMove, promoted: false })}
            </button>
            <button type="button" className="text-red-700" onClick={() => applyLocalMove(`${promotionChoice.fromSq}${promotionChoice.toSq}+`)}>
              {pieceKanji({ type: promotionChoice.pieceType, side: position.sideToMove, promoted: true })}
            </button>
          </div>
        )}

        <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
          <button onClick={() => navigateToStep(0)} disabled={step === 0 && editSfens.length === 0} className="text-xs">|◀ 最初</button>
          <button
            onClick={() => {
              if (editSfens.length > 0) {
                setEditSfens((prev) => prev.slice(0, -1));
                clearInteraction();
              } else {
                navigateToStep(step - 1);
              }
            }}
            disabled={step === 0 && editSfens.length === 0}
            className="text-xs"
          >
            ◀ 一手戻す
          </button>
          <span className="text-sm font-mono mx-2">{step} / {line.length}{editSfens.length > 0 ? ` ＋検討${editSfens.length}手` : ''}</span>
          <button onClick={() => navigateToStep(step + 1)} disabled={step >= line.length} className="text-xs">進む ▶</button>
          <button onClick={() => navigateToStep(line.length)} disabled={step >= line.length && editSfens.length === 0} className="text-xs">最後 ▶|</button>
          <button
            type="button"
            className="bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 text-xs"
            onClick={() => void handleEvaluate()}
            disabled={evaluating}
          >
            {evaluating ? '検討中...' : '検討 (MP=1)'}
          </button>
        </div>

        {(evaluation || evaluationError) && (
          <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
            {evaluationError ? (
              <div className="text-red-700">{evaluationError}</div>
            ) : evaluation && (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>評価値: <strong>{evaluation.eval_cp}</strong></span>
                <span>最善手: <strong>{evaluationLabels[0] ?? evaluation.bestmove ?? '-'}</strong></span>
                <span className="min-w-0">読み筋: {evaluationLabels.join(' ') || '-'}</span>
              </div>
            )}
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-1 max-h-[120px] overflow-y-auto text-[12px]">
          {labels.map((label, index) => (
            <span
              key={index}
              className={`px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                index < step ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-500'
              } ${index === step - 1 && editSfens.length === 0 ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => navigateToStep(index + 1)}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ReadingLineModal;
