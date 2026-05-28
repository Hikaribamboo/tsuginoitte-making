import React from 'react';

interface PasteIntroMoveCardProps {
  draftUsi: string;
  draftLabel: string;
  isActive: boolean;
  error?: string;
  onActivate: () => void;
  onClear: () => void;
}

const PasteIntroMoveCard: React.FC<PasteIntroMoveCardProps> = ({
  draftUsi,
  draftLabel,
  isActive,
  error = '',
  onActivate,
  onClear,
}) => {
  return (
    <div
      className={`border-2 rounded-md px-3 py-2 bg-white transition-colors w-full max-w-[420px] ${
        isActive ? 'border-blue-600 bg-[#f8faff]' : draftUsi ? 'border-emerald-300' : 'border-gray-200'
      }`}
    >
      <div className="flex justify-between items-center mb-1">
        <span className="font-semibold text-sm">⏩ イントロムーブ</span>
        {draftUsi && (
          <button
            className="text-[11px] px-1.5 py-0.5 text-red-600 border-red-300 hover:bg-red-50"
            onClick={onClear}
            type="button"
          >
            クリア
          </button>
        )}
      </div>

      {draftUsi ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[26px] font-bold leading-none flex-shrink-0">{draftLabel || draftUsi}</span>
            <span className="font-mono text-[9px] text-gray-400 flex-shrink-0">({draftUsi})</span>
          </div>
          {!isActive && (
            <button className="mt-1 text-xs" onClick={onActivate} type="button">
              この枠を選択
            </button>
          )}
          {isActive && (
            <div className="text-blue-600 text-[13px] font-medium py-1 animate-pulse">
              「行き先→元のマス/持ち駒」の順に指してください...
            </div>
          )}
          {error && (
            <div className="text-[11px] text-red-600 bg-red-50 px-2 py-0.5 rounded">
              {error}
            </div>
          )}
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
              「行き先→元のマス/持ち駒」の順に指してください...
            </div>
          )}
          {error && (
            <div className="text-[11px] text-red-600 bg-red-50 px-2 py-0.5 rounded">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PasteIntroMoveCard;
