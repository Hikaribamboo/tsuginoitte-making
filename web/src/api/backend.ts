// In production (served by Express), /api is direct.
// In Vite dev, /api is proxied to the backend server.
const ENGINE_API = import.meta.env.VITE_ENGINE_API_URL ?? '';
const AI_API = import.meta.env.VITE_AI_API_URL ?? ENGINE_API;

export interface EngineEvalResult {
  eval_cp: number;
  bestmove?: string;
  pv: string[];
  lines?: AnalysisLine[];
  rawLines?: string[];
}

export interface EvaluateOptions {
  depth?: number;
  nodes?: number;
  stable?: boolean;
  searchMoves?: string[];
  multipv?: number;
  newGame?: boolean;
  usiOptions?: Record<string, string | number | boolean>;
}

export interface AnalysisLine {
  multipv: number;
  depth: number;
  eval_cp: number;
  mate: number | null;
  pv: string[];
}

export async function evaluatePosition(
  sfen: string,
  moves: string[] = [],
  options: EvaluateOptions = {},
): Promise<EngineEvalResult> {
  const {
    depth = 20,
    nodes,
    stable = false,
    searchMoves = [],
    multipv,
    newGame,
    usiOptions,
  } = options;

  const res = await fetch(`${ENGINE_API}/api/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sfen, moves, depth, nodes, stable, searchMoves, multipv, newGame, usiOptions }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Engine API error ${res.status}: ${text}`);
  }
  return res.json();
}

export function startAnalysisStream(
  sfen: string,
  multipv = 3,
  onInfo: (line: AnalysisLine) => void,
  onError?: (err: string) => void,
): EventSource {
  const params = new URLSearchParams({ sfen, multipv: String(multipv) });
  const streamUrl = `${ENGINE_API}/api/analyze?${params}`;
  const es = new EventSource(streamUrl);

  console.info('[engine] start analysis stream', { streamUrl, multipv });

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.error) {
        onError?.(data.error);
        return;
      }
      onInfo(data as AnalysisLine);
    } catch {
      // ignore parse errors
    }
  };

  es.onerror = () => {
    es.close();
    console.error('[engine] analysis stream connection error', { streamUrl });
    onError?.('接続エラー: エンジンサーバーに接続できません。server を起動してください。');
  };

  return es;
}

export async function stopAnalysis(): Promise<void> {
  await fetch(`${ENGINE_API}/api/analyze/stop`, { method: 'POST' });
}

export interface ExplanationChoice {
  label: string;
  eval_cp: number | null;
  eval_percent: number | null;
  line_labels: string;
  is_correct: boolean;
}

export interface GeneratedExplanation {
  index: number;
  explanation: string;
}

export async function generateExplanations(
  sfen: string,
  sideToMove: 'sente' | 'gote',
  choices: ExplanationChoice[],
): Promise<GeneratedExplanation[]> {
  const res = await fetch(`${AI_API}/api/generate-explanations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sfen, sideToMove, choices }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.explanations;
}

export interface RecognizeShogiPositionResponse {
  sfen: string;
  confidence?: number;
  notes?: string[];
  model?: string;
  squares?: import('../lib/image-position-store').RecognitionSquare[];
  pieceBox?: import('../lib/image-position-store').RecognitionPieceBoxItem[];
  validationIssues?: import('../lib/image-position-store').RecognitionValidationIssue[];
  raw?: unknown;
}

export async function recognizeShogiPosition(
  imageDataUrl: string,
): Promise<RecognizeShogiPositionResponse> {
  const res = await fetch(`${ENGINE_API}/api/recognize-shogi-position`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageDataUrl }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error ?? '画像認識に失敗しました');
  }
  return data;
}

export type MakingJobKind = 'book' | 'kifs';
export type UnifiedJobKind = 'book-problem' | 'kif-problem' | 'kifs-generation';
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
    bookFile?: 'qhapaq' | 'sanken-shiken';
    count?: number;
    minDiff?: number;
    maxDiff?: number;
  };
}

export interface StartKifsJobInput {
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
    finalizeDepth?: number;
    minDiff?: number;
  };
}

export type StartMakingJobInput = StartBookJobInput | StartKifsJobInput;

function mapToUnifiedJobInput(input: StartMakingJobInput): { kind: UnifiedJobKind; settings?: Record<string, unknown> } {
  if (input.kind === 'book') {
    return { kind: 'book-problem', settings: input.settings };
  }

  if (input.settings?.runGenerateKifus) {
    return { kind: 'kifs-generation', settings: input.settings };
  }

  return { kind: 'kif-problem', settings: input.settings };
}

async function parseMakingJobError(res: Response): Promise<never> {
  let message = `making job api error ${res.status}`;
  try {
    const text = await res.text();
    if (text) {
      try {
        const payload = JSON.parse(text) as { error?: unknown };
        if (payload?.error) {
          message = String(payload.error);
        } else {
          message = text;
        }
      } catch {
        message = text;
      }
    }
  } catch {
    // Keep the default status-based message if the body cannot be read.
  }
  throw new Error(message);
}

export interface MakingPathOptions {
  enginePaths: string[];
  bookPaths: string[];
}

export async function getMakingPathOptions(): Promise<MakingPathOptions> {
  const res = await fetch(`${ENGINE_API}/api/making-options`);
  if (!res.ok) return parseMakingJobError(res);
  const payload = (await res.json()) as Partial<MakingPathOptions>;
  return {
    enginePaths: payload.enginePaths ?? [],
    bookPaths: payload.bookPaths ?? [],
  };
}

export async function listMakingJobs(): Promise<MakingJobSnapshot[]> {
  const res = await fetch(`${ENGINE_API}/api/jobs`);
  if (!res.ok) return parseMakingJobError(res);
  const payload = (await res.json()) as { jobs?: MakingJobSnapshot[] };
  return payload.jobs ?? [];
}

export async function getMakingJob(jobId: string): Promise<MakingJobSnapshot> {
  const res = await fetch(`${ENGINE_API}/api/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) return parseMakingJobError(res);
  const payload = (await res.json()) as { job?: MakingJobSnapshot };
  if (!payload.job) {
    throw new Error('job not found');
  }
  return payload.job;
}

export async function startMakingJob(input: StartMakingJobInput): Promise<MakingJobSnapshot> {
  const res = await fetch(`${ENGINE_API}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mapToUnifiedJobInput(input)),
  });
  if (!res.ok) return parseMakingJobError(res);
  const payload = (await res.json()) as { job?: MakingJobSnapshot };
  if (!payload.job) {
    throw new Error('failed to start making job');
  }
  return payload.job;
}

export async function cancelMakingJob(jobId: string): Promise<MakingJobSnapshot> {
  const res = await fetch(`${ENGINE_API}/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  });
  if (!res.ok) return parseMakingJobError(res);
  const payload = (await res.json()) as { job?: MakingJobSnapshot };
  if (!payload.job) {
    throw new Error('failed to cancel making job');
  }
  return payload.job;
}

export async function fetchShogiQuestGames(input: {
  username: string;
  mode: import('../lib/quest-kifu-import').ShogiQuestMode;
  count: number;
}): Promise<import('../lib/quest-kifu-import').ShogiQuestFetchResult> {
  const params = new URLSearchParams({
    username: input.username,
    mode: input.mode,
    count: String(input.count),
  });
  const res = await fetch(`${ENGINE_API}/api/shogi-quest/games?${params.toString()}`);
  if (!res.ok) return parseMakingJobError(res);
  return await res.json() as import('../lib/quest-kifu-import').ShogiQuestFetchResult;
}
