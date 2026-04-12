import React from 'react';
import type { ChoiceDraft } from '../types/problem';

interface PasteChoiceCardProps {
  slot: 'correct' | 'incorrect1' | 'incorrect2';
  draft: ChoiceDraft;
  isActive: boolean;
  readingLineInput: string;
  readingLineError: string;
  onActivate: () => void;
  onReadingLineChange: (text: string) => void;
  onPasteReadingLine: (text: string) => void;
  onEvalCpChange: (value: number | null) => void;
  onEvalPercentChange: (value: number | null) => void;
  onRecalculatePercent: () => void;
  onExplanationChange: (text: string) => void;
  onClear: () => void;
  onShowReplay: () => void;
}

const SLOT_LABELS: Record<string, string> = {
  correct: '✅ 正解手',
  incorrect1: '❌ 不正解手１',
  incorrect2: '❌ 不正解手２',
};

const PasteChoiceCard: React.FC<PasteChoiceCardProps> = ({
  slot,
  draft,
  isActive,
  readingLineInput,
  readingLineError,
  onActivate,
  onReadingLineChange,
  onPasteReadingLine,
  onEvalCpChange,
  onEvalPercentChange,
  onRecalculatePercent,
  onExplanationChange,
  onClear,
  onShowReplay,
}) => {
  return (
    <div
      className={`border-2 rounded-md px-3 py-2 bg-white transition-colors w-full max-w-[420px] ${
        isActive ? 'border-blue-600 bg-[#f8faff]' : draft.usi ? 'border-emerald-300' : 'border-gray-200'
      }`}
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-1">
        <span className="font-semibold text-sm">{SLOT_LABELS[slot]}</span>
        {draft.usi && (
          <button
            className="text-[11px] px-1.5 py-0.5 text-red-600 border-red-300 hover:bg-red-50"
            onClick={onClear}
            type="button"
          >
            クリア
          </button>
        )}
      </div>

      {/* Reading-line paste area */}
      <div className="flex flex-col gap-1">
        <textarea
          className="text-[11px] leading-tight font-mono"
          rows={1}
          placeholder="*検討 ... 評価値 -7 読み筋 △８四歩(83) ▲７八金(69) ..."
          value={readingLineInput}
          onChange={(e) => onReadingLineChange(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text/plain');
            if (pasted) {
              e.preventDefault();
              onReadingLineChange(pasted);
              onPasteReadingLine(pasted);
            }
          }}
        />
        <div className="flex gap-1.5 items-center">
          <button
            className="text-[11px] px-2 py-0.5 bg-gray-100 border-gray-300 hover:bg-gray-200"
            type="button"
            onClick={() => onPasteReadingLine(readingLineInput)}
          >
            読み筋を解析
          </button>
          {draft.usi && (
            <button
              className="text-[11px] px-2 py-0.5 bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
              type="button"
              onClick={onShowReplay}
            >
              ▶ 再生
            </button>
          )}
        </div>
        {readingLineError && (
          <div className="text-[11px] text-red-600 bg-red-50 px-2 py-0.5 rounded">
            {readingLineError}
          </div>
        )}
      </div>

      {/* Parsed choice display */}
      {draft.usi ? (
        <div className="flex flex-col gap-1 mt-1">
          {/* Move title + eval values in one row */}
          <div className="flex items-center gap-1.5">
            <span className="text-[26px] font-bold leading-none flex-shrink-0">{draft.label}</span>
            <span className="font-mono text-[9px] text-gray-400 flex-shrink-0">({draft.usi})</span>
            <div className="flex items-center gap-0.5 ml-auto flex-shrink-0">
              <input
                type="number"
                value={draft.eval_cp ?? ''}
                onChange={(e) =>
                  onEvalCpChange(e.target.value ? parseInt(e.target.value, 10) : null)
                }
                placeholder="cp"
                className="h-6 !w-[82px] text-[10px] px-1 flex-shrink-0"
                title="評価値 cp"
              />
              <input
                type="number"
                min={0}
                max={100}
                value={draft.eval_percent ?? ''}
                onChange={(e) =>
                  onEvalPercentChange(e.target.value ? parseInt(e.target.value, 10) : null)
                }
                placeholder="%"
                className="h-6 !w-[82px] text-[10px] px-1 flex-shrink-0"
                title="勝率 %"
              />
              <button
                className="text-[9px] px-1 py-0.5 bg-teal-700 text-white border-teal-700 hover:bg-teal-800 h-6 whitespace-nowrap"
                type="button"
                onClick={onRecalculatePercent}
                disabled={draft.eval_cp === null}
                title="評価値から勝率%を再計算"
              >
                %
              </button>
            </div>
          </div>

          {/* Explanation */}
          <textarea
            className="leading-tight text-[13px]"
            placeholder="解説を入力..."
            value={draft.explanation}
            onChange={(e) => onExplanationChange(e.target.value)}
            rows={2}
          />
        </div>
      ) : (
        <>
          {!isActive && (
            <button className="mt-1 text-xs" onClick={onActivate} type="button">
              この枠を選択
            </button>
          )}
          {isActive && (
            <div className="text-blue-600 text-[13px] font-medium py-1 animate-pulse">
              盤面で手を指してください...
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PasteChoiceCard;
