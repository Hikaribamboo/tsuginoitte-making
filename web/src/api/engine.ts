// Use same-origin proxy by default so remote access (e.g. ngrok) works.
const ENGINE_API = import.meta.env.VITE_ENGINE_API_URL ?? '/engine-api';

export interface EngineEvalResult {
  eval_cp: number;
  pv: string[];
}

export interface AnalysisLine {
  multipv: number;
  depth: number;
  eval_cp: number;
  mate: number | null;
  pv: string[];
}

/**
 * Evaluate a position (single shot, fixed depth).
 */
export async function evaluatePosition(
  sfen: string,
  moves: string[] = [],
  depth = 20,
): Promise<EngineEvalResult> {
  const res = await fetch(`${ENGINE_API}/api/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sfen, moves, depth }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Engine API error ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Start streaming analysis via SSE. Returns an EventSource.
 */
export function startAnalysisStream(
  sfen: string,
  multipv = 5,
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
    // Stop EventSource auto-retry loop on hard connection failures.
    es.close();
    console.error('[engine] analysis stream connection error', { streamUrl });
    onError?.('接続エラー: エンジンサーバーに接続できません。server を起動してください。');
  };

  return es;
}

/**
 * Stop ongoing analysis.
 */
export async function stopAnalysis(): Promise<void> {
  await fetch(`${ENGINE_API}/api/analyze/stop`, { method: 'POST' });
}
