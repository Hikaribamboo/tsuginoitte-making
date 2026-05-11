import React, { useMemo, useState } from 'react';
import { TAG_CATEGORIES } from '../lib/constants';

interface TagSelectorProps {
  selected: string[];
  onChange: (tags: string[]) => void;
}

const TagSelector: React.FC<TagSelectorProps> = ({ selected, onChange }) => {
  const [collapsed, setCollapsed] = useState(true);
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
    <div className="flex flex-col gap-1.5 min-w-0 max-w-full">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold text-gray-500">タグ</div>
        <button
          type="button"
          className="text-[11px] px-2 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          onClick={() => setCollapsed((prev) => !prev)}
        >
          {collapsed ? '展開' : '折りたたむ'}
        </button>
      </div>

      <div className="flex min-w-0 max-w-full overflow-x-auto whitespace-nowrap gap-0.5 pb-1">
        {selectedTags.length > 0 ? (
          selectedTags.map((tag) => (
            <button
              key={tag.value}
              type="button"
              className="shrink-0 min-w-[4.75rem] px-2.5 py-0.5 rounded-full text-[11px] border bg-blue-600 text-white border-blue-600"
              onClick={() => toggle(tag.value)}
            >
              {tag.label} ×
            </button>
          ))
        ) : (
          <span className="text-[11px] text-gray-400">選択タグなし</span>
        )}
      </div>

      {!collapsed && (
        <div className="flex flex-col gap-1.5 min-w-0 max-w-full">
          {normalGroups.map((group) => (
            <div key={group.category} className="flex flex-col gap-1 min-w-0 max-w-full">
              <div className="text-[11px] font-bold text-gray-600">{group.category}</div>
              <div className="flex flex-wrap gap-0.5 min-w-0 max-w-full">
                {group.tags.map((tag) => (
                  <button
                    key={tag.value}
                    className={`min-w-[4.75rem] px-2.5 py-0.5 rounded-full text-[11px] border transition-all ${selected.includes(tag.value) ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700' : 'border-gray-300 bg-white'}`}
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
              <div className="text-[11px] font-bold text-gray-600">{proGroup.category}</div>
              <select
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
                <div className="flex flex-wrap gap-0.5">
                  {selectedProTags.map((tag) => (
                    <button
                      key={tag.value}
                      type="button"
                      className="min-w-[4.75rem] px-2.5 py-0.5 rounded-full text-[11px] border bg-blue-600 text-white border-blue-600"
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
