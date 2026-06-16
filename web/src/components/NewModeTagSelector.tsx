import React, { useMemo, useState } from 'react';
import { getNewModeKnownTags, rememberNewModeTags } from '../lib/new-mode-tags';

interface NewModeTagSelectorProps {
  selected: string[];
  onChange: (tags: string[]) => void;
}

function normalizeTag(raw: string): string {
  return raw.trim();
}

const NewModeTagSelector: React.FC<NewModeTagSelectorProps> = ({ selected, onChange }) => {
  const [knownTags, setKnownTags] = useState<string[]>(() => getNewModeKnownTags());
  const [draft, setDraft] = useState('');
  const query = draft.trim().toLowerCase();

  const candidates = useMemo(() => {
    if (!query) return [];
    return knownTags
      .filter((tag) => !selected.includes(tag))
      .filter((tag) => tag.toLowerCase().includes(query))
      .slice(0, 20);
  }, [knownTags, query, selected]);

  const addTag = (raw: string) => {
    const tag = normalizeTag(raw);
    if (!tag) return;

    const nextKnownTags = rememberNewModeTags([tag]);
    setKnownTags(nextKnownTags);
    if (!selected.includes(tag)) {
      onChange([...selected, tag]);
    }
    setDraft('');
  };

  const removeTag = (tag: string) => {
    onChange(selected.filter((item) => item !== tag));
  };

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2">
      <div className="text-sm font-semibold text-slate-900">新モードタグ</div>

      <div className="flex min-w-0 max-w-full flex-wrap gap-1">
        {selected.length === 0 ? (
          <span className="rounded-lg border border-sky-100 bg-white/70 px-2 py-1 text-[11px] text-slate-400">
            選択タグなし
          </span>
        ) : (
          selected.map((tag) => (
            <button
              key={tag}
              type="button"
              className="rounded-full border border-sky-500 bg-sky-500 px-2.5 py-0.5 text-[11px] text-white"
              onClick={() => removeTag(tag)}
              title="クリックで削除"
            >
              {tag} ×
            </button>
          ))
        )}
      </div>

      <input
        className="h-9 rounded-lg border border-sky-200 bg-white/90 px-3 text-[13px]"
        value={draft}
        placeholder="タグを検索・新規作成"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            if (candidates.length === 0) addTag(draft);
          }
        }}
      />

      {query ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
          <div className="mb-1 text-xs text-slate-500">候補</div>
          <div className="flex flex-wrap gap-1">
            {candidates.length > 0 ? (
              candidates.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="rounded border border-slate-300 bg-white px-2 py-[2px] text-xs text-slate-700 hover:bg-slate-100"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addTag(tag)}
                >
                  {tag}
                </button>
              ))
            ) : (
              <button
                type="button"
                className="rounded border border-emerald-300 bg-emerald-50 px-2 py-[2px] text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addTag(draft)}
              >
                「{draft.trim()}」を新規タグとして作成
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-slate-400">
          入力すると、アプリ側で作成済みの新モードタグだけを検索します。
        </div>
      )}
    </div>
  );
};

export default NewModeTagSelector;
