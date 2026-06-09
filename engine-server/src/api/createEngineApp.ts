import cors from 'cors';
import express, { type Express } from 'express';
import path from 'path';
import { existsSync } from 'fs';
import os from 'os';
import { ShogiEngine } from '../engine.js';
import { cancelMakingJob, getMakingJob, listMakingJobs, startMakingJob } from '../makingJobs.js';
import { listMakingPathOptions } from '../makingOptions.js';
import { resolvePredictionModelPath, runLocalShogiPrediction } from '../features/recognition/recognition.service.js';

type UnifiedJobKind = 'book-problem' | 'kif-problem' | 'kifs-generation';

type UnifiedJobInput = {
  kind?: UnifiedJobKind;
  settings?: Record<string, unknown>;
};

function mapUnifiedJobToLegacyInput(input: UnifiedJobInput): unknown {
  if (input.kind === 'book-problem') {
    return { kind: 'book', settings: { ...(input.settings ?? {}) } };
  }

  if (input.kind === 'kif-problem') {
    return {
      kind: 'kifs',
      settings: {
        ...(input.settings ?? {}),
        runGenerateKifus: false,
        runBatchGenerate: true,
      },
    };
  }

  if (input.kind === 'kifs-generation') {
    return {
      kind: 'kifs',
      settings: {
        ...(input.settings ?? {}),
        runGenerateKifus: true,
        runBatchGenerate: false,
      },
    };
  }

  throw new Error('invalid kind');
}

export function createEngineApp(engine: ShogiEngine): Express {
  const app = express();
  let engineOperationQueue: Promise<void> = Promise.resolve();
  const enqueueEngineOperation = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const result = engineOperationQueue.then(operation, operation);
    engineOperationQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  app.use(cors());
  app.use(express.json({ limit: '12mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      hostname: os.hostname(),
      platform: process.platform,
      pid: process.pid,
      cwd: process.cwd(),
    });
  });

  app.get('/api/jobs', (_req, res) => {
    console.log('[api] GET /api/jobs');
    res.json({ jobs: listMakingJobs() });
  });

  app.post('/api/jobs', (req, res) => {
    try {
      console.log('[api] POST /api/jobs', JSON.stringify(req.body ?? {}));
      const legacyInput = mapUnifiedJobToLegacyInput(req.body ?? {});
      const job = startMakingJob(legacyInput);
      console.log(`[api] job accepted id=${job.id} kind=${job.kind}`);
      res.status(201).json({ job });
    } catch (error: any) {
      console.error('[api] POST /api/jobs failed:', error?.message ?? error);
      res.status(400).json({ error: error?.message ?? 'failed to start job' });
    }
  });

  app.get('/api/jobs/:jobId', (req, res) => {
    console.log(`[api] GET /api/jobs/${req.params.jobId}`);
    const job = getMakingJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    res.json({ job });
  });

  app.post('/api/jobs/:jobId/cancel', (req, res) => {
    console.log(`[api] POST /api/jobs/${req.params.jobId}/cancel`);
    const job = cancelMakingJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    res.json({ job });
  });

  app.get('/api/making-options', async (_req, res) => {
    try {
      const options = await listMakingPathOptions();
      res.json(options);
    } catch (error: any) {
      res.status(500).json({ error: error?.message ?? 'failed to list making options' });
    }
  });

  app.post('/api/recognize-shogi-position', async (req, res) => {
    const image = req.body?.image;
    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
      res.status(400).json({ error: 'image data URL is required' });
      return;
    }

    try {
      const parsed = await runLocalShogiPrediction(image);
      const modelPath = resolvePredictionModelPath();
      res.json({
        ...parsed,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
        notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
        model: path.basename(modelPath),
        raw: parsed,
      });
    } catch (error: any) {
      console.error('Shogi image recognition error:', error);
      res.status(500).json({ error: error?.message ?? 'failed to recognize shogi position' });
    }
  });

  app.post('/api/evaluate', async (req, res) => {
    try {
      const {
        sfen,
        moves = [],
        depth = 20,
        nodes,
        stable = false,
        searchMoves = [],
        multipv,
        newGame,
        usiOptions,
      } = req.body;
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

      const result = await enqueueEngineOperation(() =>
        engine.evaluate(sfen, moves, {
          depth,
          nodes,
          stable,
          searchMoves,
          multipv,
          newGame,
          usiOptions,
        }),
      );
      res.json(result);
    } catch (error: any) {
      console.error('Evaluate error:', error);
      res.status(500).json({ error: error?.message ?? 'failed to evaluate position' });
    }
  });

  app.get('/api/analyze', async (req, res) => {
    const sfen = typeof req.query.sfen === 'string' ? req.query.sfen : '';
    const multipv = Number.parseInt(typeof req.query.multipv === 'string' ? req.query.multipv : '3', 10);
    if (!sfen) {
      res.status(400).json({ error: 'sfen is required' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write('\n');

    const send = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const infoHandler = (line: any) => send(line);
    const closeHandler = () => {
      engine.analysisEmitter.removeListener('info', infoHandler);
      engine.analysisEmitter.removeListener('rawline', rawHandler);
      clearInterval(pingTimer);
      res.end();
    };
    const rawHandler = () => void 0;
    const pingTimer = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    engine.analysisEmitter.on('info', infoHandler);
    engine.analysisEmitter.on('rawline', rawHandler);
    req.on('close', closeHandler);

    try {
      await enqueueEngineOperation(async () => {
        if (!engine.isReady?.()) {
          await engine.start();
        }
        await engine.startAnalysis(sfen, [], Number.isFinite(multipv) ? multipv : 3);
      });
    } catch (error: any) {
      send({ error: error?.message ?? 'failed to start analysis' });
      closeHandler();
    }
  });

  app.post('/api/analyze/stop', async (_req, res) => {
    try {
      await enqueueEngineOperation(() => engine.stopAnalysis());
      res.json({ status: 'stopped' });
    } catch (error: any) {
      res.status(500).json({ error: error?.message ?? 'failed to stop analysis' });
    }
  });

  const distDir = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'web', 'dist');
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}
