import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createKifus, getKifuSummary, type KifuSummary } from '../api/kifus';
import {
  cancelMakingJob,
  listMakingJobs,
  startMakingJob,
  type MakingJobSnapshot,
} from '../api/making-jobs';
import { parseKifRecord } from '../lib/kif-parser';

type KifusGenerateFormState = {
  generateRunName: string;
  gamesPerBasePosition: string;
  maxMoves: string;
  blackNodes: string;
  whiteNodes: string;
  blackMovetimeMs: string;
  whiteMovetimeMs: string;
};

const DEFAULT_FORM: KifusGenerateFormState = {
  generateRunName: 'studio-kifs',
  gamesPerBasePosition: '3',
  maxMoves: '180',
  blackNodes: '1200',
  whiteNodes: '1200',
  blackMovetimeMs: '120',
  whiteMovetimeMs: '120',
};

const MakingKifusGenerator: React.FC = () => {
  const [form, setForm] = useState<KifusGenerateFormState>(DEFAULT_FORM);
  const [jobs, setJobs] = useState<MakingJobSnapshot[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [summary, setSummary] = useState<KifuSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [uploading, setUploading] = useState(false);
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
      setError(nextError?.message ?? 'kifus集計の取得に失敗しました');
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => {
    void refreshJobs();
    void refreshSummary();
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
          generateRunName: form.generateRunName.trim(),
          gamesPerBasePosition: parseRequiredInt(form.gamesPerBasePosition, 'gamesPerBasePosition', 1),
          maxMoves: parseRequiredInt(form.maxMoves, 'maxMoves', 1),
          blackNodes: parseRequiredInt(form.blackNodes, 'blackNodes', 1),
          whiteNodes: parseRequiredInt(form.whiteNodes, 'whiteNodes', 1),
          blackMovetimeMs: parseRequiredInt(form.blackMovetimeMs, 'blackMovetimeMs', 1),
          whiteMovetimeMs: parseRequiredInt(form.whiteMovetimeMs, 'whiteMovetimeMs', 1),
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
      setMessage(`kifus に ${inserted} 件保存しました（スキップ: ${skipped} 件）`);
    } catch (nextError: any) {
      setError(nextError?.message ?? '棋譜アップロードに失敗しました');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">kifs生成</h2>
            <div className="text-sm text-slate-600">自己対局でkifusを作成し、棋譜ファイルをkifusへ投入します。</div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link to="/making" className="rounded-md border border-slate-200 px-3 py-1.5 text-slate-700 hover:bg-slate-50">
              作問スタジオ
            </Link>
            <Link to="/making/engine?source=kifs" className="rounded-md border border-slate-200 px-3 py-1.5 text-slate-700 hover:bg-slate-50">
              kifsから作問
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
              <FieldInput label="runName" value={form.generateRunName} onChange={(next) => update('generateRunName', next)} />
              <FieldInput label="gamesPerBasePosition" value={form.gamesPerBasePosition} onChange={(next) => update('gamesPerBasePosition', next)} />
              <FieldInput label="maxMoves" value={form.maxMoves} onChange={(next) => update('maxMoves', next)} />
              <FieldInput label="blackNodes" value={form.blackNodes} onChange={(next) => update('blackNodes', next)} />
              <FieldInput label="whiteNodes" value={form.whiteNodes} onChange={(next) => update('whiteNodes', next)} />
              <FieldInput label="blackMovetimeMs" value={form.blackMovetimeMs} onChange={(next) => update('blackMovetimeMs', next)} />
              <FieldInput label="whiteMovetimeMs" value={form.whiteMovetimeMs} onChange={(next) => update('whiteMovetimeMs', next)} />
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
              KIF / SFEN / `position sfen ... moves ...` を解析して `kifus` テーブルに保存します。
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-base font-semibold text-slate-900">kifusテーブル集計</h3>
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
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
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

function FieldInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-600">{label}</span>
      <input
        className="h-9 rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
        value={value}
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

function jobStatusClass(status: MakingJobSnapshot['status']): string {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700';
  if (status === 'failed') return 'bg-rose-100 text-rose-700';
  if (status === 'cancelled') return 'bg-slate-200 text-slate-700';
  if (status === 'running') return 'bg-sky-100 text-sky-700';
  return 'bg-amber-100 text-amber-700';
}

export default MakingKifusGenerator;
