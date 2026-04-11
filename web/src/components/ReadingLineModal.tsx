import React, { useState, useMemo } from 'react';
import Board from './Board';
import { parseSfen, applyUsiMove } from '../lib/sfen';
import { pvToJapanese } from '../lib/usi-to-label';
import type { Board as BoardType, HandPieces, Side } from '../types/shogi';

interface ReadingLineModalProps {
  rootSfen: string;
  line: string[];
  onClose: () => void;
}

const ReadingLineModal: React.FC<ReadingLineModalProps> = ({ rootSfen, line, onClose }) => {
  const [step, setStep] = useState(0);
  const labels = useMemo(() => pvToJapanese(line, rootSfen, line.length), [line, rootSfen]);

  const position = useMemo(() => {
    const state = parseSfen(rootSfen);
    let { board, senteHand, goteHand, sideToMove } = state;
    for (let i = 0; i < step && i < line.length; i++) {
      const result = applyUsiMove(board, senteHand, goteHand, sideToMove, line[i]);
      board = result.board;
      senteHand = result.senteHand;
      goteHand = result.goteHand;
      sideToMove = sideToMove === 'sente' ? 'gote' : 'sente';
    }
    return { board, senteHand, goteHand, sideToMove };
  }, [rootSfen, line, step]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl p-6 max-w-[750px] max-h-[90vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold">読み筋再生</h3>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 border-0 bg-transparent text-xl leading-none px-2 py-0.5"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="flex justify-center">
          <Board
            board={position.board}
            senteHand={position.senteHand}
            goteHand={position.goteHand}
            sideToMove={position.sideToMove}
          />
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-center gap-2 mt-3">
          <button
            onClick={() => setStep(0)}
            disabled={step === 0}
            className="text-xs"
          >
            |◀ 最初
          </button>
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="text-xs"
          >
            ◀ 戻る
          </button>
          <span className="text-sm font-mono mx-2">
            {step} / {line.length}
          </span>
          <button
            onClick={() => setStep(Math.min(line.length, step + 1))}
            disabled={step >= line.length}
            className="text-xs"
          >
            進む ▶
          </button>
          <button
            onClick={() => setStep(line.length)}
            disabled={step >= line.length}
            className="text-xs"
          >
            最後 ▶|
          </button>
        </div>

        {/* Move list */}
        <div className="mt-2 flex flex-wrap gap-1 max-h-[120px] overflow-y-auto text-[12px]">
          {labels.map((label, i) => (
            <span
              key={i}
              className={`px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                i < step
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-gray-100 text-gray-500'
              } ${i === step - 1 ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => setStep(i + 1)}
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
