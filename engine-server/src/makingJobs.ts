import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { runBookProblemJob } from './features/book-problem-generation/bookProblem.service.js';
import { runKifProblemJob } from './features/kif-problem-generation/kifProblem.service.js';
import { runKifsGenerationJob } from './features/kifs-generation/kifsGeneration.service.js';

type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
type JobKind = 'book' | 'kifs';

type BookJobInput = {
  kind: 'book';
  settings?: {
    bookPath?: string;
    bookType?: 'petashock' | 'qhapaq';
    enginePath?: string;
    count?: number;
    depth?: number;
    namePrefix?: string;
    scanMode?: 'sequential' | 'random';
    incorrectSource?: 'book' | 'legal';
    incorrectSelection?: 'top' | 'bottom' | 'random' | 'mixed';
    minDiff?: number;
    maxDiff?: number | null;
    maxLineMoves?: number;
    minLineMoves?: number;
    randomSeed?: number | null;
    limitScan?: number | null;
    buildBookIndex?: boolean;
    bookIndexFile?: string | null;
    stateFile?: string | null;
    verboseSkipLog?: boolean;
  };
};

type KifsJobInput = {
  kind: 'kifs';
  settings?: {
    runGenerateKifus?: boolean;
    runBatchGenerate?: boolean;
    generateRunName?: string;
    gamesPerBasePosition?: number;
    totalGames?: number;
    maxMoves?: number;
    blackNodes?: number;
    whiteNodes?: number;
    blackMovetimeMs?: number;
    whiteMovetimeMs?: number;
    batchSize?: number;
    maxProblemsPerGame?: number;
    maxScanResultsPerGame?: number;
    scanDepth?: number;
    finalizeDepth?: number;
    suspiciousMinDiff?: number;
    suspiciousMaxDiff?: number;
  };
};

type JobInput = BookJobInput | KifsJobInput;

type JobResult = {
  createdCount?: number;
  generatedRecords?: Array<{ name: string; draft: Record<string, unknown> }>;
  notes?: string[];
};

type JobRecord = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  step: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  logs: string[];
  result: JobResult | null;
  error: string | null;
  child: ChildProcess | null;
};

export type JobSnapshot = Omit<JobRecord, 'child'>;

const jobs = new Map<string, JobRecord>();
const LOG_LIMIT = 800;
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const DRAFT_MAKING_DIR = path.join(REPO_ROOT, 'python', 'book-maker');

function toSnapshot(job: JobRecord): JobSnapshot {
  const { child: _child, ...snapshot } = job;
  return snapshot;
}

function makeJobId(): string {
  return `mk-${Date.now()}-${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`;
}

function appendLog(job: JobRecord, line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  job.logs.push(trimmed);
  if (job.logs.length > LOG_LIMIT) {
    job.logs.splice(0, job.logs.length - LOG_LIMIT);
  }
}

function setStep(job: JobRecord, step: string): void {
  job.step = step;
  appendLog(job, `[step] ${step}`);
}

function parseJobInput(input: unknown): JobInput {
  if (!input || typeof input !== 'object') {
    throw new Error('invalid request body');
  }
  const kind = (input as { kind?: unknown }).kind;
  if (kind !== 'book' && kind !== 'kifs') {
    throw new Error('invalid kind');
  }
  return input as JobInput;
}

function parseBookJobSettings(input: BookJobInput['settings']) {
  const bookType: 'petashock' | 'qhapaq' = input?.bookType === 'qhapaq' ? 'qhapaq' : 'petashock';
  const scanMode: 'sequential' | 'random' = input?.scanMode === 'random' ? 'random' : 'sequential';
  const incorrectSource: 'book' | 'legal' = input?.incorrectSource === 'legal' ? 'legal' : 'book';
  const incorrectSelection = input?.incorrectSelection ?? 'mixed';
  const maxDiff =
    typeof input?.maxDiff === 'number' && Number.isFinite(input.maxDiff) ? Math.trunc(input.maxDiff) : null;
  const randomSeed =
    typeof input?.randomSeed === 'number' && Number.isFinite(input.randomSeed) ? Math.trunc(input.randomSeed) : null;
  const limitScan =
    typeof input?.limitScan === 'number' && Number.isFinite(input.limitScan) ? Math.trunc(input.limitScan) : null;
  const buildBookIndex = input?.buildBookIndex === true;

  return {
    bookPath: input?.bookPath?.trim() || '',
    bookType,
    enginePath: input?.enginePath?.trim() || '',
    count: Number.isFinite(input?.count) ? Math.max(1, Math.trunc(input!.count!)) : 10,
    depth: Number.isFinite(input?.depth) ? Math.max(1, Math.trunc(input!.depth!)) : 22,
    namePrefix: input?.namePrefix?.trim() || (bookType === 'qhapaq' ? 'Qhapaq_問題' : 'PetaShock_問題'),
    scanMode,
    incorrectSource,
    incorrectSelection,
    minDiff: Number.isFinite(input?.minDiff) ? Math.max(1, Math.trunc(input!.minDiff!)) : 100,
    maxDiff,
    maxLineMoves: Number.isFinite(input?.maxLineMoves) ? Math.max(1, Math.trunc(input!.maxLineMoves!)) : 12,
    minLineMoves: Number.isFinite(input?.minLineMoves) ? Math.max(1, Math.trunc(input!.minLineMoves!)) : 4,
    randomSeed,
    limitScan,
    buildBookIndex,
    bookIndexFile: input?.bookIndexFile?.trim() || null,
    stateFile: input?.stateFile?.trim() || null,
    verboseSkipLog: input?.verboseSkipLog === true,
  };
}

function parseKifsJobSettings(input: KifsJobInput['settings']) {
  const numberOrNull = (value: unknown, min: number, max: number): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const n = Math.trunc(value);
    if (n < min || n > max) return null;
    return n;
  };

  return {
    runGenerateKifus: input?.runGenerateKifus === true,
    runBatchGenerate: input?.runBatchGenerate !== false,
    generateRunName: input?.generateRunName?.trim() || null,
    gamesPerBasePosition: numberOrNull(input?.gamesPerBasePosition, 1, 10000),
    totalGames: numberOrNull(input?.totalGames, 1, 1000000),
    maxMoves: numberOrNull(input?.maxMoves, 1, 2000),
    blackNodes: numberOrNull(input?.blackNodes, 1, 1000000000),
    whiteNodes: numberOrNull(input?.whiteNodes, 1, 1000000000),
    blackMovetimeMs: numberOrNull(input?.blackMovetimeMs, 1, 3600000),
    whiteMovetimeMs: numberOrNull(input?.whiteMovetimeMs, 1, 3600000),
    batchSize: numberOrNull(input?.batchSize, 1, 5000),
    maxProblemsPerGame: numberOrNull(input?.maxProblemsPerGame, 1, 50),
    maxScanResultsPerGame: numberOrNull(input?.maxScanResultsPerGame, 1, 200),
    scanDepth: numberOrNull(input?.scanDepth, 1, 50),
    finalizeDepth: numberOrNull(input?.finalizeDepth, 1, 80),
    suspiciousMinDiff: numberOrNull(input?.suspiciousMinDiff, 1, 10000),
    suspiciousMaxDiff: numberOrNull(input?.suspiciousMaxDiff, 1, 10000),
  };
}

function isCancelled(job: JobRecord): boolean {
  return job.status === 'cancelled';
}

async function runCommand(
  job: JobRecord,
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const shell = process.platform === 'win32';
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
    const diagnosticEnv = [
      'ENGINE_PATH',
      'EVAL_DIR',
      'BOOK_PATH',
      'BOOK_INDEX_FILE',
      'STATE_FILE',
      'AMTS_BATCH_SIZE',
      'AMTS_MAX_PROBLEMS_PER_GAME',
      'AMTS_MAX_SCAN_RESULTS_PER_GAME',
      'AMTS_SCAN_DEPTH',
      'AMTS_FINALIZE_DEPTH',
      'AMTS_SUSPICIOUS_MIN_DIFF',
      'AMTS_SUSPICIOUS_MAX_DIFF',
    ]
      .map((key) => `${key}=${env[key] ?? '(unset)'}`)
      .join(' ');

    appendLog(job, `[command] platform=${process.platform} shell=${shell ? 'true' : 'false'}`);
    appendLog(job, `[command] cwd=${cwd} exists=${existsSync(cwd)}`);
    appendLog(job, `[command] cmd=${cmd} exists=${existsSync(cmd)}`);
    appendLog(job, `[command] args=${JSON.stringify(args)}`);
    appendLog(job, `[command] pathKey=${pathKey} pathSet=${env[pathKey] ? 'true' : 'false'}`);
    appendLog(job, `[command] env ${diagnosticEnv}`);

    let child: ChildProcess;
    try {
      child = spawn(cmd, args, { cwd, env, shell, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    job.child = child;

    let stdoutBuffer = '';
    let stderrBuffer = '';

    const flushLines = (buffer: string, source: 'stdout' | 'stderr') => {
      const lines = buffer.split(/\r?\n/);
      const rest = lines.pop() ?? '';
      for (const line of lines) {
        appendLog(job, `[${source}] ${line}`);
      }
      return rest;
    };

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      stdoutBuffer = flushLines(stdoutBuffer, 'stdout');
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
      stderrBuffer = flushLines(stderrBuffer, 'stderr');
    });

    child.on('error', (error) => {
      job.child = null;
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (stdoutBuffer.trim()) {
        appendLog(job, `[stdout] ${stdoutBuffer}`);
      }
      if (stderrBuffer.trim()) {
        appendLog(job, `[stderr] ${stderrBuffer}`);
      }
      job.child = null;

      if (isCancelled(job)) {
        resolve();
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`command failed: ${cmd} ${args.join(' ')} (code=${code}, signal=${signal ?? 'none'})`));
    });
  });
}

async function runBookJob(job: JobRecord, settings: ReturnType<typeof parseBookJobSettings>): Promise<JobResult> {
  return runBookProblemJob({
    settings,
    rootDir: DRAFT_MAKING_DIR,
    runCommand: (cmd, args, cwd, env) => runCommand(job, cmd, args, cwd, env),
    setStep: (step) => setStep(job, step),
  });
}

async function runKifsJob(job: JobRecord, settings: ReturnType<typeof parseKifsJobSettings>): Promise<JobResult> {
  const notes: string[] = [];

  if (settings.runGenerateKifus) {
    const result = await runKifsGenerationJob({
      settings,
      rootDir: REPO_ROOT,
      runCommand: (cmd, args, cwd, env) => runCommand(job, cmd, args, cwd, env),
      setStep: (step) => setStep(job, step),
    });
    notes.push(...result.notes);
  }

  if (settings.runBatchGenerate) {
    const result = await runKifProblemJob({
      settings,
      rootDir: REPO_ROOT,
      runCommand: (cmd, args, cwd, env) => runCommand(job, cmd, args, cwd, env),
      setStep: (step) => setStep(job, step),
    });
    notes.push(...result.notes);
  }

  if (!settings.runGenerateKifus && !settings.runBatchGenerate) {
    throw new Error('at least one step is required');
  }

  return { notes };
}

async function executeJob(job: JobRecord, input: JobInput): Promise<void> {
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  appendLog(job, `[job] started (${job.kind})`);

  try {
    if (input.kind === 'book') {
      const settings = parseBookJobSettings(input.settings);
      job.result = await runBookJob(job, settings);
    } else {
      const settings = parseKifsJobSettings(input.settings);
      job.result = await runKifsJob(job, settings);
    }

    if (!isCancelled(job)) {
      job.status = 'completed';
      setStep(job, '完了');
      appendLog(job, '[job] completed');
    }
  } catch (error: any) {
    if (isCancelled(job)) {
      appendLog(job, '[job] cancelled');
      return;
    }
    job.status = 'failed';
    job.error = error?.message ?? String(error);
    appendLog(job, `[job] failed: ${job.error}`);
  } finally {
    job.finishedAt = new Date().toISOString();
    job.child = null;
  }
}

export function startMakingJob(rawInput: unknown): JobSnapshot {
  const input = parseJobInput(rawInput);
  const now = new Date().toISOString();

  const job: JobRecord = {
    id: makeJobId(),
    kind: input.kind,
    status: 'queued',
    step: 'queued',
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    logs: [],
    result: null,
    error: null,
    child: null,
  };

  jobs.set(job.id, job);
  void executeJob(job, input);
  return toSnapshot(job);
}

export function listMakingJobs(): JobSnapshot[] {
  return Array.from(jobs.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((job) => toSnapshot(job));
}

export function getMakingJob(jobId: string): JobSnapshot | null {
  const job = jobs.get(jobId);
  return job ? toSnapshot(job) : null;
}

export function cancelMakingJob(jobId: string): JobSnapshot | null {
  const job = jobs.get(jobId);
  if (!job) return null;

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return toSnapshot(job);
  }

  job.status = 'cancelled';
  job.step = 'cancelled';
  job.finishedAt = new Date().toISOString();
  appendLog(job, '[job] cancel requested');

  if (job.child) {
    job.child.kill('SIGTERM');
    job.child = null;
  }

  return toSnapshot(job);
}
