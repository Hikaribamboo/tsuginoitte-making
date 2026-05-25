import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../api/rpc';
import {
  cancelMakingJob,
  getMakingPathOptions,
  listMakingJobs,
  startMakingJob,
  type MakingJobSnapshot,
} from '../api/backend';
import { createWorkspace, listWorkspaces, saveWorkspaceDraft } from '../api/workspaces';

type SourceKind = 'kifs' | 'books';
type SlotKey = 'correct' | 'incorrect1' | 'incorrect2';

type ChoiceDraft = {
  slotLabel: SlotKey;
  usi: string;
  label: string;
  explanation: string;
  line: string[];
  eval_cp: number | null;
  eval_percent: number | null;
};

type WorkspaceDraft = {
  kifText: string;
  rootSfen: string;
  kifMoves: string[];
  introMoveUsi: string;
  choices: Record<SlotKey, ChoiceDraft>;
  readingLineInputs: Record<SlotKey, string>;
  prompt: string;
  tags: string[];
  displayNo: number | null;
  problemRating: number;
  rootEvalCp: number | null;
  rootEvalPercent: number | null;
  mode: 'next_move' | 'joseki';
  savedAt: string;
  sourceEngineJob?: Record<string, unknown>;
};

type BookFormState = {
  bookPath: string;
  bookType: 'petashock' | 'qhapaq';
  enginePath: string;
  count: string;
  depth: string;
  scanMode: 'sequential' | 'random';
  incorrectSelection: 'top' | 'bottom' | 'random' | 'mixed';
  minDiff: string;
  maxDiff: string;
};

type KifsFormState = {
  batchSize: string;
  maxProblemsPerGame: string;
  maxScanResultsPerGame: string;
  scanDepth: string;
  finalizeDepth: string;
  suspiciousMinDiff: string;
  suspiciousMaxDiff: string;
};

type ReviewProblemRow = {
  id: number;
  created_at: string;
  prompt: string;
  root_sfen: string;
  correct_choice_id: number;
  intro_moves_usi: string[];
  root_eval_cp: number | null;
  root_eval_percent: number | null;
};

type ReviewChoiceRow = {
  problem_id: number;
  choice_id: number;
  usi: string;
  label: string;
  explanation: string | null;
  line: string[];
  eval_cp: number | null;
  eval_percent: number | null;
};

const DEFAULT_BOOK_FORM: BookFormState = {
  bookPath: '',
  bookType: 'petashock',
  enginePath: '',
  count: '10',
  depth: '22',
  scanMode: 'random',
  incorrectSelection: 'mixed',
  minDiff: '100',
  maxDiff: '600',
};

const DEFAULT_KIFS_FORM: KifsFormState = {
  batchSize: '10',
  maxProblemsPerGame: '3',
  maxScanResultsPerGame: '12',
  scanDepth: '12',
  finalizeDepth: '22',
  suspiciousMinDiff: '500',
  suspiciousMaxDiff: '1600',
};

const MakingEngineCreator: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [bookForm, setBookForm] = useState<BookFormState>(DEFAULT_BOOK_FORM);
  const [kifsForm, setKifsForm] = useState<KifsFormState>(DEFAULT_KIFS_FORM);
  const [jobs, setJobs] = useState<MakingJobSnapshot[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [enginePathOptions, setEnginePathOptions] = useState<string[]>([]);
  const [bookPathOptions, setBookPathOptions] = useState<string[]>([]);
  const importedJobIdsRef = useRef<Set<string>>(new Set());
  const hydratedInitialJobsRef = useRef(false);

  const source = useMemo<SourceKind>(() => {
    const raw = searchParams.get('source');
    return raw === 'kifs' ? 'kifs' : 'books';
  }, [searchParams]);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );

  const refreshJobs = async () => {
    try {
      const rows = await listMakingJobs();
      if (!hydratedInitialJobsRef.current) {
        for (const row of rows) {
          if (row.status !== 'queued' && row.status !== 'running') {
            importedJobIdsRef.current.add(row.id);
          }
        }
        hydratedInitialJobsRef.current = true;
      }
      setJobs(rows);
      setSelectedJobId((current) => current ?? rows[0]?.id ?? null);
    } catch (nextError: any) {
      setError(nextError?.message ?? 'ジョブ一覧の取得に失敗しました');
    }
  };

  useEffect(() => {
    void refreshJobs();
    void (async () => {
      try {
        const options = await getMakingPathOptions();
        setEnginePathOptions(options.enginePaths);
        setBookPathOptions(options.bookPaths);
        setBookForm((prev) => ({
          ...prev,
          bookPath: prev.bookPath || options.bookPaths[0] || '',
          enginePath: prev.enginePath || options.enginePaths[0] || '',
        }));
      } catch (nextError: any) {
        setError(nextError?.message ?? 'パス候補の取得に失敗しました');
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedJob) return;
    if (selectedJob.status !== 'queued' && selectedJob.status !== 'running') return;

    const timer = window.setInterval(() => {
      void refreshJobs();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selectedJob]);

  useEffect(() => {
    if (!selectedJob) return;
    if (selectedJob.status !== 'completed') return;
    if (importedJobIdsRef.current.has(selectedJob.id)) return;

    importedJobIdsRef.current.add(selectedJob.id);
    void (async () => {
      try {
        if (selectedJob.kind === 'book') {
          const imported = await importBookJobResult(selectedJob);
          setMessage(`booksジョブ完了。${imported}件を下書き一覧に追加しました。`);
        } else {
          const imported = await importKifsJobResult(selectedJob);
          setMessage(`kifsジョブ完了。${imported}件を下書き一覧に追加しました。`);
        }
      } catch (nextError: any) {
        setError(nextError?.message ?? 'ジョブ完了後の取り込みに失敗しました');
      }
    })();
  }, [selectedJob]);

  const runJob = async () => {
    setStarting(true);
    setError('');
    setMessage('');
    try {
      if (source === 'books') {
        const payload = buildBookPayload(bookForm);
        const job = await startMakingJob(payload);
        setJobs((prev) => [job, ...prev.filter((item) => item.id !== job.id)]);
        setSelectedJobId(job.id);
      } else {
        const job = await startMakingJob({
          kind: 'kifs',
          settings: buildKifsPayload(kifsForm),
        });
        setJobs((prev) => [job, ...prev.filter((item) => item.id !== job.id)]);
        setSelectedJobId(job.id);
      }
    } catch (nextError: any) {
      setError(nextError?.message ?? 'ジョブの開始に失敗しました');
    } finally {
      setStarting(false);
    }
  };

  const runCancel = async () => {
    if (!selectedJob) return;
    try {
      const job = await cancelMakingJob(selectedJob.id);
      setJobs((prev) => [job, ...prev.filter((item) => item.id !== job.id)]);
      setSelectedJobId(job.id);
      setMessage(`ジョブ ${job.id} をキャンセルしました。`);
    } catch (nextError: any) {
      setError(nextError?.message ?? 'キャンセルに失敗しました');
    }
  };

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${source === 'books' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
          onClick={() => setSearchParams({ source: 'books' })}
        >
          booksから作問
        </button>
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${source === 'kifs' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
          onClick={() => setSearchParams({ source: 'kifs' })}
        >
          kifsから作問
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-base font-semibold text-slate-900">実行設定</h3>

          {source === 'books' ? (
            <BookSettingsForm
              value={bookForm}
              onChange={setBookForm}
              enginePathOptions={enginePathOptions}
              bookPathOptions={bookPathOptions}
            />
          ) : (
            <KifsSettingsForm value={kifsForm} onChange={setKifsForm} />
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              onClick={runJob}
              disabled={starting}
            >
              {starting ? '開始中...' : 'ジョブ開始'}
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => void refreshJobs()}
            >
              更新
            </button>
            <button
              type="button"
              className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
              onClick={runCancel}
              disabled={!selectedJob || (selectedJob.status !== 'queued' && selectedJob.status !== 'running')}
            >
              キャンセル
            </button>
          </div>
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
            {jobs.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                ジョブはまだありません。
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-base font-semibold text-slate-900">進捗詳細</h3>

        {selectedJob ? (
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-4">
              <Info label="job id" value={selectedJob.id} mono />
              <Info label="kind" value={selectedJob.kind} />
              <Info label="status" value={selectedJob.status} />
              <Info label="step" value={selectedJob.step} />
              <Info label="createdAt" value={formatDate(selectedJob.createdAt)} />
              <Info label="startedAt" value={selectedJob.startedAt ? formatDate(selectedJob.startedAt) : '-'} />
              <Info label="finishedAt" value={selectedJob.finishedAt ? formatDate(selectedJob.finishedAt) : '-'} />
              <Info label="error" value={selectedJob.error ?? '-'} />
            </div>

            {selectedJob.result?.notes && selectedJob.result.notes.length > 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                {selectedJob.result.notes.map((note, index) => (
                  <div key={`${note}-${index}`}>{note}</div>
                ))}
              </div>
            ) : null}

            <div className="rounded-lg border border-slate-200 bg-slate-950 p-3">
              <div className="mb-2 text-xs font-semibold text-slate-300">log</div>
              <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap font-mono text-xs leading-5 text-slate-100">
                {selectedJob.logs.length > 0 ? selectedJob.logs.join('\n') : '(no logs)'}
              </pre>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
            ジョブを選択してください。
          </div>
        )}
      </section>
    </div>
  );
};

function BookSettingsForm({
  value,
  onChange,
  enginePathOptions,
  bookPathOptions,
}: {
  value: BookFormState;
  onChange: React.Dispatch<React.SetStateAction<BookFormState>>;
  enginePathOptions: string[];
  bookPathOptions: string[];
}) {
  const update = <K extends keyof BookFormState>(key: K, next: BookFormState[K]) => {
    onChange((prev) => ({ ...prev, [key]: next }));
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <FieldSelect
        label="bookPath"
        value={value.bookPath}
        options={bookPathOptions}
        onChange={(next) => update('bookPath', next)}
      />
      <FieldSelect
        label="enginePath"
        value={value.enginePath}
        options={enginePathOptions}
        onChange={(next) => update('enginePath', next)}
      />

      <FieldSelect
        label="scanMode"
        value={value.scanMode}
        options={['sequential', 'random']}
        onChange={(next) => update('scanMode', next as BookFormState['scanMode'])}
      />

      <FieldInput label="count" value={value.count} onChange={(next) => update('count', next)} />
      <FieldInput label="depth" value={value.depth} onChange={(next) => update('depth', next)} />
      <FieldInput label="minDiff" value={value.minDiff} onChange={(next) => update('minDiff', next)} />
      <FieldInput label="maxDiff (optional)" value={value.maxDiff} onChange={(next) => update('maxDiff', next)} />
      <FieldSelect
        label="incorrectSelection"
        value={value.incorrectSelection}
        options={['top', 'bottom', 'random', 'mixed']}
        onChange={(next) => update('incorrectSelection', next as BookFormState['incorrectSelection'])}
      />
      <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        scanMode: book内の局面の走査方法（順番 or ランダム） / incorrectSelection: 不正解候補の選び方。
      </div>
    </div>
  );
}

function KifsSettingsForm({
  value,
  onChange,
}: {
  value: KifsFormState;
  onChange: React.Dispatch<React.SetStateAction<KifsFormState>>;
}) {
  const update = <K extends keyof KifsFormState>(key: K, next: KifsFormState[K]) => {
    onChange((prev) => ({ ...prev, [key]: next }));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 text-xs font-semibold text-slate-700">kifusから問題化（batchGenerate）</div>
        <div className="grid gap-2 md:grid-cols-2">
          <FieldInput label="count (claim件数)" value={value.batchSize} onChange={(next) => update('batchSize', next)} />
          <FieldInput label="maxProblemsPerGame" value={value.maxProblemsPerGame} onChange={(next) => update('maxProblemsPerGame', next)} />
          <FieldInput label="maxScanResultsPerGame" value={value.maxScanResultsPerGame} onChange={(next) => update('maxScanResultsPerGame', next)} />
          <FieldInput label="scanDepth" value={value.scanDepth} onChange={(next) => update('scanDepth', next)} />
          <FieldInput label="finalizeDepth" value={value.finalizeDepth} onChange={(next) => update('finalizeDepth', next)} />
          <FieldInput label="suspiciousMinDiff" value={value.suspiciousMinDiff} onChange={(next) => update('suspiciousMinDiff', next)} />
          <FieldInput label="suspiciousMaxDiff" value={value.suspiciousMaxDiff} onChange={(next) => update('suspiciousMaxDiff', next)} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        batchGenerate 完了後、ジョブ開始〜終了時刻の範囲で作成された review_next_move_problems を読み取り、
        下書き一覧に取り込みます。
      </div>
    </div>
  );
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
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function FieldSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-600">{label}</span>
      <select
        className="h-9 rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.length === 0 ? (
          <option value="">候補なし</option>
        ) : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Info({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-sm text-slate-900 ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
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

function parseRequiredInt(raw: string, label: string, min: number): number {
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < min) {
    throw new Error(`${label} は ${min} 以上の整数で指定してください`);
  }
  return parsed;
}

function parseOptionalInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new Error(`数値項目が不正です: ${raw}`);
  }
  return parsed;
}

function buildBookPayload(value: BookFormState) {
  const bookPath = value.bookPath.trim();
  const enginePath = value.enginePath.trim();
  if (!bookPath) throw new Error('bookPath は必須です');
  if (!enginePath) throw new Error('enginePath は必須です');
  if (enginePath.split('/').pop()?.startsWith('.')) {
    throw new Error('enginePath が不正です（隠しファイルは選択できません）');
  }

  return {
    kind: 'book' as const,
    settings: {
      bookPath,
      bookType: value.bookType,
      enginePath,
      count: parseRequiredInt(value.count, 'count', 1),
      depth: parseRequiredInt(value.depth, 'depth', 1),
      namePrefix: 'Book_問題',
      scanMode: value.scanMode,
      incorrectSource: 'book' as const,
      incorrectSelection: value.incorrectSelection,
      minDiff: parseRequiredInt(value.minDiff, 'minDiff', 1),
      maxDiff: parseOptionalInt(value.maxDiff),
      maxLineMoves: 12,
      minLineMoves: 4,
      randomSeed: null,
      limitScan: null,
      buildBookIndex: false,
      bookIndexFile: null,
      stateFile: null,
      verboseSkipLog: false,
    },
  };
}

function buildKifsPayload(value: KifsFormState) {
  return {
    runGenerateKifus: false,
    runBatchGenerate: true,
    batchSize: parseRequiredInt(value.batchSize, 'batchSize', 1),
    maxProblemsPerGame: parseRequiredInt(value.maxProblemsPerGame, 'maxProblemsPerGame', 1),
    maxScanResultsPerGame: parseRequiredInt(value.maxScanResultsPerGame, 'maxScanResultsPerGame', 1),
    scanDepth: parseRequiredInt(value.scanDepth, 'scanDepth', 1),
    finalizeDepth: parseRequiredInt(value.finalizeDepth, 'finalizeDepth', 1),
    suspiciousMinDiff: parseRequiredInt(value.suspiciousMinDiff, 'suspiciousMinDiff', 1),
    suspiciousMaxDiff: parseRequiredInt(value.suspiciousMaxDiff, 'suspiciousMaxDiff', 1),
  };
}

function getNextWorkspaceNumber(names: string[]): number {
  return names.reduce((maxNo, name) => {
    const match = name.match(/^#(\d+)\b/);
    if (!match) return maxNo;
    const num = Number.parseInt(match[1], 10);
    return Number.isNaN(num) ? maxNo : Math.max(maxNo, num);
  }, 0) + 1;
}

function buildAutoWorkspaceName(nextNumber: number, suffix: string) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `#${nextNumber} ${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} ${suffix}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP');
}

function emptyChoice(slot: SlotKey): ChoiceDraft {
  return {
    slotLabel: slot,
    usi: '',
    label: '',
    explanation: '',
    line: [],
    eval_cp: null,
    eval_percent: null,
  };
}

function toChoiceDraft(
  slot: SlotKey,
  source: Partial<{
    usi: unknown;
    label: unknown;
    explanation: unknown;
    line: unknown;
    eval_cp: unknown;
    eval_percent: unknown;
  }> | null | undefined,
): ChoiceDraft {
  const line = Array.isArray(source?.line)
    ? source!.line.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    slotLabel: slot,
    usi: typeof source?.usi === 'string' ? source.usi : '',
    label: typeof source?.label === 'string' ? source.label : '',
    explanation: typeof source?.explanation === 'string' ? source.explanation : '',
    line,
    eval_cp: typeof source?.eval_cp === 'number' ? source.eval_cp : null,
    eval_percent: typeof source?.eval_percent === 'number' ? source.eval_percent : null,
  };
}

function normalizeWorkspaceDraft(raw: Record<string, unknown>, modeFallback: 'next_move' | 'joseki'): WorkspaceDraft {
  const introMovesUsi = Array.isArray(raw.introMovesUsi)
    ? raw.introMovesUsi.filter((item): item is string => typeof item === 'string')
    : [];
  const introMoveUsi =
    typeof raw.introMoveUsi === 'string' ? raw.introMoveUsi : introMovesUsi[introMovesUsi.length - 1] ?? '';

  const rawChoices = raw.choices as Record<string, unknown> | undefined;

  return {
    kifText: typeof raw.kifText === 'string' ? raw.kifText : '',
    rootSfen: typeof raw.rootSfen === 'string' ? raw.rootSfen : '',
    kifMoves: Array.isArray(raw.kifMoves)
      ? raw.kifMoves.filter((item): item is string => typeof item === 'string')
      : introMovesUsi,
    introMoveUsi,
    choices: {
      correct: toChoiceDraft('correct', rawChoices?.correct as Record<string, unknown>),
      incorrect1: toChoiceDraft('incorrect1', rawChoices?.incorrect1 as Record<string, unknown>),
      incorrect2: toChoiceDraft('incorrect2', rawChoices?.incorrect2 as Record<string, unknown>),
    },
    readingLineInputs: {
      correct: '',
      incorrect1: '',
      incorrect2: '',
    },
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '最善手を選んでください',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((item): item is string => typeof item === 'string') : [],
    displayNo: typeof raw.displayNo === 'number' ? raw.displayNo : null,
    problemRating: typeof raw.problemRating === 'number' ? raw.problemRating : 1200,
    rootEvalCp: typeof raw.rootEvalCp === 'number' ? raw.rootEvalCp : null,
    rootEvalPercent: typeof raw.rootEvalPercent === 'number' ? raw.rootEvalPercent : null,
    mode: raw.mode === 'joseki' ? 'joseki' : modeFallback,
    savedAt: new Date().toISOString(),
  };
}

async function importBookJobResult(job: MakingJobSnapshot): Promise<number> {
  const records = job.result?.generatedRecords ?? [];
  if (records.length === 0) return 0;

  const workspaces = await listWorkspaces();
  let nextNo = getNextWorkspaceNumber(workspaces.map((workspace) => workspace.name));
  let importedCount = 0;

  for (const record of records) {
    const preferredName = record.name?.trim();
    let workspace;
    if (preferredName) {
      try {
        workspace = await createWorkspace(preferredName);
      } catch {
        workspace = await createWorkspace(buildAutoWorkspaceName(nextNo, 'books'));
        nextNo += 1;
      }
    } else {
      workspace = await createWorkspace(buildAutoWorkspaceName(nextNo, 'books'));
      nextNo += 1;
    }

    const draft = normalizeWorkspaceDraft(record.draft ?? {}, 'next_move');
    draft.sourceEngineJob = {
      kind: 'book',
      jobId: job.id,
      createdAt: job.createdAt,
    };
    await saveWorkspaceDraft(workspace.id, draft as unknown as Record<string, unknown>);
    importedCount += 1;
  }

  return importedCount;
}

async function importKifsJobResult(job: MakingJobSnapshot): Promise<number> {
  if (!job.result?.notes?.some((note) => note.includes('batchGenerate completed'))) {
    return 0;
  }
  if (!job.startedAt) return 0;

  const start = new Date(job.startedAt).getTime() - 2 * 60 * 1000;
  const endBase = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now();
  const end = endBase + 2 * 60 * 1000;
  const windowStart = new Date(start).toISOString();
  const windowEnd = new Date(end).toISOString();

  const { data: problemsData, error: problemsError } = await supabase
    .from('review_next_move_problems')
    .select('id, created_at, prompt, root_sfen, correct_choice_id, intro_moves_usi, root_eval_cp, root_eval_percent')
    .gte('created_at', windowStart)
    .lte('created_at', windowEnd)
    .order('id', { ascending: false })
    .limit(300);

  if (problemsError) throw problemsError;

  const problems = (problemsData ?? []) as ReviewProblemRow[];
  if (problems.length === 0) return 0;

  const problemIds = problems.map((problem) => problem.id);
  const { data: choicesData, error: choicesError } = await supabase
    .from('review_next_move_choices')
    .select('problem_id, choice_id, usi, label, explanation, line, eval_cp, eval_percent')
    .in('problem_id', problemIds)
    .order('problem_id', { ascending: true })
    .order('choice_id', { ascending: true });

  if (choicesError) throw choicesError;

  const grouped = new Map<number, ReviewChoiceRow[]>();
  for (const row of (choicesData ?? []) as ReviewChoiceRow[]) {
    const current = grouped.get(row.problem_id) ?? [];
    current.push(row);
    grouped.set(row.problem_id, current);
  }

  const workspaces = await listWorkspaces();
  let nextNo = getNextWorkspaceNumber(workspaces.map((workspace) => workspace.name));
  let importedCount = 0;

  for (const problem of problems.slice().reverse()) {
    const choices = grouped.get(problem.id) ?? [];
    const workspace = await createWorkspace(buildAutoWorkspaceName(nextNo, `kifs:${problem.id}`));
    nextNo += 1;

    const sortedChoices = choices.slice().sort((a, b) => a.choice_id - b.choice_id);
    const correct = sortedChoices.find((choice) => choice.choice_id === problem.correct_choice_id) ?? null;
    const incorrects = sortedChoices.filter((choice) => choice.choice_id !== problem.correct_choice_id);
    const introMovesUsi = Array.isArray(problem.intro_moves_usi) ? problem.intro_moves_usi : [];

    const draft: WorkspaceDraft = {
      kifText: '',
      rootSfen: problem.root_sfen ?? '',
      kifMoves: introMovesUsi,
      introMoveUsi: introMovesUsi[introMovesUsi.length - 1] ?? '',
      choices: {
        correct: toChoiceDraft('correct', correct),
        incorrect1: toChoiceDraft('incorrect1', incorrects[0]),
        incorrect2: toChoiceDraft('incorrect2', incorrects[1]),
      },
      readingLineInputs: {
        correct: '',
        incorrect1: '',
        incorrect2: '',
      },
      prompt: problem.prompt ?? '最善手を選んでください',
      tags: [],
      displayNo: null,
      problemRating: 1200,
      rootEvalCp: problem.root_eval_cp,
      rootEvalPercent: problem.root_eval_percent,
      mode: 'next_move',
      savedAt: new Date().toISOString(),
      sourceEngineJob: {
        kind: 'kifs',
        jobId: job.id,
        sourceReviewProblemId: problem.id,
      },
    };

    await saveWorkspaceDraft(workspace.id, draft as unknown as Record<string, unknown>);
    importedCount += 1;
  }

  return importedCount;
}

export default MakingEngineCreator;
