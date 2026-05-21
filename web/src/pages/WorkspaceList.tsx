import React, { useState, useEffect, useCallback } from 'react';
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
        problemRating: 1200,
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
          problemRating: 1200,
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
      setPasteError(`✓ ${branchProblems.length}個の分岐をワークスペースに保存しました`);
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
                    {d?.mode && (
                      <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0 rounded text-[10px]">
                        {d.mode === 'joseki' ? '定跡' : '次の一手'}
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