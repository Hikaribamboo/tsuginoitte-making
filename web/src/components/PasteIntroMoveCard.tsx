import React from 'react';

interface PasteIntroMoveCardProps {
  draftUsi: string;
  draftLabel: string;
  isActive: boolean;
  compact?: boolean;
  error?: string;
  onActivate: () => void;
  onClear: () => void;
}

const PasteIntroMoveCard: React.FC<PasteIntroMoveCardProps> = ({
  draftUsi,
  draftLabel,
  isActive,
  compact = false,
  error = '',
  onActivate,
  onClear,
}) => {
  if (compact) {
    return (
      <div
        className={`w-full rounded-lg border px-3 py-1.5 shadow-sm backdrop-blur-sm transition-colors ${
          isActive
            ? 'border-sky-500 bg-sky-50/90 ring-2 ring-sky-200'
            : draftUsi
              ? 'border-emerald-200 bg-white/90'
              : 'border-sky-100 bg-white/75'
        }`}
      >
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="font-semibold text-[13px] text-slate-900">初手</span>
            {draftUsi && (
              <>
                <span className="ml-2 break-words text-[18px] font-bold leading-none text-slate-900">
                  {draftLabel || draftUsi}
                </span>
                <span className="ml-1 font-mono text-[9px] text-slate-400">({draftUsi})</span>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {draftUsi && (
              <button
                className="rounded-md border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700 hover:bg-rose-100"
                onClick={onClear}
                type="button"
              >
                クリア
              </button>
            )}
            <button
              className="h-7 rounded-lg border-sky-200 bg-white/90 px-2 text-[11px] font-semibold text-sky-700 hover:bg-sky-50"
              onClick={onActivate}
              type="button"
            >
              {isActive ? '選択中' : 'この枠を選択'}
            </button>
          </div>
        </div>
        {isActive && (
          <div className="mt-1 text-[11px] font-medium text-sky-700 animate-pulse">
            「行き先→元のマス/持ち駒」の順に指してください...
          </div>
        )}
        {error && (
          <div className="mt-1 rounded-md border border-rose-100 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`w-full rounded-lg border px-3 py-2 shadow-sm backdrop-blur-sm transition-colors ${
        isActive
          ? 'border-sky-500 bg-sky-50/90 ring-2 ring-sky-200'
          : draftUsi
            ? 'border-emerald-200 bg-white/90'
            : 'border-sky-100 bg-white/75'
      }`}
    >
      <div className="flex justify-between items-center mb-1">
        <span className="font-semibold text-sm text-slate-900">⏩ イントロムーブ</span>
        {draftUsi && (
          <button
            className="rounded-md border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700 hover:bg-rose-100"
            onClick={onClear}
            type="button"
          >
            クリア
          </button>
        )}
      </div>

      {draftUsi ? (
        <div className="flex flex-col gap-1">
          <div className="min-w-0">
            <span className="break-words text-[26px] font-bold leading-none text-slate-900">{draftLabel || draftUsi}</span>
            <span className="ml-1 font-mono text-[9px] text-slate-400">({draftUsi})</span>
          </div>
          {!isActive && (
            <button className="mt-1 h-6 rounded-lg border-sky-200 bg-white/90 text-xs font-semibold text-sky-700 hover:bg-sky-50" onClick={onActivate} type="button">
              この枠を選択
            </button>
          )}
          {isActive && (
            <div className="py-1 text-[13px] font-medium text-sky-700 animate-pulse">
              「行き先→元のマス/持ち駒」の順に指してください...
            </div>
          )}
          {error && (
            <div className="rounded-md border border-rose-100 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">
              {error}
            </div>
          )}
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
              「行き先→元のマス/持ち駒」の順に指してください...
            </div>
          )}
          {error && (
            <div className="rounded-md border border-rose-100 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PasteIntroMoveCard;
