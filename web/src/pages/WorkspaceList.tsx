import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listWorkspaces,
  createWorkspace,
  deleteWorkspace,
  saveWorkspaceDraft,
  type Workspace,
} from '../api/workspaces';
import { generateDraftChoiceExplanations } from '../api/backend';
import {
  parseKifRecordWithBranches,
  parseKifRecord,
  extractBranchProblems,
  type KifBranchParseResult,
} from '../lib/kif-parser';
import WorkspaceKifPasteBox from '../components/WorkspaceKifPasteBox';
import { getLastNewModeTags, saveLastNewModeTags } from '../lib/new-mode-tags';
import {
  getLastPasteSaveMode,
  getLastWorkspaceModeFilter,
  saveLastPasteSaveMode,
  saveLastWorkspaceModeFilter,
  type PasteSaveMode,
  type WorkspaceModeFilter,
} from '../lib/paste-save-mode';
import ConfirmModal from '../components/ConfirmModal';

type ConfirmDialog = {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
};

const WorkspaceList: React.FC = () => {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [savingBranches, setSavingBranches] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);
  const [selectedDraftProblemIds, setSelectedDraftProblemIds] = useState<Set<number>>(() => new Set());
  const [generatingSelected, setGeneratingSelected] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [batchResultMessage, setBatchResultMessage] = useState('');
  const [sortKey, setSortKey] = useState<'newest' | 'oldest' | 'rating-asc' | 'rating-desc' | 'name-asc' | 'name-desc'>('newest');
  const [modeFilter, setModeFilter] = useState<WorkspaceModeFilter>(() => getLastWorkspaceModeFilter());
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Inline KIF paste state
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [pasteTags, setPasteTags] = useState<string[]>(() => (
    getLastPasteSaveMode() === 'new_mode' ? getLastNewModeTags() : []
  ));
  const [pasteSaveMode, setPasteSaveMode] = useState<PasteSaveMode>(() => getLastPasteSaveMode());
  const [parsedBranchResult, setParsedBranchResult] = useState<KifBranchParseResult | null>(null);
  const [parsedBranchCount, setParsedBranchCount] = useState(0);

  const selectPasteSaveMode = (mode: PasteSaveMode) => {
    setPasteSaveMode(mode);
    saveLastPasteSaveMode(mode);
    if (mode === 'new_mode') {
      setPasteTags(getLastNewModeTags());
    }
  };

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
    setSelectedDraftProblemIds((prev) => {
      const visibleIds = new Set(workspaces.map((workspace) => Number(workspace.id)).filter(Number.isInteger));
      const next = new Set<number>();
      prev.forEach((id) => {
        if (visibleIds.has(id)) next.add(id);
      });
      return next;
    });
  }, [workspaces]);

  const visibleWorkspaces = useMemo(() => {
    if (modeFilter === 'all') return workspaces;
    return workspaces.filter((workspace) => {
      const draft = workspace.draft as { mode?: unknown } | null;
      return draft?.mode === modeFilter;
    });
  }, [modeFilter, workspaces]);

  const sortedWorkspaces = useMemo(() => {
    const arr = [...visibleWorkspaces];
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
  }, [visibleWorkspaces, sortKey]);

  const handleModeFilterChange = (filter: WorkspaceModeFilter) => {
    setModeFilter(filter);
    saveLastWorkspaceModeFilter(filter);
  };


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
        // 保存モード: 'next_move' = 次の一手, 'joseki' = 定跡, 'new_mode' = 新モード
        mode: pasteSaveMode,
        displayNo: null,
        problemRating: 1500,
        rootEvalCp: null,
        rootEvalPercent: null,
        savedAt: new Date().toISOString(),
      });
      if (pasteSaveMode === 'new_mode') {
        saveLastNewModeTags(pasteTags);
      }
      saveLastPasteSaveMode(pasteSaveMode);

      setPasteText('');
      setPasteTags(pasteSaveMode === 'new_mode' ? getLastNewModeTags() : []);
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
        if (pasteSaveMode === 'new_mode') {
          saveLastNewModeTags(pasteTags);
        }
      }
      saveLastPasteSaveMode(pasteSaveMode);

      setPasteText('');
      setPasteTags(pasteSaveMode === 'new_mode' ? getLastNewModeTags() : []);
      resetParsedBranchState();
      setPasteError(`✓ ${branchProblems.length}個の分岐を下書きに保存しました`);
      await fetchWorkspaces();
    } catch (e: any) {
      setPasteError(e.message ?? '分岐の一括保存に失敗しました');
    } finally {
      setSavingBranches(false);
    }
  };

  const runConfirmAction = async () => {
    if (!confirmDialog) return;
    setConfirmBusy(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleDelete = (id: string, name: string) => {
    setConfirmDialog({
      title: '下書き削除',
      message: `「${name}」を削除しますか？`,
      confirmLabel: '削除する',
      onConfirm: async () => {
        try {
          await deleteWorkspace(id);
          setWorkspaces((prev) => prev.filter((w) => w.id !== id));
        } catch (e: any) {
          setError(e.message);
        }
      },
    });
  };

  const toggleWorkspaceSelection = (workspaceId: string) => {
    setSelectedWorkspaceIds((prev) =>
      prev.includes(workspaceId) ? prev.filter((id) => id !== workspaceId) : [...prev, workspaceId],
    );
  };

  const toggleAiSelection = (workspaceId: string) => {
    const draftProblemId = Number(workspaceId);
    if (!Number.isInteger(draftProblemId) || draftProblemId <= 0) return;
    setSelectedDraftProblemIds((prev) => {
      const next = new Set(prev);
      if (next.has(draftProblemId)) {
        next.delete(draftProblemId);
      } else {
        next.add(draftProblemId);
      }
      return next;
    });
  };

  const explanationCount = (workspace: Workspace) => {
    const choices = (workspace.draft as any)?.choices;
    const slots = [choices?.correct, choices?.incorrect1, choices?.incorrect2];
    return slots.filter((choice) => typeof choice?.explanation === 'string' && choice.explanation.trim()).length;
  };

  const explanationBadgeClass = (count: number) => {
    if (count >= 3) return 'bg-emerald-100 text-emerald-700';
    if (count > 0) return 'bg-amber-100 text-amber-700';
    return 'bg-gray-100 text-gray-600';
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
    const idsToDelete = [...selectedWorkspaceIds];
    setConfirmDialog({
      title: '下書き一括削除',
      message: `${idsToDelete.length}件の下書きを削除しますか？`,
      confirmLabel: '削除する',
      onConfirm: async () => {
        setDeletingSelected(true);
        try {
          for (const workspaceId of idsToDelete) {
            await deleteWorkspace(workspaceId);
          }
          setWorkspaces((prev) => prev.filter((workspace) => !idsToDelete.includes(workspace.id)));
          setSelectedWorkspaceIds([]);
        } catch (e: any) {
          setError(e?.message ?? '下書きの一括削除に失敗しました');
        } finally {
          setDeletingSelected(false);
        }
      },
    });
  };

  const handleGenerateSelectedExplanations = async () => {
    const ids = Array.from(selectedDraftProblemIds);
    if (ids.length === 0) return;

    setGeneratingSelected(true);
    setBatchProgress({ current: 0, total: ids.length });
    setBatchResultMessage('');
    setError('');

    let success = 0;
    let skipped = 0;
    let failed = 0;
    const failedIds: number[] = [];

    try {
      for (let index = 0; index < ids.length; index += 1) {
        const problemId = ids[index];
        setBatchProgress({ current: index + 1, total: ids.length });

        const workspace = workspaces.find((item) => Number(item.id) === problemId);
        if (workspace && explanationCount(workspace) >= 3) {
          skipped += 1;
          continue;
        }

        try {
          const result = await generateDraftChoiceExplanations(problemId, false);
          if (result.updated) {
            success += 1;
          } else {
            skipped += 1;
          }
        } catch (e) {
          failed += 1;
          failedIds.push(problemId);
          console.error('[WorkspaceList] AI explanation batch failed', { problemId, error: e });
        }
      }

      setBatchResultMessage(`AI解説生成が完了しました。成功: ${success}件 / スキップ: ${skipped}件 / 失敗: ${failed}件`);
      if (failedIds.length > 0) {
        setError(`AI解説生成に失敗した下書きID: ${failedIds.join(', ')}`);
      }
      await fetchWorkspaces();
    } finally {
      setGeneratingSelected(false);
      setBatchProgress(null);
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

  return (
    <div className="workspace-list-page mx-auto w-full max-w-[1600px]">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">下書き一覧</h2>
      </div>

      <WorkspaceKifPasteBox
        pasteText={pasteText}
        pasteError={pasteError}
        pasteTags={pasteTags}
        pasteSaveMode={pasteSaveMode}
        parsedBranchCount={parsedBranchCount}
        creating={creating}
        savingBranches={savingBranches}
        onPasteTextChange={(text) => {
          setPasteText(text);
          resetParsedBranchState();
        }}
        onParsedPaste={validateAndShowParsedKif}
        onPasteErrorClear={() => setPasteError('')}
        onTagsChange={setPasteTags}
        onModeChange={selectPasteSaveMode}
        onPasteFromClipboard={handlePasteFromClipboard}
        onSave={handlePasteAndSave}
        onSaveAllBranches={handlePasteAndSaveAllBranches}
        onClear={() => {
          setPasteText('');
          setPasteError('');
          setPasteTags([]);
          resetParsedBranchState();
        }}
      />

      <div className="workspace-list-controls flex items-center justify-between mb-2">
        {error && (
          <div className="bg-red-50 border border-red-300 text-red-700 text-[12px] px-3 py-2 rounded mb-3">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
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
            <label className="text-[12px] text-gray-600">モード:</label>
            <select
              value={modeFilter}
              onChange={(e) => handleModeFilterChange(e.target.value as WorkspaceModeFilter)}
              className="text-[12px] border px-2 py-1 rounded"
            >
              <option value="all">すべて</option>
              <option value="next_move">次の一手</option>
              <option value="joseki">定跡</option>
              <option value="new_mode">新モード</option>
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

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-gray-600">AI選択中 {selectedDraftProblemIds.size}件</span>
            <button
              type="button"
              className="text-[12px] px-2 py-1 rounded border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
              disabled={selectedDraftProblemIds.size === 0 || generatingSelected}
              onClick={handleGenerateSelectedExplanations}
            >
              {generatingSelected ? 'AI解説生成中...' : '選択した問題のAI解説を生成'}
            </button>
            {batchProgress && (
              <span className="text-[12px] text-gray-600">
                {batchProgress.current} / {batchProgress.total}
              </span>
            )}
          </div>
        </div>
      </div>

      {batchResultMessage && (
        <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
          {batchResultMessage}
        </div>
      )}

      {loading ? (
        <div className="text-[13px] text-gray-500 py-8 text-center">読み込み中...</div>
      ) : sortedWorkspaces.length === 0 ? (
        <div className="text-[13px] text-gray-500 py-8 text-center border border-dashed border-gray-300 rounded-lg">
          {workspaces.length === 0
            ? '下書きがありません。上の棋譜欄に貼り付けて保存してください。'
            : '選択中のモードに該当する下書きがありません。'}
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
            const aiExplanationCount = explanationCount(ws);
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
                <div className="pt-1">
                  <input
                    type="checkbox"
                    aria-label="AI解説生成対象"
                    title="AI解説生成対象"
                    checked={selectedDraftProblemIds.has(Number(ws.id))}
                    onChange={(event) => {
                      event.stopPropagation();
                      toggleAiSelection(ws.id);
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
                    <span className={`rounded px-1.5 py-0 text-[10px] ${explanationBadgeClass(aiExplanationCount)}`}>
                      AI解説 {aiExplanationCount}/3
                    </span>
                    {d?.mode && (
                      <span className="rounded bg-indigo-100 px-1.5 py-0 text-[10px] text-indigo-700">
                        {d.mode === 'new_mode' ? '新モード' : d.mode === 'joseki' ? '定跡' : '次の一手'}
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
      {confirmDialog && (
        <ConfirmModal
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          danger
          busy={confirmBusy}
          onConfirm={() => {
            void runConfirmAction();
          }}
          onCancel={() => {
            if (!confirmBusy) setConfirmDialog(null);
          }}
        />
      )}
    </div>
  );
};

export default WorkspaceList;
