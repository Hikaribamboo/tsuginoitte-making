import cors from 'cors';
import express, { type Express } from 'express';
import path from 'path';
import { existsSync } from 'fs';
import os from 'os';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ShogiEngine } from '../engine.js';
import { cancelMakingJob, getMakingJob, listMakingJobs, startMakingJob } from '../makingJobs.js';
import { listMakingPathOptions } from '../makingOptions.js';
import { generateChoiceExplanations, type DraftProblem, type DraftProblemChoice } from '../features/explanations/index.js';
import {
  normalizeRecognitionModelVariant,
  resolvePredictionModelPathForVariant,
  runLocalShogiPrediction,
} from '../features/recognition/recognition.service.js';
import { fetchShogiQuestGames, type ShogiQuestMode } from '../features/shogi-quest/shogiQuest.service.js';

type UnifiedJobKind = 'book-problem' | 'kif-problem' | 'kifs-generation';

type UnifiedJobInput = {
  kind?: UnifiedJobKind;
  settings?: Record<string, unknown>;
};

let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) return supabaseClient;

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return supabaseClient;
}

function normalizeDraftProblem(row: any): DraftProblem {
  return {
    id: Number(row.id),
    root_sfen: String(row.root_sfen ?? ''),
    intro_moves_usi: Array.isArray(row.intro_moves_usi) ? row.intro_moves_usi.map(String) : [],
    correct_choice_id: Number(row.correct_choice_id),
  };
}

function normalizeDraftChoice(row: any): DraftProblemChoice {
  return {
    id: typeof row.id === 'number' ? row.id : undefined,
    draft_problem_id: Number(row.draft_problem_id),
    choice_id: Number(row.choice_id),
    usi: String(row.usi ?? ''),
    label: String(row.label ?? ''),
    eval_cp: typeof row.eval_cp === 'number' ? row.eval_cp : null,
    eval_percent: typeof row.eval_percent === 'number' ? row.eval_percent : null,
    line: Array.isArray(row.line) ? row.line.map(String) : [],
    explanation: typeof row.explanation === 'string' ? row.explanation : '',
  };
}

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

  app.post('/api/making-draft-problems/:problemId/generate-explanations', async (req, res) => {
    const problemId = Number.parseInt(req.params.problemId, 10);
    const overwrite = req.body?.overwrite === true;

    if (!Number.isInteger(problemId) || problemId <= 0) {
      res.status(400).json({ error: 'invalid problemId' });
      return;
    }

    try {
      const supabase = getSupabaseClient();
      const { data: problemRow, error: problemError } = await supabase
        .from('making_draft_problems')
        .select('id, root_sfen, intro_moves_usi, correct_choice_id')
        .eq('id', problemId)
        .maybeSingle();

      if (problemError) throw problemError;
      if (!problemRow) {
        res.status(404).json({ error: 'draft problem not found' });
        return;
      }

      const { data: choiceRows, error: choicesError } = await supabase
        .from('making_draft_choices')
        .select('id, draft_problem_id, choice_id, usi, label, eval_cp, eval_percent, line, explanation')
        .eq('draft_problem_id', problemId)
        .order('choice_id', { ascending: true });

      if (choicesError) throw choicesError;

      const choices = (choiceRows ?? []).map(normalizeDraftChoice);
      if (choices.length !== 3) {
        res.status(400).json({ error: 'draft problem must have exactly 3 choices' });
        return;
      }

      const targets = overwrite ? choices : choices.filter((choice) => !choice.explanation?.trim());
      if (targets.length === 0) {
        res.json({
          problemId,
          updated: false,
          choices: choices.map((choice) => ({
            choiceId: choice.choice_id,
            explanation: choice.explanation ?? '',
          })),
        });
        return;
      }

      const generated = await generateChoiceExplanations({
        problem: normalizeDraftProblem(problemRow),
        choices,
      });

      const generatedByChoiceId = new Map(
        generated.choices.map((choice) => [choice.choiceId, choice.explanation]),
      );
      const targetChoiceIds = new Set(targets.map((choice) => choice.choice_id));
      const now = new Date().toISOString();

      await Promise.all(
        choices
          .filter((choice) => targetChoiceIds.has(choice.choice_id))
          .map((choice) => {
            const explanation = generatedByChoiceId.get(choice.choice_id);
            if (!explanation) {
              throw new Error(`generated explanation missing for choice_id=${choice.choice_id}`);
            }
            return supabase
              .from('making_draft_choices')
              .update({ explanation, updated_at: now })
              .eq('draft_problem_id', problemId)
              .eq('choice_id', choice.choice_id)
              .then(({ error }) => {
                if (error) throw error;
              });
          }),
      );

      res.json({
        problemId,
        updated: true,
        choices: choices.map((choice) => ({
          choiceId: choice.choice_id,
          explanation: targetChoiceIds.has(choice.choice_id)
            ? generatedByChoiceId.get(choice.choice_id) ?? ''
            : choice.explanation ?? '',
        })),
      });
    } catch (error: any) {
      console.error('[api] POST /api/making-draft-problems/:problemId/generate-explanations failed:', error);
      res.status(500).json({ error: error?.message ?? 'failed to generate explanations' });
    }
  });

  app.get('/api/shogi-quest/games', async (req, res) => {
    const username = typeof req.query.username === 'string' ? req.query.username : '';
    const mode = (typeof req.query.mode === 'string' ? req.query.mode : '') as ShogiQuestMode;
    const count = Number.parseInt(typeof req.query.count === 'string' ? req.query.count : '', 10);

    try {
      const result = await fetchShogiQuestGames({ username, mode, count });
      res.json(result);
    } catch (error: any) {
      console.error('[api] GET /api/shogi-quest/games failed:', error?.message ?? error);
      res.status(400).json({ error: error?.message ?? '将棋クエスト棋譜の取得に失敗しました' });
    }
  });

  app.post('/api/recognize-shogi-position', async (req, res) => {
    const image = req.body?.image;
    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
      res.status(400).json({ error: 'image data URL is required' });
      return;
    }

    try {
      const modelVariant = normalizeRecognitionModelVariant(req.body?.modelVariant);
      const parsed = await runLocalShogiPrediction(image, modelVariant);
      const modelPath = resolvePredictionModelPathForVariant(modelVariant);
      res.json({
        ...parsed,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
        notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
        modelVariant,
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
