import React from 'react';
import type { ChoiceDraft } from '../types/problem';

interface ChoiceCardProps {
  slot: 'correct' | 'incorrect1' | 'incorrect2';
  draft: ChoiceDraft;
  isActive: boolean;
  isEditing: boolean;
  remoteEditing: boolean;
  onActivate: () => void;
  onEvaluate: () => void;
  evalLoading?: boolean;
  onEvalCpChange: (value: number | null) => void;
  onEvalPercentChange: (value: number | null) => void;
  onExplanationChange: (text: string) => void;
  onExplanationFocus: () => void;
  onExplanationBlur: () => void;
  onClear: () => void;
}

const SLOT_LABELS: Record<string, string> = {
  correct: '✅ 正解手',
  incorrect1: '❌ 不正解手１',
  incorrect2: '❌ 不正解手２',
};

const ChoiceCard: React.FC<ChoiceCardProps> = ({
  slot,
  draft,
  isActive,
  isEditing,
  remoteEditing,
  onActivate,
  onEvaluate,
  evalLoading = false,
  onEvalCpChange,
  onEvalPercentChange,
  onExplanationChange,
  onExplanationFocus,
  onExplanationBlur,
  onClear,
}) => {
  return (
    <div className={`border-2 rounded-md px-3 py-2.5 bg-white transition-colors w-[392px] max-w-full ${isActive ? 'border-blue-600 bg-[#f8faff]' : draft.usi ? 'border-emerald-300' : 'border-gray-200'}`}>
      <div className="flex justify-between items-center mb-1">
        <span className="font-semibold text-sm">
          {SLOT_LABELS[slot]}
          {isEditing && <span className="ml-1.5 text-blue-500" title="自分が編集中">✏️</span>}
          {remoteEditing && !isEditing && <span className="ml-1.5 text-orange-400" title="他のユーザーが編集中">🔒</span>}
        </span>
        {draft.usi && (
          <button className="text-[11px] px-1.5 py-0.5 text-red-600 border-red-300 hover:bg-red-50" onClick={onClear} type="button">
            クリア
          </button>
        )}
      </div>

      {draft.usi ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[30px] font-bold leading-none">{draft.label}</span>
            <span className="font-mono text-[10px] text-gray-400">({draft.usi})</span>
          </div>
          <div className="flex justify-end">
            <button
              className="text-[11px] px-2 py-0.5 bg-teal-700 text-white border-teal-700 hover:bg-teal-800"
              type="button"
              onClick={onEvaluate}
              disabled={evalLoading || !draft.usi}
            >
              {evalLoading ? '計算中...' : 'この候補を評価'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 mt-0.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-gray-500">評価値 cp</span>
              <input
                type="number"
                value={draft.eval_cp ?? ''}
                onChange={(e) => onEvalCpChange(e.target.value ? parseInt(e.target.value, 10) : null)}
                placeholder="例: -260"
                className="h-7"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-gray-500">勝率 %</span>
              <input
                type="number"
                min={0}
                max={100}
                value={draft.eval_percent ?? ''}
                onChange={(e) => onEvalPercentChange(e.target.value ? parseInt(e.target.value, 10) : null)}
                placeholder="例: 61"
                className="h-7"
              />
            </div>
          </div>
          <textarea
            className="mt-0.5 leading-tight"
            placeholder="解説を入力..."
            value={draft.explanation}
            onChange={(e) => onExplanationChange(e.target.value)}
            onFocus={onExplanationFocus}
            onBlur={onExplanationBlur}
            rows={2}
          />
        </div>
      ) : (
        <div className="text-gray-400 text-[12px] py-1.5 cursor-pointer" onClick={onActivate}>
          クリック → 盤面で選択
        </div>
      )}

      {!isActive && !draft.usi && (
        <button className="mt-1 text-xs" onClick={onActivate} type="button">
          この枠を選択
        </button>
      )}
      {isActive && !draft.usi && (
        <div className="text-blue-600 text-[13px] font-medium py-1 animate-pulse">盤面で手を指してください...</div>
      )}
    </div>
  );
};

export default ChoiceCard;
