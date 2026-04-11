import express from 'express';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';
import { ShogiEngine } from './engine.js';
import type { AnalysisLine } from './engine.js';
import type { AnalysisTuning, DepthBenchmarkResult } from './engine.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '8765', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

app.use(cors());
app.use(express.json());

const engine = new ShogiEngine(
  process.env.ENGINE_PATH,
  process.env.EVAL_DIR,
);
let benchRunning = false;

// API routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/evaluate', async (req, res) => {
  try {
    const { sfen, moves = [], depth = 20, nodes, stable = false, searchMoves = [] } = req.body;

    if (!sfen || typeof sfen !== 'string') {
      res.status(400).json({ error: 'sfen is required' });
      return;
    }

    if (!Array.isArray(moves)) {
      res.status(400).json({ error: 'moves must be an array' });
      return;
    }

    if (!Array.isArray(searchMoves)) {
      res.status(400).json({ error: 'searchMoves must be an array' });
      return;
    }

    if (typeof depth !== 'number' || depth < 1 || depth > 40) {
      res.status(400).json({ error: 'depth must be 1-40' });
      return;
    }

    if (nodes !== undefined && (typeof nodes !== 'number' || nodes < 1000 || nodes > 50000000)) {
      res.status(400).json({ error: 'nodes must be 1000-50000000' });
      return;
    }

    if (typeof stable !== 'boolean') {
      res.status(400).json({ error: 'stable must be boolean' });
      return;
    }

    const result = await engine.evaluate(sfen, moves, {
      depth,
      nodes,
      stable,
      searchMoves,
    });
    res.json({
      eval_cp: result.eval_cp,
      pv: result.pv,
      bestmove: result.bestmove,
    });
  } catch (err: any) {
    console.error('Evaluate error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analyze', (req, res) => {
  const sfen = req.query.sfen as string;
  const multipv = parseInt((req.query.multipv as string) ?? '5', 10);

  if (!sfen) {
    res.status(400).json({ error: 'sfen is required' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const handler = (info: AnalysisLine) => {
    res.write(`data: ${JSON.stringify(info)}\n\n`);
  };

  engine.analysisEmitter.on('info', handler);

  try {
    engine.startAnalysis(sfen, [], multipv);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    engine.analysisEmitter.removeListener('info', handler);
    res.end();
    return;
  }

  req.on('close', async () => {
    engine.analysisEmitter.removeListener('info', handler);
    await engine.stopAnalysis();
  });
});

app.post('/api/analyze/stop', async (_req, res) => {
  try {
    await engine.stopAnalysis();
    res.json({ status: 'stopped' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bench/auto', async (req, res) => {
  if (benchRunning) {
    res.status(409).json({ error: 'benchmark is already running' });
    return;
  }

  const {
    sfen,
    moves = [],
    targetDepth = 20,
    timeoutMs = 20000,
    threads = [3, 4, 5, 6],
    hashMb = [1024, 2048],
    pvIntervalMs = [300],
    multipv = 3,
  } = req.body ?? {};

  if (!sfen || typeof sfen !== 'string') {
    res.status(400).json({ error: 'sfen is required' });
    return;
  }
  if (!Array.isArray(moves)) {
    res.status(400).json({ error: 'moves must be an array' });
    return;
  }
  if (typeof targetDepth !== 'number' || targetDepth < 10 || targetDepth > 40) {
    res.status(400).json({ error: 'targetDepth must be 10-40' });
    return;
  }
  if (typeof timeoutMs !== 'number' || timeoutMs < 3000 || timeoutMs > 120000) {
    res.status(400).json({ error: 'timeoutMs must be 3000-120000' });
    return;
  }

  const isIntArray = (arr: unknown, min: number, max: number) =>
    Array.isArray(arr) && arr.every((v) => Number.isInteger(v) && v >= min && v <= max);

  if (!isIntArray(threads, 1, 32)) {
    res.status(400).json({ error: 'threads must be an integer array (1-32)' });
    return;
  }
  if (!isIntArray(hashMb, 16, 32768)) {
    res.status(400).json({ error: 'hashMb must be an integer array (16-32768)' });
    return;
  }
  if (!isIntArray(pvIntervalMs, 50, 5000)) {
    res.status(400).json({ error: 'pvIntervalMs must be an integer array (50-5000)' });
    return;
  }
  if (!Number.isInteger(multipv) || multipv < 1 || multipv > 10) {
    res.status(400).json({ error: 'multipv must be integer (1-10)' });
    return;
  }

  benchRunning = true;
  try {
    const current = engine.getCurrentTuning();
    const candidates: AnalysisTuning[] = [];
    for (const th of threads) {
      for (const hash of hashMb) {
        for (const pvi of pvIntervalMs) {
          candidates.push({
            hashMb: hash,
            threads: th,
            cores: th,
            pvIntervalMs: pvi,
            multipv,
          });
        }
      }
    }

    const results: DepthBenchmarkResult[] = [];
    for (const tuning of candidates) {
      const result = await engine.benchmarkDepthReach({
        sfen,
        moves,
        targetDepth,
        timeoutMs,
        tuning,
      });
      results.push(result);
    }

    const sorted = [...results].sort((a, b) => {
      if (a.reached !== b.reached) return a.reached ? -1 : 1;
      if (a.reached && b.reached) return a.elapsedMs - b.elapsedMs;
      if (a.maxDepth !== b.maxDepth) return b.maxDepth - a.maxDepth;
      return a.elapsedMs - b.elapsedMs;
    });
    const best = sorted[0];
    await engine.configureAnalysisTuning(best.tuning);

    res.json({
      targetDepth,
      timeoutMs,
      tested: candidates.length,
      previous: current,
      best,
      results: sorted,
    });
  } catch (err: any) {
    console.error('Auto bench error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    benchRunning = false;
  }
});

// Serve built frontend (web/dist) if available — for ngrok / production sharing.
const distDir = path.resolve(import.meta.dirname, '..', '..', 'web', 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback: any non-API route → index.html
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
  console.log(`Serving frontend from ${distDir}`);
}

// Start server after engine is ready
async function main() {
  try {
    await engine.start();
    app.listen(PORT, HOST, () => {
      console.log(`Engine API server running on http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start engine:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log('Shutting down...');
  engine.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  engine.stop();
  process.exit(0);
});

main();