import express from 'express';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';
import { ShogiEngine } from './engine.js';
import type { AnalysisLine } from './engine.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '8765', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

app.use(cors());
app.use(express.json());

const engine = new ShogiEngine(
  process.env.ENGINE_PATH,
  process.env.EVAL_DIR,
);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Evaluate a position (single shot)
app.post('/api/evaluate', async (req, res) => {
  try {
    const { sfen, moves = [], depth = 20 } = req.body;

    if (!sfen || typeof sfen !== 'string') {
      res.status(400).json({ error: 'sfen is required' });
      return;
    }

    if (!Array.isArray(moves)) {
      res.status(400).json({ error: 'moves must be an array' });
      return;
    }

    if (typeof depth !== 'number' || depth < 1 || depth > 40) {
      res.status(400).json({ error: 'depth must be 1-40' });
      return;
    }

    const result = await engine.evaluate(sfen, moves, depth);
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

// Start streaming analysis (SSE)
app.get('/api/analyze', (req, res) => {
  const sfen = req.query.sfen as string;
  const multipv = parseInt(req.query.multipv as string ?? '5', 10);

  if (!sfen) {
    res.status(400).json({ error: 'sfen is required' });
    return;
  }

  // SSE headers
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

  // Client disconnects → stop analysis
  req.on('close', async () => {
    engine.analysisEmitter.removeListener('info', handler);
    await engine.stopAnalysis();
  });
});

// Stop analysis
app.post('/api/analyze/stop', async (_req, res) => {
  try {
    await engine.stopAnalysis();
    res.json({ status: 'stopped' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

// Graceful shutdown
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
