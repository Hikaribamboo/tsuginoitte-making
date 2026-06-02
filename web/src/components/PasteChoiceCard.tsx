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
  onEvaluate: () => void;
  evalLoading?: boolean;
  evalQueued?: boolean;
  onEvalCpChange: (value: number | null) => void;
  onEvalPercentChange: (value: number | null) => void;
  onRecalculatePercent: () => void;
  onExplanationChange: (text: string) => void;
  onExplanationFocus: () => void;
  onExplanationBlur: () => void;
  explanationRef?: React.Ref<HTMLTextAreaElement>;
  onClear: () => void;
  onShowReplay: () => void;
  replayDisabled?: boolean;
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
  onEvaluate,
  evalLoading = false,
  evalQueued = false,
  onEvalCpChange,
  onEvalPercentChange,
  onRecalculatePercent,
  onExplanationChange,
  onExplanationFocus,
  onExplanationBlur,
  explanationRef,
  onClear,
  onShowReplay,
  replayDisabled = false,
}) => {
  return (
    <div
      className={`w-full rounded-lg border px-3 py-2 shadow-sm backdrop-blur-sm transition-colors ${
        isActive
          ? 'border-sky-500 bg-sky-50/90 ring-2 ring-sky-200'
          : draft.usi
            ? 'border-emerald-200 bg-white/90'
            : 'border-sky-100 bg-white/75'
      }`}
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-1">
        <span className="font-semibold text-sm text-slate-900">{SLOT_LABELS[slot]}</span>
        {draft.usi && (
          <button
            className="rounded-md border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700 hover:bg-rose-100"
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
          className="min-h-[34px] rounded-lg border-sky-200 bg-white/90 text-[11px] leading-tight font-mono"
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
            className="rounded-md border-sky-200 bg-white/90 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-sky-50"
            type="button"
            onClick={() => onPasteReadingLine(readingLineInput)}
          >
            読み筋を解析
          </button>
          {draft.usi && (
            <button
              className={`rounded-md px-2 py-0.5 text-[11px] text-white ${
                replayDisabled ? 'border-indigo-300 bg-indigo-300 cursor-not-allowed' : 'border-indigo-500 bg-indigo-500 hover:bg-indigo-600'
              }`}
              type="button"
              onClick={onShowReplay}
              disabled={replayDisabled}
            >
              ▶ 再生
            </button>
          )}
          {draft.usi && (
            <button
              className={`rounded-md px-2 py-0.5 text-[11px] text-white ${
                evalLoading || evalQueued ? 'border-teal-300 bg-teal-300 cursor-wait' : 'border-teal-600 bg-teal-600 hover:bg-teal-700'
              }`}
              type="button"
              onClick={onEvaluate}
              disabled={evalLoading || evalQueued}
            >
              {evalLoading ? '検討中...' : evalQueued ? '待機中' : '検討'}
            </button>
          )}
        </div>
        {readingLineError && (
          <div className="rounded-md border border-rose-100 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">
            {readingLineError}
          </div>
        )}
      </div>

      {/* Parsed choice display */}
      {draft.usi ? (
        <div className="flex flex-col gap-1 mt-1">
          {/* Move title + eval values in one row */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <div className="min-w-0">
              <span className="break-words text-[26px] font-bold leading-none text-slate-900">{draft.label}</span>
              <span className="ml-1 font-mono text-[9px] text-slate-400">({draft.usi})</span>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={draft.eval_cp ?? ''}
                onChange={(e) =>
                  onEvalCpChange(e.target.value ? parseInt(e.target.value, 10) : null)
                }
                placeholder="cp"
                className="h-7 !w-[78px] rounded-md border-sky-200 bg-white/90 px-1 text-[11px]"
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
                className="h-7 !w-[72px] rounded-md border-sky-200 bg-white/90 px-1 text-[11px]"
                title="勝率 %"
              />
              <button
                className="h-7 rounded-md border-teal-600 bg-teal-600 px-2 py-0.5 text-[10px] text-white hover:bg-teal-700"
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
            className="min-h-[54px] rounded-lg border-sky-200 bg-white/90 text-[13px] leading-tight"
            placeholder="解説を入力..."
            value={draft.explanation}
            onChange={(e) => onExplanationChange(e.target.value)}
            onFocus={onExplanationFocus}
            onBlur={onExplanationBlur}
            ref={explanationRef}
            rows={2}
          />
        </div>
      ) : (
        <>
          {!isActive && (
            <button className="mt-1 h-8 rounded-lg border-sky-200 bg-white/90 text-xs font-semibold text-sky-700 hover:bg-sky-50" onClick={onActivate} type="button">
              この枠を選択
            </button>
          )}
          {isActive && (
            <div className="py-1 text-[13px] font-medium text-sky-700 animate-pulse">
              盤面で手を指してください...
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PasteChoiceCard;
