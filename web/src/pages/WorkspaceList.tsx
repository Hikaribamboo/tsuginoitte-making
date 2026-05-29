import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listWorkspaces,
  createWorkspace,
  deleteWorkspace,
  saveWorkspaceDraft,
  type Workspace,
} from '../api/workspaces';
import {
  parseKifRecordWithBranches,
  parseKifRecord,
  extractBranchProblems,
  type KifBranchParseResult,
} from '../lib/kif-parser';
import TagSelector from '../components/TagSelector';

const WorkspaceList: React.FC = () => {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [savingBranches, setSavingBranches] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<'newest' | 'oldest' | 'rating-asc' | 'rating-desc' | 'name-asc' | 'name-desc'>('newest');

  // Inline KIF paste state
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [pasteTags, setPasteTags] = useState<string[]>([]);
  const [pasteSaveMode, setPasteSaveMode] = useState<'next_move' | 'joseki'>('next_move');
  const [parsedBranchResult, setParsedBranchResult] = useState<KifBranchParseResult | null>(null);
  const [parsedBranchCount, setParsedBranchCount] = useState(0);

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

  useEffect(() => {
    setSelectedWorkspaceIds((prev) => prev.filter((id) => workspaces.some((workspace) => workspace.id === id)));
  }, [workspaces]);

  const sortedWorkspaces = useMemo(() => {
    const arr = [...workspaces];
    const getRating = (ws: Workspace) => {
      try {
        const d: any = ws.draft ?? {};
        return typeof d.problemRating === 'number' ? d.problemRating : (d?.problemRating ? Number(d.problemRating) : 0);
      } catch {
        return 0;
      }
    };

    switch (sortKey) {
      case 'newest':
        return arr.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
      case 'oldest':
        return arr.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
      case 'rating-asc':
        return arr.sort((a, b) => getRating(a) - getRating(b));
      case 'rating-desc':
        return arr.sort((a, b) => getRating(b) - getRating(a));
      case 'name-asc':
        return arr.sort((a, b) => a.name.localeCompare(b.name));
      case 'name-desc':
        return arr.sort((a, b) => b.name.localeCompare(a.name));
      default:
        return arr;
    }
  }, [workspaces, sortKey]);


  const getNextWorkspaceNumber = (items: Workspace[]) => items.reduce((maxNo, ws) => {
    const m = ws.name.match(/^#(\d+)\b/);
    if (!m) return maxNo;
    const n = parseInt(m[1], 10);
    return Number.isNaN(n) ? maxNo : Math.max(maxNo, n);
  }, 0) + 1;

  const buildAutoWorkspaceName = (nextNumber: number, suffix?: string) => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const base = `#${nextNumber} ${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    return suffix ? `${base} ${suffix}` : base;
  };

  const buildDefaultChoices = (correct?: { usi: string; label: string }) => ({
    correct: {
      slotLabel: 'correct',
      usi: correct?.usi ?? '',
      label: correct?.label ?? '',
      explanation: '',
      line: [],
      eval_cp: null,
      eval_percent: null,
    },
    incorrect1: { slotLabel: 'incorrect1', usi: '', label: '', explanation: '', line: [], eval_cp: null, eval_percent: null },
    incorrect2: { slotLabel: 'incorrect2', usi: '', label: '', explanation: '', line: [], eval_cp: null, eval_percent: null },
  });

  const resetParsedBranchState = () => {
    setParsedBranchResult(null);
    setParsedBranchCount(0);
  };

  const handlePasteAndSave = async () => {
    const text = pasteText.trim();
    if (!text) {
      setPasteError('棋譜を貼り付けてください');
      return;
    }

    // Parse to get basic info for the draft
    const branchResult = parseKifRecordWithBranches(text);
    const simpleResult = !branchResult ? parseKifRecord(text) : null;
    const moves = branchResult?.branches?.[0]?.moves ?? simpleResult?.moves ?? [];
    const sfen = branchResult?.branches?.[0]?.sfen ?? simpleResult?.sfen ?? '';

    if (!sfen) {
      setPasteError('棋譜を解析できませんでした。KIF形式またはSFEN文字列を確認してください。');
      return;
    }

    setCreating(true);
    setPasteError('');
    try {
      const latestWorkspaces = await listWorkspaces();
      const nextNumber = getNextWorkspaceNumber(latestWorkspaces);
      const ws = await createWorkspace(buildAutoWorkspaceName(nextNumber));

      // Save draft with KIF text and parsed result
      await saveWorkspaceDraft(ws.id, {
        kifText: text,
        rootSfen: sfen,
        kifMoves: moves,
        choices: buildDefaultChoices(),
        readingLineInputs: { correct: '', incorrect1: '', incorrect2: '' },
        prompt: '',
        tags: pasteTags,
        // 保存モード: 'next_move' = 次の一手, 'joseki' = 定跡
        mode: pasteSaveMode,
        displayNo: null,
        problemRating: 1500,
        rootEvalCp: null,
        rootEvalPercent: null,
        savedAt: new Date().toISOString(),
      });

      setPasteText('');
      setPasteTags([]);
      resetParsedBranchState();
      await fetchWorkspaces();
    } catch (e: any) {
      setPasteError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setPasteText(text);
      validateAndShowParsedKif(text);
    } catch {
      setPasteError('クリップボードの読み取りに失敗しました');
    }
  };

  const validateAndShowParsedKif = (text: string) => {
    const normalized = text.trim();
    if (!normalized) {
      setPasteError('');
      resetParsedBranchState();
      return;
    }

    const branchResult = parseKifRecordWithBranches(normalized);
    const simpleResult = !branchResult ? parseKifRecord(normalized) : null;
    const sfen = branchResult?.branches?.[0]?.sfen ?? simpleResult?.sfen ?? '';

    if (sfen) {
      const variationCount = branchResult ? Math.max(branchResult.branches.length - 1, 0) : 0;
      const moveCount = branchResult?.branches?.[0]?.moves?.length ?? simpleResult?.moves?.length ?? 0;
      setParsedBranchResult(branchResult);
      setParsedBranchCount(variationCount);
      setPasteError(
        variationCount > 0
          ? `✓ 棋譜を読み込みました（${moveCount}手、変化${variationCount}個）`
          : `✓ 棋譜を読み込みました（${moveCount}手）`,
      );
    } else {
      setPasteError('❌ 棋譜を解析できませんでした。KIF形式またはSFEN文字列を確認してください。');
      resetParsedBranchState();
    }
  };

  const handlePasteAndSaveAllBranches = async () => {
    const text = pasteText.trim();
    if (!text) {
      setPasteError('棋譜を貼り付けてください');
      return;
    }

    const branchResult = parsedBranchResult ?? parseKifRecordWithBranches(text);
    if (!branchResult || branchResult.branches.length < 2) {
      setPasteError('分岐（変化）が見つかりませんでした。変化付きのKIF棋譜を貼り付けてください。');
      return;
    }

    const branchProblems = extractBranchProblems(branchResult);
    if (branchProblems.length === 0) {
      setPasteError('問題として作成できる分岐がありません。各分岐に2手以上の手順が必要です。');
      return;
    }

    setSavingBranches(true);
    setPasteError('');
    try {
      const latestWorkspaces = await listWorkspaces();
      let nextNumber = getNextWorkspaceNumber(latestWorkspaces);

      for (const bp of branchProblems) {
        const ws = await createWorkspace(buildAutoWorkspaceName(nextNumber, bp.branchName));
        nextNumber += 1;

        await saveWorkspaceDraft(ws.id, {
          kifText: text,
          rootSfen: bp.rootSfen,
          // rootSfen is already the problem position, so keep kifMoves empty.
          // This prevents PasteProblemCreator from shifting the root one move earlier on save.
          kifMoves: [],
          choices: buildDefaultChoices({ usi: bp.correctMove, label: bp.correctMoveLabel }),
          readingLineInputs: { correct: '', incorrect1: '', incorrect2: '' },
          prompt: '',
          tags: pasteTags,
          mode: pasteSaveMode,
          displayNo: null,
          problemRating: 1500,
          rootEvalCp: null,
          rootEvalPercent: null,
          savedAt: new Date().toISOString(),
          sourceBranch: {
            branchId: bp.branchId,
            branchName: bp.branchName,
            introMovesUsi: bp.introMovesUsi,
          },
        });
      }

      setPasteText('');
      setPasteTags([]);
      resetParsedBranchState();
      setPasteError(`✓ ${branchProblems.length}個の分岐を下書きに保存しました`);
      await fetchWorkspaces();
    } catch (e: any) {
      setPasteError(e.message ?? '分岐の一括保存に失敗しました');
    } finally {
      setSavingBranches(false);
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

  const toggleWorkspaceSelection = (workspaceId: string) => {
    setSelectedWorkspaceIds((prev) =>
      prev.includes(workspaceId) ? prev.filter((id) => id !== workspaceId) : [...prev, workspaceId],
    );
  };

  const allSelected = sortedWorkspaces.length > 0
    && sortedWorkspaces.every((workspace) => selectedWorkspaceIds.includes(workspace.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedWorkspaceIds([]);
      return;
    }
    setSelectedWorkspaceIds(sortedWorkspaces.map((workspace) => workspace.id));
  };

  const handleDeleteSelected = async () => {
    if (selectedWorkspaceIds.length === 0) return;
    if (!window.confirm(`${selectedWorkspaceIds.length}件の下書きを削除しますか？`)) return;

    setDeletingSelected(true);
    try {
      for (const workspaceId of selectedWorkspaceIds) {
        await deleteWorkspace(workspaceId);
      }
      setWorkspaces((prev) => prev.filter((workspace) => !selectedWorkspaceIds.includes(workspace.id)));
      setSelectedWorkspaceIds([]);
    } catch (e: any) {
      setError(e?.message ?? '下書きの一括削除に失敗しました');
    } finally {
      setDeletingSelected(false);
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
    <div className="mx-auto w-full max-w-[1600px]">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">下書き一覧</h2>
      </div>

      {/* Inline KIF paste area */}
      <div className="border border-blue-200 bg-blue-50/40 rounded-lg p-3 mb-3">
        <textarea
          className="text-[11px] font-mono leading-tight w-full rounded border border-gray-300 p-2"
          rows={6}
          placeholder="KIF棋譜 / SFEN を貼り付け"
          value={pasteText}
          onChange={(e) => {
            setPasteText(e.target.value);
            resetParsedBranchState();
            setPasteError('');
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text/plain');
            if (pasted) {
              e.preventDefault();
              setPasteText(pasted);
              validateAndShowParsedKif(pasted);
            }
          }}
        />
        {pasteError && (
          <div
            className={
              pasteError.startsWith('✓')
                ? 'text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded mt-1'
                : 'text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded mt-1'
            }
          >
            {pasteError}
          </div>
        )}
        <div className="flex gap-1 mt-1">
          <button
            type="button"
            onClick={handlePasteFromClipboard}
            className="text-[11px] px-2 py-0.5 bg-blue-100 border border-blue-300 hover:bg-blue-200 rounded"
          >
            📋 貼り付け
          </button>
        </div>
        {hasPasteContent && (
          <>
            <div className="mt-2">
              <TagSelector selected={pasteTags} onChange={setPasteTags} />
            </div>
            <div className="mt-2 flex items-center gap-3 text-[13px]">
              <div className="flex items-center gap-1">
                <input
                  id="saveMode-next"
                  type="radio"
                  name="saveMode"
                  value="next_move"
                  checked={pasteSaveMode === 'next_move'}
                  onChange={() => setPasteSaveMode('next_move')}
                  className="mr-1"
                />
                <label htmlFor="saveMode-next">次の一手</label>
              </div>
              <div className="flex items-center gap-1">
                <input
                  id="saveMode-joseki"
                  type="radio"
                  name="saveMode"
                  value="joseki"
                  checked={pasteSaveMode === 'joseki'}
                  onChange={() => setPasteSaveMode('joseki')}
                  className="mr-1"
                />
                <label htmlFor="saveMode-joseki">定跡</label>
              </div>
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              {parsedBranchCount > 0 && (
                <button
                  type="button"
                  onClick={handlePasteAndSaveAllBranches}
                  disabled={creating || savingBranches}
                  className="bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 text-[12px] px-3 py-1 rounded disabled:opacity-50"
                >
                  {savingBranches ? '保存中...' : `🌳 分岐（${parsedBranchCount}個） 全てを保存する`}
                </button>
              )}
              <button
                type="button"
                onClick={handlePasteAndSave}
                disabled={creating || savingBranches}
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
                  resetParsedBranchState();
                }}
                className="text-[12px] px-3 py-1"
              >
                クリア
              </button>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between mb-2">
        {error && (
          <div className="bg-red-50 border border-red-300 text-red-700 text-[12px] px-3 py-2 rounded mb-3">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[12px] text-gray-600">並び替え:</label>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as any)}
              className="text-[12px] border px-2 py-1 rounded"
            >
              <option value="newest">新しい順</option>
              <option value="oldest">古い順</option>
              <option value="rating-desc">レート大きい順</option>
              <option value="rating-asc">レート小さい順</option>
              <option value="name-asc">名前 A→Z</option>
              <option value="name-desc">名前 Z→A</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[12px] text-gray-600">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
              />
              全選択
            </label>
            <button
              type="button"
              className="text-[12px] px-2 py-1 rounded border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
              disabled={selectedWorkspaceIds.length === 0 || deletingSelected}
              onClick={handleDeleteSelected}
            >
              {deletingSelected ? '削除中...' : `選択削除 (${selectedWorkspaceIds.length})`}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-[13px] text-gray-500 py-8 text-center">読み込み中...</div>
      ) : sortedWorkspaces.length === 0 ? (
        <div className="text-[13px] text-gray-500 py-8 text-center border border-dashed border-gray-300 rounded-lg">
          下書きがありません。上の棋譜欄に貼り付けて保存してください。
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {sortedWorkspaces.map((ws) => {
            const hasDraft = ws.draft !== null;
            const d = hasDraft ? (ws.draft as any) : null;
            const displayNo = d?.displayNo;
            const moveCount = d?.kifMoves?.length;
            const tags: string[] = d?.tags ?? [];
            const correctLabel = d?.choices?.correct?.label;
            const rootSfen = d?.rootSfen;
            const imagePositionMemo = typeof d?.imagePositionSource?.memo === 'string'
              ? d.imagePositionSource.memo.trim()
              : '';
            return (
              <div
                key={ws.id}
                className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-2.5 transition-colors hover:border-blue-300 hover:bg-blue-50/30"
                onClick={() => navigate(`/paste-problem?workspace=${ws.id}`)}
              >
                <div className="pt-1">
                  <input
                    type="checkbox"
                    checked={selectedWorkspaceIds.includes(ws.id)}
                    onChange={(event) => {
                      event.stopPropagation();
                      toggleWorkspaceSelection(ws.id);
                    }}
                    onClick={(event) => event.stopPropagation()}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold">{ws.name}</span>
                    {displayNo != null && (
                      <span className="flex-shrink-0 rounded bg-blue-100 px-1.5 py-0 text-[10px] font-mono font-semibold text-blue-700">
                        No.{displayNo}
                      </span>
                    )}
                    {hasDraft && !rootSfen && (
                      <span className="rounded bg-gray-100 px-1.5 py-0 text-[10px] text-gray-500">
                        空
                      </span>
                    )}
                    {rootSfen && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0 text-[10px] text-emerald-700">
                        下書きあり
                      </span>
                    )}
                    {d?.mode && (
                      <span className="rounded bg-indigo-100 px-1.5 py-0 text-[10px] text-indigo-700">
                        {d.mode === 'joseki' ? '定跡' : '次の一手'}
                      </span>
                    )}
                    {d?.imagePositionSource && (
                      <span className="rounded bg-amber-100 px-1.5 py-0 text-[10px] text-amber-700">
                        画像局面
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
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
                  {imagePositionMemo && (
                    <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-[10px] leading-relaxed text-gray-600">
                      画像メモ: {imagePositionMemo}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="flex-shrink-0 border-0 bg-transparent px-1.5 py-1 text-[12px] text-gray-400 hover:text-red-500"
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
