import React from 'react';
import NewModeTagSelector from './NewModeTagSelector';
import TagSelector from './TagSelector';
import type { PasteSaveMode } from '../lib/paste-save-mode';

interface WorkspaceKifPasteBoxProps {
  pasteText: string;
  pasteError: string;
  pasteTags: string[];
  pasteSaveMode: PasteSaveMode;
  parsedBranchCount: number;
  creating: boolean;
  savingBranches: boolean;
  onPasteTextChange: (text: string) => void;
  onParsedPaste: (text: string) => void;
  onPasteErrorClear: () => void;
  onTagsChange: (tags: string[]) => void;
  onModeChange: (mode: PasteSaveMode) => void;
  onPasteFromClipboard: () => void;
  onSave: () => void;
  onSaveAllBranches: () => void;
  onClear: () => void;
}

export default function WorkspaceKifPasteBox({
  pasteText,
  pasteError,
  pasteTags,
  pasteSaveMode,
  parsedBranchCount,
  creating,
  savingBranches,
  onPasteTextChange,
  onParsedPaste,
  onPasteErrorClear,
  onTagsChange,
  onModeChange,
  onPasteFromClipboard,
  onSave,
  onSaveAllBranches,
  onClear,
}: WorkspaceKifPasteBoxProps) {
  const hasPasteContent = pasteText.trim().length > 0;

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    onPasteTextChange(event.target.value);
    onPasteErrorClear();
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text/plain');
    if (!pasted) return;
    event.preventDefault();
    onPasteTextChange(pasted);
    onParsedPaste(pasted);
  };

  return (
    <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
      <textarea
        className="w-full rounded border border-gray-300 p-2 font-mono text-[11px] leading-tight"
        rows={6}
        placeholder="KIF棋譜 / SFEN を貼り付け"
        value={pasteText}
        onChange={handleTextChange}
        onPaste={handlePaste}
      />
      {pasteError && (
        <div
          className={
            pasteError.startsWith('✓')
              ? 'mt-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700'
              : 'mt-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600'
          }
        >
          {pasteError}
        </div>
      )}
      <div className="mt-1 flex gap-1">
        <button
          type="button"
          onClick={onPasteFromClipboard}
          className="rounded border border-blue-300 bg-blue-100 px-2 py-0.5 text-[11px] hover:bg-blue-200"
        >
          📋 貼り付け
        </button>
      </div>
      {hasPasteContent && (
        <>
          <div className="mt-2">
            {pasteSaveMode === 'new_mode' ? (
              <NewModeTagSelector selected={pasteTags} onChange={onTagsChange} />
            ) : (
              <TagSelector selected={pasteTags} onChange={onTagsChange} />
            )}
          </div>
          <div className="mt-2 flex items-center gap-3 text-[13px]">
            <SaveModeRadio
              id="saveMode-next"
              label="次の一手"
              mode="next_move"
              selectedMode={pasteSaveMode}
              onChange={onModeChange}
            />
            <SaveModeRadio
              id="saveMode-joseki"
              label="定跡"
              mode="joseki"
              selectedMode={pasteSaveMode}
              onChange={onModeChange}
            />
            <SaveModeRadio
              id="saveMode-new"
              label="新モード"
              mode="new_mode"
              selectedMode={pasteSaveMode}
              onChange={onModeChange}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {parsedBranchCount > 0 && (
              <button
                type="button"
                onClick={onSaveAllBranches}
                disabled={creating || savingBranches}
                className="rounded border-emerald-600 bg-emerald-600 px-3 py-1 text-[12px] text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {savingBranches ? '保存中...' : `🌳 分岐（${parsedBranchCount}個） 全てを保存する`}
              </button>
            )}
            <button
              type="button"
              onClick={onSave}
              disabled={creating || savingBranches}
              className="rounded border-blue-600 bg-blue-600 px-3 py-1 text-[12px] text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? '保存中...' : '保存'}
            </button>
            <button type="button" onClick={onClear} className="px-3 py-1 text-[12px]">
              クリア
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SaveModeRadio({
  id,
  label,
  mode,
  selectedMode,
  onChange,
}: {
  id: string;
  label: string;
  mode: PasteSaveMode;
  selectedMode: PasteSaveMode;
  onChange: (mode: PasteSaveMode) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        id={id}
        type="radio"
        name="saveMode"
        value={mode}
        checked={selectedMode === mode}
        onChange={() => onChange(mode)}
        className="mr-1"
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
