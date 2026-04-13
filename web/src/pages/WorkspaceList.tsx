import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listWorkspaces,
  createWorkspace,
  deleteWorkspace,
  saveWorkspaceDraft,
  type Workspace,
} from '../api/workspaces';
import { parseKifRecordWithBranches, parseKifRecord } from '../lib/kif-parser';
import TagSelector from '../components/TagSelector';

const WorkspaceList: React.FC = () => {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  // Inline KIF paste state
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [pasteTags, setPasteTags] = useState<string[]>([]);

  const fetchWorkspaces = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listWorkspaces();
      setWorkspaces(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const handlePasteAndSave = async () => {
    const text = pasteText.trim();
    if (!text) {
      setPasteError('棋譜を貼り付けてください');
      return;
    }

    // Parse to get basic info for the draft
    const branchResult = parseKifRecordWithBranches(text);
    const simpleResult = branchResult?.branches?.length ? null : parseKifRecord(text);
    const moves = branchResult?.branches?.[0]?.moves ?? simpleResult?.moves ?? [];
    const sfen = branchResult?.branches?.[0]?.sfen ?? simpleResult?.sfen ?? '';

    if (!sfen) {
      setPasteError('棋譜を解析できませんでした。KIF形式またはSFEN文字列を確認してください。');
      return;
    }

    setCreating(true);
    setPasteError('');
    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const autoName = `#${workspaces.length + 1} ${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const ws = await createWorkspace(autoName);

      // Save draft with KIF text and parsed result
      await saveWorkspaceDraft(ws.id, {
        kifText: text,
        rootSfen: sfen,
        kifMoves: moves,
        choices: {
          correct: { slotLabel: 'correct', usi: '', label: '', explanation: '', line: [], eval_cp: null, eval_percent: null },
          incorrect1: { slotLabel: 'incorrect1', usi: '', label: '', explanation: '', line: [], eval_cp: null, eval_percent: null },
          incorrect2: { slotLabel: 'incorrect2', usi: '', label: '', explanation: '', line: [], eval_cp: null, eval_percent: null },
        },
        readingLineInputs: { correct: '', incorrect1: '', incorrect2: '' },
        prompt: '',
        tags: pasteTags,
        displayNo: null,
        problemRating: 1200,
        rootEvalCp: null,
        rootEvalPercent: null,
        savedAt: new Date().toISOString(),
      });

      setPasteText('');
      setPasteTags([]);
      await fetchWorkspaces();
    } catch (e: any) {
      setPasteError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`「${name}」を削除しますか？`)) return;
    try {
      await deleteWorkspace(id);
      setWorkspaces((prev) => prev.filter((w) => w.id !== id));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const hasPasteContent = pasteText.trim().length > 0;

  return (
    <div className="max-w-[800px] mx-auto">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">ワークスペース一覧</h2>
      </div>

      {/* Inline KIF paste area */}
      <div className="border border-blue-200 bg-blue-50/40 rounded-lg p-3 mb-3">
        <textarea
          className="text-[11px] font-mono leading-tight w-full rounded border-gray-300"
          rows={6}
          placeholder="KIF棋譜 / SFEN を貼り付け"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text/plain');
            if (pasted) {
              e.preventDefault();
              setPasteText(pasted);
            }
          }}
        />
        {pasteError && (
          <div className="text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded mt-1">
            {pasteError}
          </div>
        )}
        {hasPasteContent && (
          <>
            <div className="mt-2">
              <TagSelector selected={pasteTags} onChange={setPasteTags} />
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={handlePasteAndSave}
                disabled={creating}
                className="bg-blue-600 text-white border-blue-600 hover:bg-blue-700 text-[12px] px-3 py-1 rounded disabled:opacity-50"
              >
                {creating ? '保存中...' : '保存'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPasteText('');
                  setPasteError('');
                  setPasteTags([]);
                }}
                className="text-[12px] px-3 py-1"
              >
                クリア
              </button>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-700 text-[12px] px-3 py-2 rounded mb-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-[13px] text-gray-500 py-8 text-center">読み込み中...</div>
      ) : workspaces.length === 0 ? (
        <div className="text-[13px] text-gray-500 py-8 text-center border border-dashed border-gray-300 rounded-lg">
          ワークスペースがありません。上の棋譜欄に貼り付けて保存してください。
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {workspaces.map((ws) => {
            const hasDraft = ws.draft !== null;
            const d = hasDraft ? (ws.draft as any) : null;
            const displayNo = d?.displayNo;
            const moveCount = d?.kifMoves?.length;
            const tags: string[] = d?.tags ?? [];
            const correctLabel = d?.choices?.correct?.label;
            const rootSfen = d?.rootSfen;
            return (
              <div
                key={ws.id}
                className="border border-gray-200 rounded-lg p-3 hover:border-blue-300 hover:bg-blue-50/30 transition-colors cursor-pointer flex items-center gap-3"
                onClick={() => navigate(`/paste-problem?workspace=${ws.id}`)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[14px] truncate">{ws.name}</span>
                    {displayNo != null && (
                      <span className="bg-blue-100 text-blue-700 px-1.5 py-0 rounded text-[11px] font-mono font-semibold flex-shrink-0">
                        No.{displayNo}
                      </span>
                    )}
                    {hasDraft && !rootSfen && (
                      <span className="bg-gray-100 text-gray-500 px-1.5 py-0 rounded text-[10px]">
                        空
                      </span>
                    )}
                    {rootSfen && (
                      <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0 rounded text-[10px]">
                        下書きあり
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5 flex-wrap">
                    <span>{formatDate(ws.updated_at)}</span>
                    {moveCount != null && moveCount > 0 && (
                      <span>{moveCount}手</span>
                    )}
                    {correctLabel && (
                      <span className="text-orange-600">正解: {correctLabel}</span>
                    )}
                    {tags.length > 0 && (
                      <span className="text-gray-400">{tags.join(', ')}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-gray-400 hover:text-red-500 text-[13px] px-2 py-1 border-0 bg-transparent flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(ws.id, ws.name);
                  }}
                  title="削除"
                >
                  🗑
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WorkspaceList;
