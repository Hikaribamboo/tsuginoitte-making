import React, { useMemo, useState } from 'react';
import { TAG_CATEGORIES } from '../lib/constants';

interface TagSelectorProps {
  selected: string[];
  onChange: (tags: string[]) => void;
  defaultExpanded?: boolean;
}

const TagSelector: React.FC<TagSelectorProps> = ({ selected, onChange, defaultExpanded = false }) => {
  const [collapsed, setCollapsed] = useState(!defaultExpanded);
  const [proTagDraft, setProTagDraft] = useState('');

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((t) => t !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const proGroup = TAG_CATEGORIES.find((g) => g.category === 'プロ戦法');
  const normalGroups = TAG_CATEGORIES.filter((g) => g.category !== 'プロ戦法');
  const selectedProTags = (proGroup?.tags ?? []).filter((t) => selected.includes(t.value));
  const selectedTags = useMemo(
    () => TAG_CATEGORIES.flatMap((group) => group.tags).filter((tag) => selected.includes(tag.value)),
    [selected],
  );

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-900">タグ</div>
        <button
          type="button"
          className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 hover:bg-sky-100"
          onClick={() => setCollapsed((prev) => !prev)}
        >
          {collapsed ? '展開' : '折りたたむ'}
        </button>
      </div>

      <div className="flex min-w-0 max-w-full gap-1 overflow-x-auto whitespace-nowrap pb-1">
        {selectedTags.length > 0 ? (
          selectedTags.map((tag) => (
            <button
              key={tag.value}
              type="button"
              className="shrink-0 rounded-full border border-sky-500 bg-sky-500 px-2.5 py-0.5 text-[11px] text-white"
              onClick={() => toggle(tag.value)}
            >
              {tag.label} ×
            </button>
          ))
        ) : (
          <span className="rounded-lg border border-sky-100 bg-white/70 px-2 py-1 text-[11px] text-slate-400">選択タグなし</span>
        )}
      </div>

      {!collapsed && (
        <div className="flex flex-col gap-1.5 min-w-0 max-w-full">
          {normalGroups.map((group) => (
            <div key={group.category} className="flex flex-col gap-1 min-w-0 max-w-full">
              <div className="text-[11px] font-bold text-slate-600">{group.category}</div>
              <div className="flex flex-wrap gap-1 min-w-0 max-w-full">
                {group.tags.map((tag) => (
                  <button
                    key={tag.value}
                    className={`min-w-[4.75rem] rounded-full border px-2.5 py-0.5 text-[11px] transition-all ${selected.includes(tag.value) ? 'border-sky-500 bg-sky-500 text-white hover:bg-sky-600' : 'border-sky-200 bg-white/80 text-slate-700 hover:bg-sky-50'}`}
                    onClick={() => toggle(tag.value)}
                    type="button"
                  >
                    {tag.label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {proGroup && (
            <div className="flex flex-col gap-1 min-w-0 max-w-full">
              <div className="text-[11px] font-bold text-slate-600">{proGroup.category}</div>
              <select
                className="h-9 rounded-lg border-sky-200 bg-white/90 text-[13px]"
                value={proTagDraft}
                onChange={(e) => {
                  const value = e.target.value;
                  setProTagDraft(value);
                  if (!value) return;
                  if (!selected.includes(value)) {
                    onChange([...selected, value]);
                  }
                  setProTagDraft('');
                }}
              >
                <option value="">プロ戦法を選択...</option>
                {proGroup.tags.map((tag) => (
                  <option key={tag.value} value={tag.value}>{tag.label}</option>
                ))}
              </select>
              {selectedProTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedProTags.map((tag) => (
                    <button
                      key={tag.value}
                      type="button"
                      className="min-w-[4.75rem] rounded-full border border-sky-500 bg-sky-500 px-2.5 py-0.5 text-[11px] text-white"
                      onClick={() => toggle(tag.value)}
                    >
                      {tag.label} ×
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TagSelector;
