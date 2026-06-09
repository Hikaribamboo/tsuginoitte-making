import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteProductionProblemEverywhere,
  getProductionProblemById,
  listProductionChoicesByProblemIds,
  listProductionProblems,
  updateProductionProblemById,
} from '../api/production';
import Board from '../components/Board';
import { TAG_CATEGORIES } from '../lib/constants';
import {
  getProductionValidationSummary,
  summarizeProductionIssues,
  type ProductionValidationIssue,
  type ProductionValidationSeverity,
  type ProductionValidationStatus,
  type ProductionValidationSummary,
} from '../lib/productionValidation';
import { applyUsiMove, boardToSfen, parseSfen } from '../lib/sfen';
import {
  CAN_PROMOTE,
  HAND_PIECE_TYPES,
  PIECE_KANJI,
  pieceKanji,
  type Board as BoardType,
  type HandPieces,
  type HandPieceType,
  type Piece,
  type PieceType,
  type Side,
} from '../types/shogi';
import type {
  ProductionChoice,
  ProductionProblem,
  ProductionProblemDetail,
  ProductionProblemMode,
} from '../types/production';

type StatusFilter = 'all' | string;
type ChoiceLineApplyResult =
  | { ok: true }
  | { ok: false; message: string; failedMove?: string };
type PieceSelection =
  | { source: 'board'; row: number; col: number; piece: Piece }
  | { source: 'hand'; side: Side; type: HandPieceType; piece: Piece }
  | { source: 'box'; type: PieceType; piece: Piece };

const MODE_OPTIONS: Array<'all' | ProductionProblemMode> = ['all', 'next_move', 'joseki'];
const STATUS_OPTIONS: Array<'all' | string> = ['all', 'active', 'draft'];
const TAG_OPTIONS = TAG_CATEGORIES.flatMap((group) => group.tags);
const PIECE_TYPES: PieceType[] = ['K', 'R', 'B', 'G', 'S', 'N', 'L', 'P'];
const TOTAL_PIECES: Record<PieceType, number> = {
  K: 2,
  R: 2,
  B: 2,
  G: 4,
  S: 4,
  N: 4,
  L: 4,
  P: 18,
};
const EXPLANATION_HELPER_CHARS = [
  '▲',
  '１',
  '２',
  '３',
  '４',
  '５',
  '６',
  '７',
  '８',
  '９',
  '△',
  '一',
  '二',
  '三',
  '四',
  '五',
  '六',
  '七',
  '八',
  '九',
  '飛',
  '角',
  '金',
  '銀',
  '桂',
  '香',
  '歩',
  '龍',
  '馬',
  '成銀',
  '成桂',
  '成香',
  'と',
  '成',
  '打',
  '同',
];
const PREVIEW_FILE_LABELS = ['９', '８', '７', '６', '５', '４', '３', '２', '１'];
const PREVIEW_RANK_LABELS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HAND_KANJI: Record<HandPieceType, string> = {
  R: '飛',
  B: '角',
  G: '金',
  S: '銀',
  N: '桂',
  L: '香',
  P: '歩',
};

const ProductionReview: React.FC = () => {
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveOkFlash, setSaveOkFlash] = useState(false);
  const [items, setItems] = useState<ProductionProblem[]>([]);
  const [itemSummaryMap, setItemSummaryMap] = useState<Record<string, ProductionValidationSummary>>({});
  const [selectedProblemId, setSelectedProblemId] = useState<number | null>(null);
  const [selectedProblemMode, setSelectedProblemMode] = useState<ProductionProblemMode | null>(null);
  const [detail, setDetail] = useState<ProductionProblemDetail | null>(null);
  const [detailDraft, setDetailDraft] = useState<ProductionProblemDetail | null>(null);
  const [mode, setMode] = useState<'all' | ProductionProblemMode>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [selectedChoiceId, setSelectedChoiceId] = useState<number | null>(null);
  const [isExplanationFocused, setIsExplanationFocused] = useState(false);
  const [isBoardEditing, setIsBoardEditing] = useState(false);
  const explanationRef = useRef<HTMLTextAreaElement | null>(null);
  const listLoadSeqRef = useRef(0);

  const loadList = async () => {
    const loadSeq = listLoadSeqRef.current + 1;
    listLoadSeqRef.current = loadSeq;

    try {
      setLoadingList(true);
      setListError('');

      const rows = await listProductionProblems({
        mode,
        status,
        query,
        limit: 500,
      });

      if (rows.length === 0) {
        setItems([]);
        setItemSummaryMap({});
        setSelectedProblemId(null);
        setSelectedProblemMode(null);
        return;
      }

      const choices = await listProductionChoicesByProblemIds(rows.map((row) => row.problemId), mode);
      const groupedChoices = groupByProblemId(choices);
      const baseSummaryMap: Record<string, ProductionValidationSummary> = {};

      for (const row of rows) {
        baseSummaryMap[productionItemKey(row)] = getProductionValidationSummary(
          row,
          groupedChoices.get(productionItemKey(row)) ?? [],
        );
      }

      setItems(rows);
      setItemSummaryMap(baseSummaryMap);
      const currentKey = selectedProblemId == null || selectedProblemMode == null
        ? null
        : `${selectedProblemMode}:${selectedProblemId}`;
      const nextSelected = currentKey
        ? rows.find((row) => productionItemKey(row) === currentKey) ?? rows[0]
        : rows[0];
      setSelectedProblemId(nextSelected.problemId);
      setSelectedProblemMode(nextSelected.mode);
      scheduleLineValidationSummaryUpdates(loadSeq, rows, groupedChoices);
    } catch (nextError: any) {
      setListError(nextError?.message ?? '本番問題一覧の取得に失敗しました');
      setItems([]);
      setItemSummaryMap({});
      setSelectedProblemId(null);
      setSelectedProblemMode(null);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status, query]);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail() {
      if (selectedProblemId == null || selectedProblemMode == null) {
        setDetail(null);
        setDetailDraft(null);
        return;
      }

      try {
        setLoadingDetail(true);
        setDetailError('');
        setSaveError('');
        setDetail(null);
        setDetailDraft(null);
        const nextDetail = await getProductionProblemById(selectedProblemId, selectedProblemMode);
        if (!cancelled) {
          setDetail(nextDetail);
          setDetailDraft(nextDetail);
          setSelectedChoiceId(
            nextDetail.choices.find((choice) => choice.choice_id === nextDetail.correctChoiceId)?.choice_id
              ?? nextDetail.choices[0]?.choice_id
              ?? null,
          );
          setIsExplanationFocused(false);
          setIsBoardEditing(false);
        }
      } catch (nextError: any) {
        if (!cancelled) {
          setDetailError(nextError?.message ?? '本番問題詳細の取得に失敗しました');
          setDetail(null);
          setDetailDraft(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedProblemId, selectedProblemMode]);

  const selectedRow = useMemo(
    () => items.find((item) => item.problemId === selectedProblemId && item.mode === selectedProblemMode) ?? null,
    [items, selectedProblemId, selectedProblemMode],
  );

  const selectedSummary = useMemo(() => {
    if (detailDraft) return getProductionDetailValidationSummaryWithLineIssues(detailDraft);
    if (selectedRow) return itemSummaryMap[productionItemKey(selectedRow)] ?? summarizeProductionIssues([]);
    return summarizeProductionIssues([]);
  }, [detailDraft, itemSummaryMap, selectedRow]);

  const selectedIssues = selectedSummary.issues;
  const activeChoice =
    detailDraft?.choices.find((choice) => choice.choice_id === selectedChoiceId)
      ?? detailDraft?.choices.find((choice) => choice.choice_id === detailDraft.correctChoiceId)
      ?? detailDraft?.choices[0]
      ?? null;

  const lineErrors = useMemo(() => {
    if (!detailDraft) return {};
    const next: Record<number, ChoiceLineApplyResult> = {};
    for (const choice of detailDraft.choices) {
      next[choice.choice_id] = validateChoiceLine(detailDraft, choice);
    }
    return next;
  }, [detailDraft]);

  const handleApplySearch = () => {
    setQuery(draftQuery.trim());
  };

  const handleClear = () => {
    setDraftQuery('');
    setQuery('');
    setMode('all');
    setStatus('all');
  };

  const scheduleLineValidationSummaryUpdates = (
    loadSeq: number,
    rows: ProductionProblem[],
    groupedChoices: Map<string, ProductionChoice[]>,
  ) => {
    let index = 0;
    const chunkSize = 20;

    const processChunk = () => {
      if (listLoadSeqRef.current !== loadSeq) return;

      const patch: Record<string, ProductionValidationSummary> = {};
      const end = Math.min(rows.length, index + chunkSize);
      for (; index < end; index += 1) {
        const row = rows[index];
        const key = productionItemKey(row);
        patch[key] = getProductionValidationSummaryWithLineIssues(row, groupedChoices.get(key) ?? []);
      }

      if (Object.keys(patch).length > 0) {
        setItemSummaryMap((current) => (
          listLoadSeqRef.current === loadSeq ? { ...current, ...patch } : current
        ));
      }

      if (index < rows.length) {
        window.setTimeout(processChunk, 0);
      }
    };

    window.setTimeout(processChunk, 0);
  };

  const updateChoice = (choiceId: number, patch: Partial<ProductionChoice>) => {
    setDetailDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        choices: current.choices.map((choice) =>
          choice.choice_id === choiceId ? { ...choice, ...patch } : choice,
        ),
      };
    });
  };

  const insertExplanationChar = (char: string) => {
    if (!activeChoice) return;
    const textarea = explanationRef.current;
    const current = activeChoice.explanation ?? '';

    if (!textarea) {
      updateChoice(activeChoice.choice_id, { explanation: `${current}${char}` });
      return;
    }

    const start = textarea.selectionStart ?? current.length;
    const end = textarea.selectionEnd ?? start;
    const next = `${current.slice(0, start)}${char}${current.slice(end)}`;
    updateChoice(activeChoice.choice_id, { explanation: next });

    requestAnimationFrame(() => {
      const cursor = start + char.length;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const handleSave = async () => {
    if (!detailDraft) return;
    setSaving(true);
    setSaveError('');
    setSaveOkFlash(false);
    try {
      const updated = await updateProductionProblemById(
        detailDraft.problemId,
        detailDraft.mode,
        {
          prompt: detailDraft.prompt,
          rootSfen: detailDraft.rootSfen,
          correctChoiceId: detailDraft.correctChoiceId,
          introMovesUsi: detailDraft.introMovesUsi,
          rootEvalCp: detailDraft.rootEvalCp,
          rootEvalPercent: detailDraft.rootEvalPercent,
          problemRating: detailDraft.problemRating,
          problemRatingGames: detailDraft.problemRatingGames,
          tags: detailDraft.tags,
        },
        detailDraft.choices,
      );
      setDetail(updated);
      setDetailDraft(updated);
      await loadList();
      setSaveOkFlash(true);
      window.setTimeout(() => setSaveOkFlash(false), 3000);
    } catch (nextError: any) {
      setSaveError(nextError?.message ?? '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!detailDraft || deleting) return;

    const confirmed = window.confirm(
      `本番問題 No.${detailDraft.displayNo ?? '-'} / ID ${detailDraft.problemId} を削除しますか？\nこの操作は元に戻せません。`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setDetailError('');
    setSaveError('');

    try {
      await deleteProductionProblemEverywhere(detailDraft.problemId);
      setDetail(null);
      setDetailDraft(null);
      setSelectedProblemId(null);
      setSelectedProblemMode(null);
      await loadList();
    } catch (nextError: any) {
      setDetailError(nextError?.message ?? '削除に失敗しました');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="production-review-shell h-[calc(100vh-106px)] min-h-[680px] overflow-hidden rounded-xl border border-sky-200/80 bg-gradient-to-b from-sky-50 via-blue-50 to-slate-50 shadow-sm">
      <div className="production-review-layout flex h-full">
        <aside className="production-review-sidebar w-[220px] shrink-0 border-r border-sky-200/80 bg-white/75 backdrop-blur-sm">
          <div className="border-b border-sky-200/70 px-4 py-3">
            <h2 className="text-xl font-semibold text-slate-900">本番問題一覧</h2>
            <div className="mt-1 text-xs text-sky-700">{items.length.toLocaleString('ja-JP')} 件</div>
          </div>

          <form
            className="space-y-3 border-b border-sky-200/70 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              handleApplySearch();
            }}
          >
            <label className="block">
              <div className="mb-1 text-xs text-slate-600">検索</div>
              <input
                className="h-9 w-full rounded-lg border border-sky-200 bg-white px-3 text-sm text-slate-900"
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
                placeholder="prompt / tags / display_no / id"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs text-slate-600">mode</div>
              <select
                className="h-9 w-full rounded-lg border border-sky-200 bg-white px-3 text-sm text-slate-900"
                value={mode}
                onChange={(event) => setMode(event.target.value as 'all' | ProductionProblemMode)}
              >
                {MODE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="mb-1 text-xs text-slate-600">status</div>
              <select
                className="h-9 w-full rounded-lg border border-sky-200 bg-white px-3 text-sm text-slate-900"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-[1fr_88px] gap-2">
              <button
                type="submit"
                className="h-9 rounded-lg border border-sky-500 bg-sky-500 text-sm font-semibold text-white hover:bg-sky-600"
              >
                検索
              </button>
              <button
                type="button"
                className="h-9 rounded-lg border border-sky-200 bg-sky-50 text-sm font-semibold text-sky-700 hover:bg-sky-100"
                onClick={handleClear}
              >
                クリア
              </button>
            </div>
          </form>

          <div className="h-[calc(100%-227px)] overflow-y-auto p-3">
            {loadingList ? <Banner text="一覧を読み込み中..." /> : null}
            {listError ? <Banner text={listError} tone="error" /> : null}

            {items.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
                条件に合う問題がありません。
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item) => {
                  const selected = item.problemId === selectedProblemId && item.mode === selectedProblemMode;
                  const summary = itemSummaryMap[productionItemKey(item)] ?? summarizeProductionIssues([]);

                  return (
                    <button
                      key={productionItemKey(item)}
                      type="button"
                      onClick={() => {
                        setSelectedProblemId(item.problemId);
                        setSelectedProblemMode(item.mode);
                      }}
                      className={`w-full rounded-lg border p-3 text-left ${
                        selected
                          ? 'border-sky-400 bg-sky-100/70 shadow-[0_8px_26px_rgba(2,132,199,0.15)]'
                          : 'border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900">
                          No.{item.displayNo ?? '-'} / ID {item.problemId}
                        </div>
                        <QualityBadge summary={summary} />
                      </div>

                      <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-slate-600">
                        <span className="rounded-full bg-sky-100 px-2 py-[2px] text-sky-700">{item.mode}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-[2px] text-slate-700">
                          {item.status ?? '-'}
                        </span>
                      </div>

                      <div className="mt-2 line-clamp-2 text-xs text-slate-700">{item.prompt || '-'}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <main className="production-review-detail flex-1 overflow-y-auto p-4">
          {loadingDetail ? <Banner text="詳細を読み込み中..." /> : null}
          {detailError ? <Banner text={detailError} tone="error" /> : null}
          {saveError ? <Banner text={saveError} tone="error" /> : null}
          {saveOkFlash ? <Banner text="保存しました" tone="success" /> : null}

          {!detailDraft ? (
            <div className="grid h-full min-h-[400px] place-items-center">
              <div className="rounded-xl border border-slate-200 bg-white/80 px-6 py-5 text-sm text-slate-600 backdrop-blur-sm">
                {selectedRow ? `選択中: No.${selectedRow.displayNo ?? '-'} / ID ${selectedRow.problemId}` : '左の一覧から選択してください'}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <section className="rounded-xl border border-sky-200/80 bg-white/75 p-4 shadow-sm backdrop-blur-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xl font-semibold text-slate-900">本番問題 No.{detailDraft.displayNo ?? '-'}</div>
                    <div className="mt-1 text-xs text-sky-700">ID {detailDraft.problemId}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <QualityBadge summary={selectedSummary} />
                    <button
                      type="button"
                      className="h-9 rounded-lg border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                      onClick={handleDelete}
                      disabled={saving || deleting}
                    >
                      {deleting ? '削除中...' : '削除'}
                    </button>
                    <button
                      type="button"
                      className="h-9 rounded-lg border border-sky-500 bg-sky-500 px-4 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
                      onClick={handleSave}
                      disabled={saving || deleting}
                    >
                      {saving ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-3">
                  <div className="xl:col-span-2">
                    <div className={`grid h-full gap-3 ${isBoardEditing ? '' : 'lg:grid-cols-2'}`}>
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">盤面プレビュー</div>
                        <BoardPreviewWithMoves
                          rootSfen={detailDraft.rootSfen}
                          introMovesUsi={detailDraft.introMovesUsi}
                          choice={activeChoice}
                          editing={isBoardEditing}
                          onEditingChange={setIsBoardEditing}
                          onRootSfenChange={(nextRootSfen) =>
                            setDetailDraft((current) =>
                              current ? { ...current, rootSfen: nextRootSfen } : current,
                            )
                          }
                        />
                      </div>

                      {!isBoardEditing ? (
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-sm font-semibold text-slate-900">選択肢編集</div>
                          {activeChoice?.choice_id === detailDraft.correctChoiceId ? (
                            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-[2px] text-[11px] font-semibold text-emerald-700">
                              正解
                            </span>
                          ) : null}
                        </div>

                        <div className="mb-3 flex flex-wrap gap-2">
                          {detailDraft.choices
                            .slice()
                            .sort((a, b) => a.choice_id - b.choice_id)
                            .map((choice) => (
                              <button
                                key={choice.choice_id}
                                type="button"
                                className={`rounded-md border px-2 py-1 text-xs ${
                                  selectedChoiceId === choice.choice_id
                                    ? 'border-sky-500 bg-sky-100 text-sky-800'
                                    : 'border-slate-300 bg-white text-slate-700'
                                }`}
                                onClick={() => {
                                  setSelectedChoiceId(choice.choice_id);
                                  setIsExplanationFocused(false);
                                }}
                              >
                                {choice.choice_id}
                                {choice.choice_id === detailDraft.correctChoiceId ? ' 正解' : ''}
                              </button>
                            ))}
                        </div>

                        {!activeChoice ? (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                            choice がありません。
                          </div>
                        ) : (
                          <>
                            <div className="grid gap-2 md:grid-cols-2">
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-slate-600">label</span>
                                <input
                                  className="h-9 rounded-lg border border-slate-300 px-3 text-sm"
                                  value={activeChoice.label}
                                  onChange={(event) => updateChoice(activeChoice.choice_id, { label: event.target.value })}
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-slate-600">usi</span>
                                <input
                                  className="h-9 rounded-lg border border-slate-300 px-3 font-mono text-sm"
                                  value={activeChoice.usi}
                                  onChange={(event) => updateChoice(activeChoice.choice_id, { usi: event.target.value })}
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-slate-600">eval_cp</span>
                                <input
                                  className="h-9 rounded-lg border border-slate-300 px-3 text-sm"
                                  type="number"
                                  value={activeChoice.eval_cp ?? ''}
                                  onChange={(event) =>
                                    updateChoice(activeChoice.choice_id, {
                                      eval_cp: event.target.value === '' ? null : Number(event.target.value),
                                    })
                                  }
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-slate-600">eval_percent</span>
                                <input
                                  className="h-9 rounded-lg border border-slate-300 px-3 text-sm"
                                  type="number"
                                  value={activeChoice.eval_percent ?? ''}
                                  onChange={(event) =>
                                    updateChoice(activeChoice.choice_id, {
                                      eval_percent: event.target.value === '' ? null : Number(event.target.value),
                                    })
                                  }
                                />
                              </label>
                            </div>

                            <label className="mt-2 flex flex-col gap-1">
                              <span className="text-xs text-slate-600">explanation</span>
                              <textarea
                                ref={explanationRef}
                                className="min-h-[72px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                value={activeChoice.explanation ?? ''}
                                onFocus={() => setIsExplanationFocused(true)}
                                onBlur={() => setIsExplanationFocused(false)}
                                onChange={(event) => updateChoice(activeChoice.choice_id, { explanation: event.target.value })}
                              />
                            </label>

                            {isExplanationFocused ? (
                              <div className="mt-2 grid grid-cols-10 gap-1">
                                {EXPLANATION_HELPER_CHARS.map((char) => (
                                  <button
                                    key={char}
                                    type="button"
                                    className="h-8 rounded border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => insertExplanationChar(char)}
                                  >
                                    {char}
                                  </button>
                                ))}
                              </div>
                            ) : null}

                            <label className="mt-2 flex flex-col gap-1">
                              <span className="text-xs text-slate-600">line（1行1手）</span>
                              <textarea
                                className="min-h-[96px] rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                                value={activeChoice.line.join('\n')}
                                onChange={(event) =>
                                  updateChoice(activeChoice.choice_id, {
                                    line: event.target.value
                                      .split('\n')
                                      .map((item) => item.trim())
                                      .filter(Boolean),
                                  })
                                }
                              />
                            </label>

                            {lineErrors[activeChoice.choice_id] && !lineErrors[activeChoice.choice_id]?.ok ? (
                              <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">
                                <div className="font-semibold">読み筋失敗</div>
                                <div>
                                  <strong>エラー:</strong>{' '}
                                  {(lineErrors[activeChoice.choice_id] as Extract<ChoiceLineApplyResult, { ok: false }>).message}
                                </div>
                                {(lineErrors[activeChoice.choice_id] as Extract<ChoiceLineApplyResult, { ok: false }>).failedMove ? (
                                  <div>
                                    <strong>失敗した手:</strong>{' '}
                                    {(lineErrors[activeChoice.choice_id] as Extract<ChoiceLineApplyResult, { ok: false }>).failedMove}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                    <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-1">
                      <Field label="mode" value={detailDraft.mode} />
                      <Field label="status" value={detailDraft.status ?? '-'} />
                      <Field label="display_no" value={detailDraft.displayNo ?? '-'} />
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-1">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">correct_choice_id</span>
                        <input
                          className="h-9 rounded-lg border border-slate-300 px-3 text-sm"
                          type="number"
                          value={detailDraft.correctChoiceId}
                          onChange={(event) =>
                            setDetailDraft((current) =>
                              current
                                ? { ...current, correctChoiceId: Number(event.target.value || 1) }
                                : current,
                            )
                          }
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">root_eval_cp</span>
                        <input
                          className="h-9 rounded-lg border border-slate-300 px-3 text-sm"
                          type="number"
                          value={detailDraft.rootEvalCp ?? ''}
                          onChange={(event) =>
                            setDetailDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    rootEvalCp:
                                      event.target.value === '' ? null : Number(event.target.value),
                                  }
                                : current,
                            )
                          }
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">root_eval_percent</span>
                        <input
                          className="h-9 rounded-lg border border-slate-300 px-3 text-sm"
                          type="number"
                          value={detailDraft.rootEvalPercent ?? ''}
                          onChange={(event) =>
                            setDetailDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    rootEvalPercent:
                                      event.target.value === '' ? null : Number(event.target.value),
                                  }
                                : current,
                            )
                          }
                        />
                      </label>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-1">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">problem_rating</span>
                        <input
                          className="h-9 rounded-lg border border-slate-300 px-3 text-sm"
                          type="number"
                          value={detailDraft.problemRating ?? ''}
                          onChange={(event) =>
                            setDetailDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    problemRating:
                                      event.target.value === '' ? null : Number(event.target.value),
                                  }
                                : current,
                            )
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">problem_rating_games</span>
                        <input
                          className="h-9 rounded-lg border border-slate-300 px-3 text-sm"
                          type="number"
                          value={detailDraft.problemRatingGames ?? ''}
                          onChange={(event) =>
                            setDetailDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    problemRatingGames:
                                      event.target.value === '' ? null : Number(event.target.value),
                                  }
                                : current,
                            )
                          }
                        />
                      </label>
                    </div>

                    <label className="mt-3 flex flex-col gap-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">prompt</span>
                      <textarea
                        className="min-h-[72px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        value={detailDraft.prompt}
                        onChange={(event) =>
                          setDetailDraft((current) =>
                            current ? { ...current, prompt: event.target.value } : current,
                          )
                        }
                      />
                    </label>

                    <label className="mt-3 flex flex-col gap-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">root_sfen</span>
                      <textarea
                        className="min-h-[72px] rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                        value={detailDraft.rootSfen}
                        onChange={(event) =>
                          setDetailDraft((current) =>
                            current ? { ...current, rootSfen: event.target.value } : current,
                          )
                        }
                      />
                    </label>

                    <label className="mt-3 flex flex-col gap-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">intro_moves_usi（1行1手）</span>
                      <textarea
                        className="min-h-[72px] rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
                        value={detailDraft.introMovesUsi.join('\n')}
                        onChange={(event) =>
                          setDetailDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  introMovesUsi: event.target.value
                                    .split('\n')
                                    .map((item) => item.trim())
                                    .filter(Boolean),
                                }
                              : current,
                          )
                        }
                      />
                    </label>

                    <TagEditor
                      tags={detailDraft.tags}
                      onChange={(nextTags) =>
                        setDetailDraft((current) => (current ? { ...current, tags: nextTags } : current))
                      }
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-sky-200/80 bg-white/75 p-4 shadow-sm backdrop-blur-sm">
                <div className="mb-2 text-sm font-semibold text-slate-900">issue 一覧</div>
                {selectedIssues.length === 0 ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                    issue はありません。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedIssues.map((issue, index) => (
                      <div key={`${issue.rule_code}-${index}`} className={`rounded-lg border p-3 text-sm ${issueClass(issue.severity)}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold uppercase">{issue.severity}</span>
                          <span className="font-mono text-[11px] opacity-80">{issue.rule_code}</span>
                        </div>
                        <div className="mt-1 text-sm">{issue.message}</div>
                        <div className="mt-1 text-xs opacity-80">{issue.field_path}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

function TagEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const timerRef = useRef<number | null>(null);

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    if (tags.includes(tag)) {
      setDraft('');
      return;
    }
    onChange([...tags, tag]);
    setDraft('');
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((item) => item !== tag));
  };

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return TAG_OPTIONS.filter((option) => {
      if (tags.includes(option.value)) return false;
      if (!q) return true;
      return option.value.toLowerCase().includes(q) || option.label.toLowerCase().includes(q);
    }).slice(0, 20);
  }, [draft, tags]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">tags</div>
      <div className="flex flex-wrap gap-1">
        {tags.length === 0 ? <span className="text-xs text-slate-400">未設定</span> : null}
        {tags.map((tag) => {
          const known = TAG_OPTIONS.find((item) => item.value === tag);
          return (
            <button
              key={tag}
              type="button"
              className="rounded-full border border-sky-300 bg-sky-50 px-2 py-[2px] text-xs text-sky-700 hover:bg-sky-100"
              onClick={() => removeTag(tag)}
              title="クリックで削除"
            >
              {known ? `${known.label} (${known.value})` : tag} ×
            </button>
          );
        })}
      </div>

      <input
        className="h-9 rounded-lg border border-slate-300 px-3 text-sm"
        value={draft}
        list="production-tag-options"
        placeholder="タグを入力（Enterで追加）"
        onFocus={() => setFocused(true)}
        onBlur={() => {
          timerRef.current = window.setTimeout(() => setFocused(false), 120);
        }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            addTag(draft);
          }
        }}
      />
      <datalist id="production-tag-options">
        {TAG_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </datalist>

      {focused ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
          <div className="mb-1 text-xs text-slate-500">候補</div>
          <div className="flex flex-wrap gap-1">
            {filtered.length === 0 ? <span className="text-xs text-slate-400">候補なし</span> : null}
            {filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                className="rounded border border-slate-300 bg-white px-2 py-[2px] text-xs text-slate-700 hover:bg-slate-100"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addTag(option.value)}
              >
                {option.label} ({option.value})
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function productionItemKey(item: Pick<ProductionProblem, 'mode' | 'problemId'>): string {
  return `${item.mode}:${item.problemId}`;
}

function groupByProblemId(choices: ProductionChoice[]): Map<string, ProductionChoice[]> {
  const grouped = new Map<string, ProductionChoice[]>();
  for (const choice of choices) {
    const key = `${choice.mode}:${choice.problem_id}`;
    const current = grouped.get(key) ?? [];
    current.push(choice);
    grouped.set(key, current);
  }
  return grouped;
}

function Banner({ text, tone = 'info' }: { text: string; tone?: 'info' | 'error' | 'success' }) {
  const cls =
    tone === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-sky-200 bg-sky-50 text-sky-700';

  return <div className={`mb-2 rounded-lg border px-3 py-2 text-sm ${cls}`}>{text}</div>;
}

function cloneBoard(board: BoardType): BoardType {
  return board.map((row) => row.map((piece) => (piece ? { ...piece } : null)));
}

function cloneHand(hand: HandPieces): HandPieces {
  return { ...hand };
}

function createFullPieceBox(): Record<PieceType, number> {
  return { ...TOTAL_PIECES };
}

function isHandPieceType(type: PieceType): type is HandPieceType {
  return type !== 'K';
}

function rotatePieceVariant(piece: Piece): Piece {
  if (!CAN_PROMOTE[piece.type]) {
    return { ...piece, side: piece.side === 'sente' ? 'gote' : 'sente' };
  }
  if (!piece.promoted) {
    return { ...piece, promoted: true };
  }
  if (piece.side === 'sente') {
    return { ...piece, side: 'gote', promoted: false };
  }
  return { ...piece, side: 'sente', promoted: false };
}

function countPositionPieces(
  board: BoardType,
  senteHand: HandPieces,
  goteHand: HandPieces,
): Record<PieceType, number> {
  const counts = PIECE_TYPES.reduce((acc, type) => {
    acc[type] = 0;
    return acc;
  }, {} as Record<PieceType, number>);

  for (const row of board) {
    for (const piece of row) {
      if (piece) counts[piece.type] += 1;
    }
  }
  for (const type of HAND_PIECE_TYPES) {
    counts[type] += senteHand[type] + goteHand[type];
  }
  return counts;
}

function missingPieceCounts(
  board: BoardType,
  senteHand: HandPieces,
  goteHand: HandPieces,
): Record<PieceType, number> {
  const counts = countPositionPieces(board, senteHand, goteHand);
  return PIECE_TYPES.reduce((acc, type) => {
    acc[type] = Math.max(0, TOTAL_PIECES[type] - counts[type]);
    return acc;
  }, {} as Record<PieceType, number>);
}

function selectionMatchesBoard(selection: PieceSelection | null, row: number, col: number): boolean {
  return selection?.source === 'board' && selection.row === row && selection.col === col;
}

function BoardPreviewWithMoves({
  rootSfen,
  introMovesUsi,
  choice,
  editing,
  onEditingChange,
  onRootSfenChange,
}: {
  rootSfen: string;
  introMovesUsi: string[];
  choice: ProductionChoice | null;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onRootSfenChange: (nextRootSfen: string) => void;
}) {
  const moves = useMemo(() => {
    if (!choice) return introMovesUsi.slice();
    const head = choice.usi.trim() ? [choice.usi.trim()] : [];
    const lineMoves = choice.line.map((token) => token.trim()).filter(Boolean);
    return [...introMovesUsi, ...(lineMoves[0] === head[0] ? lineMoves : [...head, ...lineMoves])];
  }, [choice, introMovesUsi]);

  const states = useMemo(() => {
    try {
      const out: string[] = [rootSfen];
      let state = parseSfen(rootSfen);
      for (const move of moves) {
        const applied = applyUsiMove(state.board, state.senteHand, state.goteHand, state.sideToMove, move);
        state = {
          board: applied.board,
          senteHand: applied.senteHand,
          goteHand: applied.goteHand,
          sideToMove: state.sideToMove === 'sente' ? 'gote' : 'sente',
          moveNumber: state.moveNumber + 1,
        };
        out.push(boardToSfen(state.board, state.sideToMove, state.senteHand, state.goteHand, state.moveNumber));
      }
      return out;
    } catch {
      return [rootSfen];
    }
  }, [moves, rootSfen]);

  const [step, setStep] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => setStep(0), [choice?.choice_id, rootSfen]);
  const maxStep = Math.max(0, states.length - 1);
  const clamped = Math.max(0, Math.min(step, maxStep));

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-600">
          {editing ? 'root_sfen 編集中' : '読み筋プレビュー'}
        </div>
        <button
          type="button"
          className={`rounded-md border px-3 py-1 text-xs font-semibold ${
            editing
              ? 'border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
          onClick={() => onEditingChange(!editing)}
        >
          {editing ? 'プレビューへ戻る' : '編集'}
        </button>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
        {editing ? (
          <ProductionPositionEditor rootSfen={rootSfen} onChange={onRootSfenChange} />
        ) : (
          <ReviewPositionBoard sfen={states[clamped] ?? rootSfen} flipped={flipped} />
        )}
      </div>
      {editing ? null : (
        <>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              className="h-9 min-w-16 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={clamped <= 0}
            >
              前へ
            </button>
            <div className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
              step {clamped} / {maxStep}
            </div>
            <button
              type="button"
              className="h-9 min-w-16 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
              onClick={() => setStep((current) => Math.min(maxStep, current + 1))}
              disabled={clamped >= maxStep}
            >
              次へ
            </button>
          </div>
          <div className="mt-2 flex justify-between gap-2">
            <div className="truncate text-xs text-slate-500">
              {choice ? `choice ${choice.choice_id}: ${choice.usi || '-'}` : 'choice 未選択'}
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => setFlipped((current) => !current)}
            >
              盤面を反転
            </button>
          </div>
          <ol className="mt-2 max-h-[138px] list-decimal overflow-y-auto rounded-lg border border-slate-200 bg-white py-2 pl-7 pr-2 text-xs text-slate-700">
            {moves.map((move, index) => (
              <li key={`${move}-${index}`} className={index + 1 === clamped ? 'font-semibold text-sky-700' : ''}>
                {move}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function ProductionPositionEditor({
  rootSfen,
  onChange,
}: {
  rootSfen: string;
  onChange: (nextRootSfen: string) => void;
}) {
  const [selection, setSelection] = useState<PieceSelection | null>(null);

  const parsed = useMemo(() => {
    try {
      return parseSfen(rootSfen);
    } catch {
      return null;
    }
  }, [rootSfen]);

  useEffect(() => {
    setSelection(null);
  }, [rootSfen]);

  const rulePieceBox = useMemo(() => {
    if (!parsed) return createFullPieceBox();
    return missingPieceCounts(parsed.board, parsed.senteHand, parsed.goteHand);
  }, [parsed]);
  const rulePieceBoxTotal = useMemo(
    () => PIECE_TYPES.reduce((total, type) => total + rulePieceBox[type], 0),
    [rulePieceBox],
  );
  const selectedCell =
    selection?.source === 'board' ? { row: selection.row, col: selection.col } : null;
  const selectedHandPiece =
    selection?.source === 'hand' ? { side: selection.side, type: selection.type } : null;
  const selectedBoxType = selection?.source === 'box' ? selection.type : null;

  if (!parsed) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
        root_sfen を解析できないため編集できません。
      </div>
    );
  }

  const commitState = (next: {
    board: BoardType;
    sideToMove: Side;
    senteHand: HandPieces;
    goteHand: HandPieces;
    moveNumber: number;
  }) => {
    onChange(boardToSfen(next.board, next.sideToMove, next.senteHand, next.goteHand, next.moveNumber));
  };

  const updateSideToMove = (sideToMove: Side) => {
    setSelection(null);
    commitState({ ...parsed, sideToMove });
  };

  const removeSelectionFromState = (
    source: PieceSelection,
    board: BoardType,
    senteHand: HandPieces,
    goteHand: HandPieces,
  ) => {
    if (source.source === 'board') {
      board[source.row][source.col] = null;
      return;
    }
    if (source.source === 'hand') {
      const hand = source.side === 'sente' ? senteHand : goteHand;
      hand[source.type] = Math.max(0, hand[source.type] - 1);
    }
  };

  const handleCellClick = (row: number, col: number) => {
    const board = cloneBoard(parsed.board);
    const senteHand = cloneHand(parsed.senteHand);
    const goteHand = cloneHand(parsed.goteHand);

    if (!selection) {
      const piece = board[row][col];
      if (piece) {
        setSelection({ source: 'board', row, col, piece: { ...piece } });
      }
      return;
    }

    if (selectionMatchesBoard(selection, row, col)) {
      setSelection(null);
      return;
    }

    removeSelectionFromState(selection, board, senteHand, goteHand);
    board[row][col] = { ...selection.piece };
    setSelection(null);
    commitState({ ...parsed, board, senteHand, goteHand });
  };

  const handleCellDoubleClick = (row: number, col: number) => {
    const board = cloneBoard(parsed.board);
    const piece = board[row][col];
    if (!piece) return;
    board[row][col] = rotatePieceVariant(piece);
    setSelection(null);
    commitState({ ...parsed, board });
  };

  const handleHandPieceClick = (side: Side, clickedType: HandPieceType) => {
    const board = cloneBoard(parsed.board);
    const senteHand = cloneHand(parsed.senteHand);
    const goteHand = cloneHand(parsed.goteHand);
    const clickedHand = side === 'sente' ? senteHand : goteHand;

    if (!selection) {
      if (clickedHand[clickedType] > 0) {
        setSelection({
          source: 'hand',
          side,
          type: clickedType,
          piece: { type: clickedType, side, promoted: false },
        });
      }
      return;
    }

    if (!isHandPieceType(selection.piece.type)) return;
    if (selection.source === 'hand' && selection.side === side && selection.type === selection.piece.type) {
      setSelection(null);
      return;
    }

    removeSelectionFromState(selection, board, senteHand, goteHand);
    clickedHand[selection.piece.type] = Math.min(99, clickedHand[selection.piece.type] + 1);
    setSelection(null);
    commitState({ ...parsed, board, senteHand, goteHand });
  };

  const handlePieceBoxClick = (type: PieceType) => {
    if (rulePieceBox[type] <= 0) return;
    setSelection({
      source: 'box',
      type,
      piece: { type, side: 'sente', promoted: false },
    });
  };

  const handlePieceBoxReturnClick = () => {
    if (!selection || selection.source === 'box') {
      setSelection(null);
      return;
    }
    const board = cloneBoard(parsed.board);
    const senteHand = cloneHand(parsed.senteHand);
    const goteHand = cloneHand(parsed.goteHand);
    removeSelectionFromState(selection, board, senteHand, goteHand);
    setSelection(null);
    commitState({ ...parsed, board, senteHand, goteHand });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white/85 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[12px] font-semibold text-gray-600">手番</div>
          <div className="grid w-[184px] grid-cols-2 gap-1">
            {([
              ['sente', '先手'],
              ['gote', '後手'],
            ] as const).map(([side, label]) => (
              <button
                key={side}
                type="button"
                onClick={() => updateSideToMove(side)}
                className={`h-8 rounded border text-sm font-semibold ${
                  parsed.sideToMove === side
                    ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Board
          board={parsed.board}
          senteHand={parsed.senteHand}
          goteHand={parsed.goteHand}
          sideToMove={parsed.sideToMove}
          selectedCell={selectedCell}
          selectedHandPiece={selectedHandPiece}
          showAllHandPieces
          onCellClick={handleCellClick}
          onCellDoubleClick={handleCellDoubleClick}
          onHandPieceClick={handleHandPieceClick}
        />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white/85 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[12px] font-semibold text-gray-600">コマ箱</div>
          <div className="text-[12px] text-gray-500">{rulePieceBoxTotal}個</div>
        </div>
        {rulePieceBoxTotal === 0 ? (
          <div
            className="rounded border border-dashed border-gray-200 bg-gray-50 px-2 py-2 text-[12px] text-gray-500"
            onClick={handlePieceBoxReturnClick}
          >
            コマ箱はありません。
          </div>
        ) : (
          <div
            className="grid grid-cols-4 gap-2 sm:grid-cols-8"
            onClick={(event) => {
              if (event.target === event.currentTarget) handlePieceBoxReturnClick();
            }}
          >
            {PIECE_TYPES.filter((type) => rulePieceBox[type] > 0).map((type) => (
              <div
                key={type}
                role="button"
                tabIndex={0}
                onClick={() => handlePieceBoxClick(type)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handlePieceBoxClick(type);
                  }
                }}
                className={`min-h-[56px] cursor-pointer select-none rounded border p-2 text-center hover:bg-amber-100 ${
                  selectedBoxType === type
                    ? 'border-amber-500 bg-amber-200 ring-2 ring-amber-300'
                    : 'border-amber-200 bg-amber-50/80'
                }`}
              >
                <div className="text-[24px] font-bold leading-none text-amber-950">
                  {PIECE_KANJI[type]}
                </div>
                <div className="mt-1 text-[12px] font-semibold text-amber-800">x{rulePieceBox[type]}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewPositionBoard({ sfen, flipped }: { sfen: string; flipped: boolean }) {
  try {
    const state = parseSfen(sfen);
    const topSide: Side = flipped ? 'sente' : 'gote';
    const bottomSide: Side = flipped ? 'gote' : 'sente';
    const topHand = topSide === 'sente' ? state.senteHand : state.goteHand;
    const bottomHand = bottomSide === 'sente' ? state.senteHand : state.goteHand;
    const rowIndexes = flipped ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const colIndexes = flipped ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const fileLabels = flipped ? [...PREVIEW_FILE_LABELS].reverse() : PREVIEW_FILE_LABELS;
    const rankLabels = flipped ? [...PREVIEW_RANK_LABELS].reverse() : PREVIEW_RANK_LABELS;

    return (
      <div className="mx-auto flex w-full max-w-[410px] flex-col gap-2">
        <HandStrip side={topSide} hand={topHand} placement="top" />

        <div className="flex justify-center">
          <div className="grid grid-cols-[1fr_auto] gap-x-1">
            <div
              className="grid justify-items-center text-[11px] font-semibold text-slate-500"
              style={{ gridTemplateColumns: 'repeat(9, 32px)' }}
            >
              {fileLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div />

            <div
              className="grid overflow-hidden rounded-sm border-2 border-amber-800 bg-amber-200 shadow-sm"
              style={{
                gridTemplateColumns: 'repeat(9, 32px)',
                gridTemplateRows: 'repeat(9, 32px)',
              }}
            >
              {rowIndexes.map((row) =>
                colIndexes.map((col) => {
                  const cell = state.board[row][col];
                  return (
                    <div
                      key={`${row}-${col}`}
                      className="flex h-8 w-8 items-center justify-center border-r border-b border-amber-700/35 bg-[#e5c463] text-[20px] font-semibold leading-none text-slate-950"
                    >
                      {cell ? (
                        <span
                          className={cell.promoted ? 'text-rose-700' : ''}
                          style={{ transform: cell.side !== bottomSide ? 'rotate(180deg)' : undefined }}
                        >
                          {pieceKanji(cell)}
                        </span>
                      ) : null}
                    </div>
                  );
                }),
              )}
            </div>
            <div
              className="grid content-stretch justify-items-center text-[11px] font-semibold text-slate-500"
              style={{ gridTemplateRows: 'repeat(9, 32px)' }}
            >
              {rankLabels.map((label) => (
                <span key={label} className="flex h-8 items-center">
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <HandStrip side={bottomSide} hand={bottomHand} placement="bottom" />

        <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
          <span>手番</span>
          <span className="rounded-full bg-white px-2 py-[2px] font-semibold text-slate-700 ring-1 ring-slate-200">
            {sideName(state.sideToMove)}
          </span>
          <span>{state.moveNumber}手目</span>
        </div>
      </div>
    );
  } catch {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
        盤面を表示できません（root_sfen形式エラー）
      </div>
    );
  }
}

function HandStrip({
  side,
  hand,
  placement,
}: {
  side: Side;
  hand: HandPieces;
  placement: 'top' | 'bottom';
}) {
  const pieces = HAND_PIECE_TYPES.filter((type) => hand[type] > 0);

  return (
    <div
      className={`flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm ${
        placement === 'top' ? 'justify-start' : 'justify-end'
      }`}
    >
      <div className="shrink-0 text-xs font-semibold text-slate-500">{sideName(side)} 持ち駒</div>
      {pieces.length === 0 ? (
        <div className="text-xs text-slate-400">なし</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {pieces.map((type) => (
            <span
              key={type}
              className="inline-flex h-7 min-w-7 items-center justify-center rounded border border-amber-300 bg-amber-50 px-1.5 text-sm font-semibold text-slate-900"
            >
              {HAND_KANJI[type]}
              {hand[type] > 1 ? <span className="ml-0.5 text-[11px] font-bold">{hand[type]}</span> : null}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function sideName(side: Side): string {
  return side === 'sente' ? '先手' : '後手';
}

function Field({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-sm text-slate-900 ${mono ? 'break-all font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}

function QualityBadge({ summary }: { summary: ProductionValidationSummary }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-full px-2 text-[11px] font-semibold ${badgeClass(summary.status)}`}>
      {validationStatusLabel(summary.status)}
      {summary.status !== 'ok' ? (
        <span className="ml-1 font-normal opacity-75">
          E{summary.errorCount}/W{summary.warningCount}
        </span>
      ) : null}
    </span>
  );
}

function validationStatusLabel(status: ProductionValidationStatus): string {
  if (status === 'error') return 'エラー';
  if (status === 'warning') return '警告';
  return 'OK';
}

function badgeClass(status: ProductionValidationStatus): string {
  if (status === 'error') return 'bg-rose-100 text-rose-700';
  if (status === 'warning') return 'bg-amber-100 text-amber-700';
  return 'bg-emerald-100 text-emerald-700';
}

function issueClass(severity: ProductionValidationSeverity): string {
  if (severity === 'error') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-sky-200 bg-sky-50 text-sky-800';
}

function getProductionDetailValidationSummaryWithLineIssues(
  detail: ProductionProblemDetail,
): ProductionValidationSummary {
  return getProductionValidationSummaryWithLineIssues(detail, detail.choices);
}

function getProductionValidationSummaryWithLineIssues(
  problem: ProductionProblem,
  choices: ProductionChoice[],
): ProductionValidationSummary {
  const summary = getProductionValidationSummary(problem, choices);
  const lineIssues: ProductionValidationIssue[] = [];

  for (const choice of choices) {
    if (!problem.rootSfen.trim() || !choice.usi.trim()) continue;

    const result = validateChoiceLine(problem, choice);
    if (result.ok) continue;

    lineIssues.push({
      severity: 'error',
      rule_code: 'choice_line_apply_failed',
      field_path: `choices.${choice.choice_id}.line`,
      message: `choice ${choice.choice_id} の読み筋エラー: ${result.message}${
        result.failedMove ? ` (${result.failedMove})` : ''
      }`,
    });
  }

  if (lineIssues.length === 0) return summary;
  return summarizeProductionIssues([...summary.issues, ...lineIssues]);
}

function validateChoiceLine(problem: ProductionProblem, choice: ProductionChoice): ChoiceLineApplyResult {
  const usi = choice.usi.trim();
  if (!usi) {
    return { ok: false, message: 'choice usi が空です' };
  }

  const rawLine = choice.line.map((token) => token.trim()).filter(Boolean);
  const moves = rawLine.length > 0 && rawLine[0] === usi ? rawLine : [usi, ...rawLine];
  return validateAppliedMoves(problem.rootSfen, problem.introMovesUsi, moves);
}

function validateAppliedMoves(
  rootSfen: string,
  introMovesUsi: string[],
  moves: string[],
): ChoiceLineApplyResult {
  try {
    let state = parseSfen(rootSfen);
    const allMoves = [...introMovesUsi, ...moves];

    for (const token of allMoves) {
      const move = token.trim();
      if (!isValidUsiToken(move)) {
        return { ok: false, message: `USI形式が不正です: ${move}`, failedMove: move };
      }

      const currentSide: Side = state.sideToMove;
      if (!canApplyMove(state, currentSide, move)) {
        return { ok: false, message: '局面に適用できない手です', failedMove: move };
      }

      const applied = applyUsiMove(
        state.board,
        state.senteHand,
        state.goteHand,
        state.sideToMove,
        move,
      );
      state = {
        board: applied.board,
        senteHand: applied.senteHand,
        goteHand: applied.goteHand,
        sideToMove: state.sideToMove === 'sente' ? 'gote' : 'sente',
        moveNumber: state.moveNumber + 1,
      };
    }

    return { ok: true };
  } catch (error: any) {
    return { ok: false, message: error?.message ?? String(error) };
  }
}

function isValidUsiToken(token: string): boolean {
  return /^[1-9][a-i][1-9][a-i]\+?$/i.test(token) || /^[PLNSGBRK]\*[1-9][a-i]$/i.test(token);
}

function canApplyMove(
  state: ReturnType<typeof parseSfen>,
  side: Side,
  token: string,
): boolean {
  if (token[1] === '*') {
    const pieceType = token[0].toUpperCase() as HandPieceType;
    if (!['R', 'B', 'G', 'S', 'N', 'L', 'P'].includes(pieceType)) return false;
    const to = parseUsiSquareStrict(token.slice(2, 4));
    const boardPiece = state.board[to.row]?.[to.col] ?? null;
    if (boardPiece) return false;
    const hand = side === 'sente' ? state.senteHand : state.goteHand;
    return (hand[pieceType] ?? 0) > 0;
  }

  const from = parseUsiSquareStrict(token.slice(0, 2));
  const to = parseUsiSquareStrict(token.slice(2, 4));
  const fromPiece = state.board[from.row]?.[from.col] ?? null;
  if (!fromPiece || fromPiece.side !== side) return false;
  const toPiece = state.board[to.row]?.[to.col] ?? null;
  if (toPiece && toPiece.side === side) return false;
  return true;
}

function parseUsiSquareStrict(square: string): { row: number; col: number } {
  const file = Number.parseInt(square[0] ?? '', 10);
  const rank = square[1] ?? '';
  const row = rank.charCodeAt(0) - 'a'.charCodeAt(0);
  const col = 9 - file;

  if (!Number.isInteger(file) || file < 1 || file > 9 || row < 0 || row > 8 || col < 0 || col > 8) {
    throw new Error(`USI座標が不正です: ${square}`);
  }
  return { row, col };
}

export default ProductionReview;
