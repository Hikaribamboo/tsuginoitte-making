import React, { useEffect, useMemo, useState } from 'react';
import {
  getProductionProblemById,
  listProductionChoicesByProblemIds,
  listProductionProblems,
  updateProductionProblemById,
} from '../api/production';
import MiniBoard from '../components/MiniBoard';
import {
  getProductionDetailValidationSummary,
  getProductionValidationSummary,
  summarizeProductionIssues,
  type ProductionValidationSeverity,
  type ProductionValidationStatus,
  type ProductionValidationSummary,
} from '../lib/productionValidation';
import { applyUsiMove, parseSfen } from '../lib/sfen';
import type { HandPieceType, Side } from '../types/shogi';
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

const MODE_OPTIONS: Array<'all' | ProductionProblemMode> = ['all', 'next_move', 'joseki'];
const STATUS_OPTIONS: Array<'all' | string> = ['all', 'active', 'draft'];

const ProductionReview: React.FC = () => {
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveOkFlash, setSaveOkFlash] = useState(false);
  const [items, setItems] = useState<ProductionProblem[]>([]);
  const [itemSummaryMap, setItemSummaryMap] = useState<Record<number, ProductionValidationSummary>>({});
  const [selectedProblemId, setSelectedProblemId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProductionProblemDetail | null>(null);
  const [detailDraft, setDetailDraft] = useState<ProductionProblemDetail | null>(null);
  const [mode, setMode] = useState<'all' | ProductionProblemMode>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [selectedChoiceId, setSelectedChoiceId] = useState<number | null>(null);

  const loadList = async () => {
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
        return;
      }

      const choices = await listProductionChoicesByProblemIds(rows.map((row) => row.problemId));
      const groupedChoices = groupByProblemId(choices);
      const nextSummaryMap: Record<number, ProductionValidationSummary> = {};

      for (const row of rows) {
        nextSummaryMap[row.problemId] = getProductionValidationSummary(
          row,
          groupedChoices.get(row.problemId) ?? [],
        );
      }

      setItems(rows);
      setItemSummaryMap(nextSummaryMap);
      setSelectedProblemId((current) => {
        if (current != null && rows.some((row) => row.problemId === current)) return current;
        return rows[0].problemId;
      });
    } catch (nextError: any) {
      setListError(nextError?.message ?? '本番問題一覧の取得に失敗しました');
      setItems([]);
      setItemSummaryMap({});
      setSelectedProblemId(null);
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
      if (selectedProblemId == null) {
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
        const nextDetail = await getProductionProblemById(selectedProblemId);
        if (!cancelled) {
          setDetail(nextDetail);
          setDetailDraft(nextDetail);
          setSelectedChoiceId(nextDetail.choices[0]?.choice_id ?? null);
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
  }, [selectedProblemId]);

  const selectedRow = useMemo(
    () => items.find((item) => item.problemId === selectedProblemId) ?? null,
    [items, selectedProblemId],
  );

  const selectedSummary = useMemo(() => {
    if (detailDraft) return getProductionDetailValidationSummary(detailDraft);
    if (selectedRow) return itemSummaryMap[selectedRow.problemId] ?? summarizeProductionIssues([]);
    return summarizeProductionIssues([]);
  }, [detailDraft, itemSummaryMap, selectedRow]);

  const selectedIssues = selectedSummary.issues;
  const activeChoice =
    detailDraft?.choices.find((choice) => choice.choice_id === selectedChoiceId)
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

  const handleSave = async () => {
    if (!detailDraft) return;
    setSaving(true);
    setSaveError('');
    setSaveOkFlash(false);
    try {
      const updated = await updateProductionProblemById(
        detailDraft.problemId,
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

  return (
    <div className="h-[calc(100vh-106px)] min-h-[680px] overflow-hidden rounded-xl border border-sky-200/80 bg-gradient-to-b from-sky-50 via-blue-50 to-slate-50 shadow-sm">
      <div className="flex h-full">
        <aside className="w-[250px] shrink-0 border-r border-sky-200/80 bg-white/75 backdrop-blur-sm">
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
                  const selected = item.problemId === selectedProblemId;
                  const summary = itemSummaryMap[item.problemId] ?? summarizeProductionIssues([]);

                  return (
                    <button
                      key={item.problemId}
                      type="button"
                      onClick={() => setSelectedProblemId(item.problemId)}
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

        <main className="flex-1 overflow-y-auto p-4">
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
                      className="h-9 rounded-lg border border-sky-500 bg-sky-500 px-4 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
                      onClick={handleSave}
                      disabled={saving}
                    >
                      {saving ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">board preview</div>
                    <SafeMiniBoard sfen={detailDraft.rootSfen} />
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                    <div className="grid gap-2 md:grid-cols-3">
                      <Field label="mode" value={detailDraft.mode} />
                      <Field label="status" value={detailDraft.status ?? '-'} />
                      <Field label="display_no" value={detailDraft.displayNo ?? '-'} />
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-3">
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

                    <div className="mt-3 grid gap-2 md:grid-cols-2">
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

                    <label className="mt-3 flex flex-col gap-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">tags（改行区切り）</span>
                      <textarea
                        className="min-h-[72px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        value={detailDraft.tags.join('\n')}
                        onChange={(event) =>
                          setDetailDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  tags: event.target.value
                                    .split('\n')
                                    .map((item) => item.trim())
                                    .filter(Boolean),
                                }
                              : current,
                          )
                        }
                      />
                    </label>
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

              <section className="rounded-xl border border-sky-200/80 bg-white/75 p-4 shadow-sm backdrop-blur-sm">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-900">盤面 / 選択肢</div>
                  <div className="flex gap-2">
                    {detailDraft.choices.slice().sort((a, b) => a.choice_id - b.choice_id).map((choice) => (
                      <button
                        key={choice.choice_id}
                        type="button"
                        className={`rounded-md border px-2 py-1 text-xs ${selectedChoiceId === choice.choice_id ? 'border-sky-500 bg-sky-100 text-sky-800' : 'border-slate-300 bg-white text-slate-700'}`}
                        onClick={() => setSelectedChoiceId(choice.choice_id)}
                      >
                        choice {choice.choice_id}
                      </button>
                    ))}
                  </div>
                </div>
                {!activeChoice ? (
                  <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">choice がありません。</div>
                ) : (
                  <div className="grid gap-3 xl:grid-cols-[360px_1fr]">
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">board preview</div>
                      <BoardPreviewWithMoves
                        rootSfen={detailDraft.rootSfen}
                        introMovesUsi={detailDraft.introMovesUsi}
                        choice={activeChoice}
                      />
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="mb-2 text-sm font-semibold text-slate-900">choice {activeChoice.choice_id}</div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-slate-600">label</span>
                          <input className="h-9 rounded-lg border border-slate-300 px-3 text-sm" value={activeChoice.label} onChange={(event) => updateChoice(activeChoice.choice_id, { label: event.target.value })} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-slate-600">usi</span>
                          <input className="h-9 rounded-lg border border-slate-300 px-3 font-mono text-sm" value={activeChoice.usi} onChange={(event) => updateChoice(activeChoice.choice_id, { usi: event.target.value })} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-slate-600">eval_cp</span>
                          <input className="h-9 rounded-lg border border-slate-300 px-3 text-sm" type="number" value={activeChoice.eval_cp ?? ''} onChange={(event) => updateChoice(activeChoice.choice_id, { eval_cp: event.target.value === '' ? null : Number(event.target.value) })} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-slate-600">eval_percent</span>
                          <input className="h-9 rounded-lg border border-slate-300 px-3 text-sm" type="number" value={activeChoice.eval_percent ?? ''} onChange={(event) => updateChoice(activeChoice.choice_id, { eval_percent: event.target.value === '' ? null : Number(event.target.value) })} />
                        </label>
                      </div>
                      <label className="mt-2 flex flex-col gap-1">
                        <span className="text-xs text-slate-600">explanation</span>
                        <textarea className="min-h-[72px] rounded-lg border border-slate-300 px-3 py-2 text-sm" value={activeChoice.explanation ?? ''} onChange={(event) => updateChoice(activeChoice.choice_id, { explanation: event.target.value })} />
                      </label>
                      <label className="mt-2 flex flex-col gap-1">
                        <span className="text-xs text-slate-600">line（1行1手）</span>
                        <textarea className="min-h-[96px] rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs" value={activeChoice.line.join('\n')} onChange={(event) => updateChoice(activeChoice.choice_id, { line: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} />
                      </label>
                      {lineErrors[activeChoice.choice_id] && !lineErrors[activeChoice.choice_id]?.ok ? (
                        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">
                          <div className="font-semibold">読み筋失敗</div>
                          <div><strong>エラー:</strong> {(lineErrors[activeChoice.choice_id] as Extract<ChoiceLineApplyResult, { ok: false }>).message}</div>
                          {(lineErrors[activeChoice.choice_id] as Extract<ChoiceLineApplyResult, { ok: false }>).failedMove ? <div><strong>失敗した手:</strong> {(lineErrors[activeChoice.choice_id] as Extract<ChoiceLineApplyResult, { ok: false }>).failedMove}</div> : null}
                        </div>
                      ) : null}
                    </div>
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

function groupByProblemId(choices: ProductionChoice[]): Map<number, ProductionChoice[]> {
  const grouped = new Map<number, ProductionChoice[]>();
  for (const choice of choices) {
    const current = grouped.get(choice.problem_id) ?? [];
    current.push(choice);
    grouped.set(choice.problem_id, current);
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

function SafeMiniBoard({ sfen }: { sfen: string }) {
  try {
    parseSfen(sfen);
    return <MiniBoard sfen={sfen} size={22} />;
  } catch {
    return <div className="text-xs text-rose-600">盤面を表示できません（root_sfen形式エラー）</div>;
  }
}

function BoardPreviewWithMoves({
  rootSfen,
  introMovesUsi,
  choice,
}: {
  rootSfen: string;
  introMovesUsi: string[];
  choice: ProductionChoice;
}) {
  const moves = useMemo(() => {
    const head = choice.usi.trim() ? [choice.usi.trim()] : [];
    const lineMoves = choice.line.map((token) => token.trim()).filter(Boolean);
    return [...introMovesUsi, ...(lineMoves[0] === head[0] ? lineMoves : [...head, ...lineMoves])];
  }, [choice.line, choice.usi, introMovesUsi]);

  const states = useMemo(() => {
    try {
      const out: string[] = [rootSfen];
      let state = parseSfen(rootSfen);
      for (const move of moves) {
        const applied = applyUsiMove(state.board, state.senteHand, state.goteHand, state.sideToMove, move);
        const nextSide: Side = state.sideToMove === 'sente' ? 'gote' : 'sente';
        state = {
          board: applied.board,
          senteHand: applied.senteHand,
          goteHand: applied.goteHand,
          sideToMove: nextSide,
          moveNumber: state.moveNumber + 1,
        };
        out.push(boardToSfenSafe(state));
      }
      return out;
    } catch {
      return [rootSfen];
    }
  }, [moves, rootSfen]);

  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [choice.choice_id, rootSfen]);
  const maxStep = Math.max(0, states.length - 1);
  const clamped = Math.max(0, Math.min(step, maxStep));

  return (
    <div>
      <SafeMiniBoard sfen={states[clamped] ?? rootSfen} />
      <div className="mt-2 flex items-center justify-between gap-2">
        <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={clamped <= 0}>前へ</button>
        <div className="text-xs text-slate-600">step {clamped} / {maxStep}</div>
        <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={() => setStep((current) => Math.min(maxStep, current + 1))} disabled={clamped >= maxStep}>次へ</button>
      </div>
      <ol className="mt-2 max-h-[180px] list-decimal overflow-y-auto pl-5 text-xs text-slate-700">
        {moves.map((move, index) => (
          <li key={`${move}-${index}`} className={index + 1 === clamped ? 'font-semibold text-sky-700' : ''}>
            {move}
          </li>
        ))}
      </ol>
    </div>
  );
}

function boardToSfenSafe(state: ReturnType<typeof parseSfen>): string {
  const rank = (row: number) => {
    let out = '';
    let empties = 0;
    for (let col = 0; col < 9; col++) {
      const piece = state.board[row][col];
      if (!piece) {
        empties += 1;
        continue;
      }
      if (empties > 0) {
        out += String(empties);
        empties = 0;
      }
      const base = piece.type === 'K' ? 'K' : piece.type;
      const mark = piece.side === 'gote' ? base.toLowerCase() : base.toUpperCase();
      out += piece.promoted ? `+${mark}` : mark;
    }
    if (empties > 0) out += String(empties);
    return out;
  };

  const boardPart = Array.from({ length: 9 }, (_, i) => rank(i)).join('/');
  const side = state.sideToMove === 'sente' ? 'b' : 'w';
  return `${boardPart} ${side} - ${Math.max(1, state.moveNumber)}`;
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
  if (status === 'error') return 'エラーあり';
  if (status === 'warning') return '警告あり';
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

function validateChoiceLine(problem: ProductionProblemDetail, choice: ProductionChoice): ChoiceLineApplyResult {
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
