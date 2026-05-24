const ENGINE_API = import.meta.env.VITE_ENGINE_API_URL ?? '';

export type MakingJobKind = 'book' | 'kifs';
export type MakingJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface MakingJobResult {
  createdCount?: number;
  generatedRecords?: Array<{ name: string; draft: Record<string, unknown> }>;
  notes?: string[];
}

export interface MakingJobSnapshot {
  id: string;
  kind: MakingJobKind;
  status: MakingJobStatus;
  step: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  logs: string[];
  result: MakingJobResult | null;
  error: string | null;
}

export interface StartBookJobInput {
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
}

export interface StartKifsJobInput {
  kind: 'kifs';
  settings?: {
    runGenerateKifus?: boolean;
    runBatchGenerate?: boolean;
    generateRunName?: string;
    gamesPerBasePosition?: number;
    maxMoves?: number;
    blackNodes?: number;
    whiteNodes?: number;
    blackMovetimeMs?: number;
    whiteMovetimeMs?: number;
    batchSize?: number;
    maxProblemsPerGame?: number;
    maxScanResultsPerGame?: number;
    scanDepth?: number;
  };
}

export type StartMakingJobInput = StartBookJobInput | StartKifsJobInput;

async function parseError(res: Response): Promise<never> {
  let message = `making job api error ${res.status}`;
  try {
    const payload = await res.json();
    if (payload?.error) {
      message = String(payload.error);
    }
  } catch {
    const text = await res.text();
    if (text) message = text;
  }
  throw new Error(message);
}

export async function listMakingJobs(): Promise<MakingJobSnapshot[]> {
  const res = await fetch(`${ENGINE_API}/api/making-jobs`);
  if (!res.ok) return parseError(res);
  const payload = (await res.json()) as { jobs?: MakingJobSnapshot[] };
  return payload.jobs ?? [];
}

export async function getMakingJob(jobId: string): Promise<MakingJobSnapshot> {
  const res = await fetch(`${ENGINE_API}/api/making-jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) return parseError(res);
  const payload = (await res.json()) as { job?: MakingJobSnapshot };
  if (!payload.job) {
    throw new Error('job not found');
  }
  return payload.job;
}

export async function startMakingJob(input: StartMakingJobInput): Promise<MakingJobSnapshot> {
  const res = await fetch(`${ENGINE_API}/api/making-jobs/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) return parseError(res);
  const payload = (await res.json()) as { job?: MakingJobSnapshot };
  if (!payload.job) {
    throw new Error('failed to start making job');
  }
  return payload.job;
}

export async function cancelMakingJob(jobId: string): Promise<MakingJobSnapshot> {
  const res = await fetch(`${ENGINE_API}/api/making-jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  });
  if (!res.ok) return parseError(res);
  const payload = (await res.json()) as { job?: MakingJobSnapshot };
  if (!payload.job) {
    throw new Error('failed to cancel making job');
  }
  return payload.job;
}
