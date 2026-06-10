import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createBasePosition,
  createKifus,
  getKifuSummary,
  listBasePositions,
  type BasePosition,
  type KifuSummary,
} from '../api/kifus';
import {
  cancelMakingJob,
  listMakingJobs,
  startMakingJob,
  type MakingJobSnapshot,
} from '../api/backend';
import { parseKifRecord } from '../lib/kif-parser';
import { parseQuestKifuImport, type QuestKifuImportResult } from '../lib/quest-kifu-import';

type KifusGenerateFormState = {
  gamesPerBasePosition: string;
  maxMoves: string;
  totalGames: string;
};

type BasePositionFormState = {
  id: string;
  initialSfen: string;
  tagsText: string;
  note: string;
};

type QuestImportFormState = {
  username: string;
  requestedCount: string;
  text: string;
};

const DEFAULT_FORM: KifusGenerateFormState = {
  gamesPerBasePosition: '3',
  maxMoves: '180',
  totalGames: '30',
};

const DEFAULT_BASE_POSITION_FORM: BasePositionFormState = {
  id: '',
  initialSfen: '',
  tagsText: '',
  note: '',
};

const DEFAULT_QUEST_IMPORT_FORM: QuestImportFormState = {
  username: '',
  requestedCount: '',
  text: '',
};

const MakingKifusGenerator: React.FC = () => {
  const [form, setForm] = useState<KifusGenerateFormState>(DEFAULT_FORM);
  const [basePositionForm, setBasePositionForm] = useState<BasePositionFormState>(DEFAULT_BASE_POSITION_FORM);
  const [questImportForm, setQuestImportForm] = useState<QuestImportFormState>(DEFAULT_QUEST_IMPORT_FORM);
  const [basePositions, setBasePositions] = useState<BasePosition[]>([]);
  const [jobs, setJobs] = useState<MakingJobSnapshot[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [summary, setSummary] = useState<KifuSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [basePositionsLoading, setBasePositionsLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingBasePosition, setSavingBasePosition] = useState(false);
  const [questImporting, setQuestImporting] = useState(false);
  const [questImportResult, setQuestImportResult] = useState<QuestKifuImportResult | null>(null);
  const [questImportError, setQuestImportError] = useState('');
  const [questImportMessage, setQuestImportMessage] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );

  const refreshJobs = async () => {
    try {
      const rows = await listMakingJobs();
      setJobs(rows);
      setSelectedJobId((current) => current ?? rows[0]?.id ?? null);
    } catch (nextError: any) {
      setError(nextError?.message ?? 'ジョブ一覧の取得に失敗しました');
    }
  };

  const refreshSummary = async () => {
    try {
      setSummaryLoading(true);
      const nextSummary = await getKifuSummary();
      setSummary(nextSummary);
    } catch (nextError: any) {
      setError(nextError?.message ?? 'making_kifus集計の取得に失敗しました');
    } finally {
      setSummaryLoading(false);
    }
  };

  const refreshBasePositions = async () => {
    try {
      setBasePositionsLoading(true);
      const rows = await listBasePositions();
      setBasePositions(rows);
    } catch (nextError: any) {
      setError(nextError?.message ?? 'base position一覧の取得に失敗しました');
    } finally {
      setBasePositionsLoading(false);
    }
  };

  useEffect(() => {
    void refreshJobs();
    void refreshSummary();
    void refreshBasePositions();
  }, []);

  useEffect(() => {
    if (!selectedJob) return;
    if (selectedJob.status !== 'queued' && selectedJob.status !== 'running') return;

    const timer = window.setInterval(() => {
      void refreshJobs();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selectedJob]);

  const update = <K extends keyof KifusGenerateFormState>(key: K, value: KifusGenerateFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateBasePosition = <K extends keyof BasePositionFormState>(key: K, value: BasePositionFormState[K]) => {
    setBasePositionForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateQuestImport = <K extends keyof QuestImportFormState>(key: K, value: QuestImportFormState[K]) => {
    setQuestImportForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveBasePosition = async () => {
    setSavingBasePosition(true);
    setError('');
    setMessage('');
    try {
      const initialSfen = basePositionForm.initialSfen.trim();
      if (!isLikelySfen(initialSfen)) {
        throw new Error('initial_sfen は SFEN 4要素以上で指定してください');
      }

      const id = basePositionForm.id.trim() || createBasePositionId(initialSfen);
      const tags = parseTagsText(basePositionForm.tagsText);
      const saved = await createBasePosition({
        id,
        initialSfen,
        tags,
        note: basePositionForm.note,
        isActive: true,
      });

      setBasePositionForm(DEFAULT_BASE_POSITION_FORM);
      setBasePositions((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)]);
      setMessage(`base position ${saved.id} を登録しました`);
    } catch (nextError: any) {
      setError(nextError?.message ?? 'base position登録に失敗しました');
    } finally {
      setSavingBasePosition(false);
    }
  };

  const handleStart = async () => {
    setStarting(true);
    setError('');
    setMessage('');
    try {
      const job = await startMakingJob({
        kind: 'kifs',
        settings: {
          runGenerateKifus: true,
          runBatchGenerate: false,
          generateRunName: 'studio-kifs',
          gamesPerBasePosition: parseRequiredInt(form.gamesPerBasePosition, 'gamesPerBasePosition', 1),
          maxMoves: parseRequiredInt(form.maxMoves, 'maxMoves', 1),
          totalGames: parseRequiredInt(form.totalGames, 'totalGames', 1),
        },
      });
      setJobs((prev) => [job, ...prev.filter((item) => item.id !== job.id)]);
      setSelectedJobId(job.id);
      setMessage(`ジョブ ${job.id} を開始しました`);
    } catch (nextError: any) {
      setError(nextError?.message ?? 'ジョブ開始に失敗しました');
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedJob) return;
    try {
      const job = await cancelMakingJob(selectedJob.id);
      setJobs((prev) => [job, ...prev.filter((item) => item.id !== job.id)]);
      setSelectedJobId(job.id);
      setMessage(`ジョブ ${job.id} をキャンセルしました`);
    } catch (nextError: any) {
      setError(nextError?.message ?? 'キャンセルに失敗しました');
    }
  };

  const handleUploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError('');
    setMessage('');
    try {
      const files = Array.from(fileList);
      const parsedRows: Array<{ initialSfen: string; moves: string[] }> = [];
      let skipped = 0;

      for (const file of files) {
        const text = await file.text();
        const parsed = parseKifRecord(text);
        if (!parsed) {
          skipped += 1;
          continue;
        }
        const initial = extractInitialSfen(text, parsed.sfen);
        parsedRows.push({ initialSfen: initial, moves: parsed.moves });
      }

      if (parsedRows.length === 0) {
        throw new Error('有効な棋譜を1件も解析できませんでした');
      }

      const inserted = await createKifus(parsedRows);
      await refreshSummary();
      setMessage(`making_kifus に ${inserted} 件保存しました（スキップ: ${skipped} 件）`);
    } catch (nextError: any) {
      setError(nextError?.message ?? '棋譜アップロードに失敗しました');
    } finally {
      setUploading(false);
    }
  };

  const questImportPreview = useMemo(() => {
    if (!questImportForm.text.trim()) return null;
    return parseQuestKifuImport({
      text: questImportForm.text,
      username: questImportForm.username.trim() || null,
      requestedCount: parseOptionalInt(questImportForm.requestedCount),
    });
  }, [questImportForm.requestedCount, questImportForm.text, questImportForm.username]);

  const questImportDisplay = questImportPreview ?? questImportResult;

  const handleQuestImport = async () => {
    setQuestImporting(true);
    setQuestImportError('');
    setQuestImportMessage('');
    setError('');
    setMessage('');

    try {
      const parsed = parseQuestKifuImport({
        text: questImportForm.text,
        username: questImportForm.username.trim() || null,
        requestedCount: parseOptionalIntStrict(questImportForm.requestedCount),
      });

      if (parsed.rows.length === 0) {
        const firstError = parsed.errors[0]?.message ?? '有効な棋譜を1件も解析できませんでした';
        throw new Error(firstError);
      }

      const inserted = await createKifus(parsed.rows);
      await refreshSummary();
      setQuestImportResult(parsed);
      setQuestImportMessage(`将棋クエスト棋譜を ${parsed.records.length} 局解析し、${inserted} 件保存しました（失敗: ${parsed.errors.length} 件）`);
      setQuestImportForm((prev) => ({ ...prev, text: '' }));
    } catch (nextError: any) {
      setQuestImportError(nextError?.message ?? '将棋クエスト棋譜の取り込みに失敗しました');
    } finally {
      setQuestImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">kifs生成</h2>
            <div className="text-sm text-slate-600">自己対局でmaking_kifusを作成し、棋譜ファイルをmaking_kifusへ投入します。</div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link to="/making" className="rounded-md border border-slate-200 px-3 py-1.5 text-slate-700 hover:bg-slate-50">
              作問スタジオ
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            onClick={handleStart}
            disabled={starting}
          >
            {starting ? '開始中...' : 'kifs生成ジョブ開始'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => void refreshJobs()}
          >
            ジョブ更新
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => void refreshSummary()}
          >
            集計更新
          </button>
          <button
            type="button"
            className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
            onClick={handleCancel}
            disabled={!selectedJob || (selectedJob.status !== 'queued' && selectedJob.status !== 'running')}
          >
            キャンセル
          </button>
        </div>
      </section>

      {error ? <Banner tone="error" text={error} /> : null}
      {message ? <Banner tone="success" text={message} /> : null}

      <section className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-base font-semibold text-slate-900">kifs生成設定</h3>
            <div className="grid gap-2 md:grid-cols-2">
              <FieldInput label="gamesPerBasePosition" value={form.gamesPerBasePosition} onChange={(next) => update('gamesPerBasePosition', next)} />
              <FieldInput label="maxMoves" value={form.maxMoves} onChange={(next) => update('maxMoves', next)} />
              <FieldInput label="totalGames" value={form.totalGames} onChange={(next) => update('totalGames', next)} />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900">base position登録</h3>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => void refreshBasePositions()}
              >
                一覧更新
              </button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <FieldInput
                label="id"
                value={basePositionForm.id}
                onChange={(next) => updateBasePosition('id', next)}
                placeholder="未入力なら自動生成"
              />
              <FieldInput
                label="tags"
                value={basePositionForm.tagsText}
                onChange={(next) => updateBasePosition('tagsText', next)}
                placeholder="opening, ibisha"
              />
            </div>
            <label className="mt-2 flex flex-col gap-1">
              <span className="text-xs text-slate-600">initial_sfen</span>
              <textarea
                className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900"
                value={basePositionForm.initialSfen}
                onChange={(event) => updateBasePosition('initialSfen', event.target.value)}
              />
            </label>
            <label className="mt-2 flex flex-col gap-1">
              <span className="text-xs text-slate-600">note</span>
              <input
                className="h-9 rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
                value={basePositionForm.note}
                onChange={(event) => updateBasePosition('note', event.target.value)}
              />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                onClick={handleSaveBasePosition}
                disabled={savingBasePosition}
              >
                {savingBasePosition ? '登録中...' : 'base position登録'}
              </button>
              <span className="text-xs text-slate-500">
                登録済みの有効データは次回のkifs生成ジョブで使われます。
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-base font-semibold text-slate-900">棋譜アップロード</h3>
            <div className="flex flex-wrap items-center gap-2">
              <label className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
                単一/複数ファイルを選択
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => void handleUploadFiles(event.target.files)}
                  disabled={uploading}
                />
              </label>
              <label className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
                フォルダを選択
                <input
                  type="file"
                  multiple
                  className="hidden"
                  {...({ webkitdirectory: 'true', directory: 'true' } as any)}
                  onChange={(event) => void handleUploadFiles(event.target.files)}
                  disabled={uploading}
                />
              </label>
              {uploading ? <span className="text-sm text-slate-500">アップロード中...</span> : null}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              KIF / SFEN / `position sfen ... moves ...` を解析して `making_kifus` テーブルに保存します。
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-slate-900">将棋クエスト棋譜取り込み</h3>
                <div className="text-xs text-slate-500">貼り付けた棋譜をUSIへ正規化し、既存のmaking_kifus保存処理に流します。</div>
              </div>
              <button
                type="button"
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                onClick={() => void handleQuestImport()}
                disabled={questImporting}
              >
                {questImporting ? '取り込み中...' : '解析してDB保存'}
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <FieldInput
                label="将棋クエストのユーザー名"
                value={questImportForm.username}
                onChange={(next) => updateQuestImport('username', next)}
                placeholder="任意"
              />
              <FieldInput
                label="取得件数 / 参考件数"
                value={questImportForm.requestedCount}
                onChange={(next) => updateQuestImport('requestedCount', next)}
                placeholder="任意"
              />
            </div>

            <label className="mt-2 flex flex-col gap-1">
              <span className="text-xs text-slate-600">棋譜テキスト貼り付け</span>
              <textarea
                className="min-h-40 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900"
                value={questImportForm.text}
                onChange={(event) => updateQuestImport('text', event.target.value)}
                placeholder="将棋クエストの棋譜表示をそのまま貼り付けてください"
              />
            </label>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <QuestStatCard label="解析候補" value={questImportDisplay?.records.length ?? 0} />
              <QuestStatCard label="解析失敗" value={questImportDisplay?.errors.length ?? 0} />
              <QuestStatCard label="保存対象" value={questImportDisplay?.rows.length ?? 0} />
            </div>

            {questImportError ? <Banner tone="error" text={questImportError} /> : null}
            {questImportMessage ? <Banner tone="success" text={questImportMessage} /> : null}

            <div className="mt-3 space-y-3">
              <div>
                <div className="mb-1 text-sm font-semibold text-slate-800">取り込みプレビュー</div>
                {questImportDisplay && questImportDisplay.records.length > 0 ? (
                  <div className="space-y-2">
                    {questImportDisplay.records.slice(0, 3).map((record, index) => (
                      <div key={record.sourceRef} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-slate-900">局面 {index + 1}</div>
                          <div className="text-xs text-slate-500">{record.moves.length} 手 / {record.sourceRef}</div>
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-slate-600 break-all">{record.finalSfen}</div>
                        <div className="mt-2 grid gap-1 text-xs text-slate-600">
                          {record.steps.slice(0, 2).map((step) => (
                            <div key={`${record.sourceRef}-${step.ply}`} className="rounded bg-white px-2 py-1">
                              <span className="font-semibold text-slate-700">{step.ply}手目</span>
                              <span className="ml-2 font-mono">{step.label}</span>
                              <span className="ml-2 text-slate-500">{step.sideToMove === 'sente' ? '先手' : '後手'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">棋譜を貼り付けると、変換結果の概要を表示します。</div>
                )}
              </div>

              {questImportDisplay?.errors.length ? (
                <div>
                  <div className="mb-1 text-sm font-semibold text-slate-800">失敗した棋譜</div>
                  <div className="space-y-2">
                    {questImportDisplay.errors.map((item) => (
                      <div key={`${item.sourceRef}-${item.recordIndex}`} className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                        <div className="font-semibold">{item.sourceRef}</div>
                        <div>#{item.recordIndex} {item.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-2 text-xs text-slate-500">
              まずは貼り付け方式を優先しています。KIF形式の棋譜を将棋クエストから共有表示で取得できる場合は、そのまま貼り付けてください。
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-base font-semibold text-slate-900">making_kifusテーブル集計</h3>
            {summaryLoading ? (
              <div className="text-sm text-slate-500">集計中...</div>
            ) : !summary ? (
              <div className="text-sm text-slate-500">集計データがありません。</div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-slate-700">総件数: {summary.total.toLocaleString('ja-JP')}</div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {summary.statuses.map((item) => (
                    <div key={item.status} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <div className="text-xs text-slate-500">{item.status}</div>
                      <div className="text-sm font-semibold text-slate-900">{item.count.toLocaleString('ja-JP')}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="mb-1 text-sm text-slate-700">tag集計</div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {summary.tags.slice(0, 24).map((item) => (
                      <div key={item.tag} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <div className="text-xs text-slate-500">{item.tag}</div>
                        <div className="text-sm font-semibold text-slate-900">{item.count.toLocaleString('ja-JP')}</div>
                      </div>
                    ))}
                    {summary.tags.length === 0 ? (
                      <div className="text-xs text-slate-500">tagデータなし</div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-base font-semibold text-slate-900">登録済みbase positions</h3>
            {basePositionsLoading ? (
              <div className="text-sm text-slate-500">読み込み中...</div>
            ) : basePositions.length === 0 ? (
              <div className="text-sm text-slate-500">DB登録データはまだありません。</div>
            ) : (
              <div className="max-h-[260px] space-y-2 overflow-y-auto">
                {basePositions.slice(0, 50).map((base) => (
                  <div key={base.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-mono text-xs font-semibold text-slate-800">{base.id}</div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${base.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                        {base.is_active ? 'active' : 'inactive'}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 break-all font-mono text-[11px] text-slate-600">{base.initial_sfen}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {base.tags.map((tag) => (
                        <span key={tag} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-600">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-base font-semibold text-slate-900">ジョブ履歴</h3>
            <div className="max-h-[280px] space-y-2 overflow-y-auto">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  className={`w-full rounded-lg border px-3 py-2 text-left ${selectedJobId === job.id ? 'border-sky-400 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'}`}
                  onClick={() => setSelectedJobId(job.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-xs text-slate-700">{job.id}</div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${jobStatusClass(job.status)}`}>
                      {job.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    {job.kind} / {job.step}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

function parseRequiredInt(raw: string, label: string, min: number): number {
  const trimmed = raw.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!trimmed || !Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < min) {
    throw new Error(`${label} は ${min} 以上の整数で指定してください`);
  }
  return parsed;
}

function parseOptionalInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && !Number.isNaN(parsed) ? parsed : null;
}

function parseOptionalIntStrict(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new Error('取得件数は整数で指定してください');
  }
  return parsed;
}

function extractInitialSfen(sourceText: string, fallbackCurrentSfen: string): string {
  const singleLine = sourceText.replace(/\r\n?/g, '\n').trim().replace(/\s+/g, ' ');
  const embedded = singleLine.match(/position\s+sfen\s+(.+)$/i);
  let candidate = embedded?.[1] ?? singleLine;
  if (/^sfen\s+/i.test(candidate)) candidate = candidate.replace(/^sfen\s+/i, '');
  const split = candidate.split(/\s+moves\s+/i);
  const maybeSfen = split[0]?.trim();
  if (maybeSfen && maybeSfen.includes('/') && /\s[wb]\s/.test(` ${maybeSfen} `)) return maybeSfen;
  return fallbackCurrentSfen;
}

function isLikelySfen(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  return parts.length >= 4 && parts[0].includes('/') && (parts[1] === 'b' || parts[1] === 'w');
}

function parseTagsText(value: string): string[] {
  return value
    .split(/[,、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createBasePositionId(initialSfen: string): string {
  const seed = `${initialSfen}_${Date.now()}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `studio_${hash.toString(36)}`;
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-600">{label}</span>
      <input
        className="h-9 rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Banner({ text, tone = 'info' }: { text: string; tone?: 'info' | 'error' | 'success' }) {
  const cls =
    tone === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-sky-200 bg-sky-50 text-sky-700';

  return <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{text}</div>;
}

function QuestStatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value.toLocaleString('ja-JP')}</div>
    </div>
  );
}

function jobStatusClass(status: MakingJobSnapshot['status']): string {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700';
  if (status === 'failed') return 'bg-rose-100 text-rose-700';
  if (status === 'cancelled') return 'bg-slate-200 text-slate-700';
  if (status === 'running') return 'bg-sky-100 text-sky-700';
  return 'bg-amber-100 text-amber-700';
}

export default MakingKifusGenerator;
