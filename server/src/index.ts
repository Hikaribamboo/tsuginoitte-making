import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { execFile } from 'child_process';
import OpenAI from 'openai';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { ShogiEngine } from './engine.js';
import type { AnalysisTuning, DepthBenchmarkResult } from './engine.js';
import { cancelMakingJob, getMakingJob, listMakingJobs, startMakingJob } from './makingJobs.js';
import { listMakingPathOptions } from './makingOptions.js';

const execFileAsync = promisify(execFile);

const app = express();
const PORT = parseInt(process.env.PORT ?? '8765', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '12mb' }));

const engine = new ShogiEngine(
  process.env.ENGINE_PATH,
  process.env.EVAL_DIR,
);
let benchRunning = false;

// API routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/making-jobs', (_req, res) => {
  res.json({ jobs: listMakingJobs() });
});

app.get('/api/making-options', async (_req, res) => {
  try {
    const options = await listMakingPathOptions();
    res.json(options);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'failed to list making options' });
  }
});

app.get('/api/making-jobs/:jobId', (req, res) => {
  const job = getMakingJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'job not found' });
    return;
  }
  res.json({ job });
});

app.post('/api/making-jobs/start', (req, res) => {
  try {
    const job = startMakingJob(req.body);
    res.status(201).json({ job });
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? 'failed to start job' });
  }
});

app.post('/api/making-jobs/:jobId/cancel', (req, res) => {
  const job = cancelMakingJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'job not found' });
    return;
  }
  res.json({ job });
});

function extractJsonObject(text: string): any | null {
  const direct = text.trim();
  try {
    return JSON.parse(direct);
  } catch {
    const match = direct.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function resolveShogiDatasetRoot(): string {
  return process.env.SHOGI_DATASET_ROOT
    ?? path.resolve(import.meta.dirname, '..', '..', 'shogi-position-recognition-dataset');
}

function resolvePredictionScriptPath(): string {
  return process.env.SHOGI_PREDICTION_SCRIPT
    ?? path.join(resolveShogiDatasetRoot(), 'scripts', 'predict_sfen.py');
}

function resolvePredictionModelPath(): string {
  return process.env.SHOGI_PREDICTION_MODEL
    ?? path.join(resolveShogiDatasetRoot(), 'models', 'resnet18_shogi_piece_classifier.pt');
}

function decodeDataUrlImage(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) {
    throw new Error('image data URL is invalid');
  }
  return Buffer.from(match[1], 'base64');
}

function sampleRectList(rects: any) {
  if (!Array.isArray(rects)) return undefined;
  return [
    ...rects.slice(0, 3),
    ...rects.slice(Math.max(rects.length - 3, 3)),
  ];
}

function summarizeCropInfo(cropInfo: any) {
  if (!cropInfo || typeof cropInfo !== 'object') return cropInfo;
  return {
    method: cropInfo.method,
    metadataSource: cropInfo.metadataSource,
    metadataSourceImageSize: cropInfo.metadataSourceImageSize,
    cropRect: cropInfo.cropRect,
    inputSize: cropInfo.inputSize,
    croppedSize: cropInfo.croppedSize,
    resizedSize: cropInfo.resizedSize,
    gridImageSize: cropInfo.gridImageSize,
    rawGridCellWidth: cropInfo.rawGridCellWidth,
    rawGridCellHeight: cropInfo.rawGridCellHeight,
    resizedGridCellWidth: cropInfo.resizedGridCellWidth,
    resizedGridCellHeight: cropInfo.resizedGridCellHeight,
    modelInputCellSize: cropInfo.modelInputCellSize,
    cellRectsRawSample: sampleRectList(cropInfo.cellRectsRaw),
    cellRectsResizedSample: sampleRectList(cropInfo.cellRectsResized),
  };
}

function summarizeDebugLog(debugLog: any) {
  if (!debugLog || typeof debugLog !== 'object') return debugLog;
  return {
    inputImagePath: debugLog.inputImagePath,
    inputSize: debugLog.inputSize,
    metadataSource: debugLog.metadataSource,
    metadataSourceImageSize: debugLog.metadataSourceImageSize,
    cropInfo: debugLog.cropInfo,
    croppedSize: debugLog.croppedSize,
    resizedSize: debugLog.resizedSize,
    rawGridCellWidth: debugLog.rawGridCellWidth,
    rawGridCellHeight: debugLog.rawGridCellHeight,
    resizedGridCellWidth: debugLog.resizedGridCellWidth,
    resizedGridCellHeight: debugLog.resizedGridCellHeight,
    modelInputCellSize: debugLog.modelInputCellSize,
    cellRectsRawSample: sampleRectList(debugLog.cellRectsRaw),
    cellRectsResizedSample: sampleRectList(debugLog.cellRectsResized),
  };
}

function summarizePrediction(parsed: any) {
  const squares = Array.isArray(parsed?.squares) ? parsed.squares : [];
  const statusCounts = squares.reduce((counts: Record<string, number>, square: any) => {
    const status = typeof square?.status === 'string' ? square.status : 'unknown';
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    sfen: parsed?.sfen,
    confidence: parsed?.confidence,
    squareCount: squares.length,
    statusCounts,
    pieceBoxCount: Array.isArray(parsed?.pieceBox) ? parsed.pieceBox.length : 0,
    validationIssueCount: Array.isArray(parsed?.validationIssues) ? parsed.validationIssues.length : 0,
    inputSize: parsed?.inputSize,
    croppedSize: parsed?.croppedSize,
    resizedSize: parsed?.resizedSize,
    gridImageSize: parsed?.gridImageSize,
    cropInfo: summarizeCropInfo(parsed?.cropInfo),
    debugImages: parsed?.debugImages,
    debugLog: summarizeDebugLog(parsed?.debugLog),
    boardCropPath: parsed?.boardCropPath,
    boardGridPath: parsed?.boardGridPath,
    cellsPreviewPath: parsed?.cellsPreviewPath,
  };
}

async function runLocalShogiPrediction(imageDataUrl: string): Promise<any> {
  const scriptPath = resolvePredictionScriptPath();
  const modelPath = resolvePredictionModelPath();
  if (!existsSync(scriptPath)) {
    throw new Error(`prediction script not found: ${scriptPath}`);
  }
  if (!existsSync(modelPath)) {
    throw new Error(`prediction model not found: ${modelPath}`);
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'tsuginoitte-shogi-'));
  const imagePath = path.join(tempDir, 'input.png');
  try {
    const imageBuffer = decodeDataUrlImage(imageDataUrl);
    await writeFile(imagePath, imageBuffer);
    const pythonBin = process.env.PYTHON_BIN ?? 'python3';
    const args = [
      scriptPath,
      '--image',
      imagePath,
      '--model',
      modelPath,
    ];
    const fallbackSourceId = process.env.SHOGI_PREDICTION_FALLBACK_SOURCE_ID ?? '002';
    const fallbackMetadataPath = path.join(resolveShogiDatasetRoot(), 'metadata', `${fallbackSourceId}.json`);
    if (existsSync(fallbackMetadataPath)) {
      args.push('--fallback-source-id', fallbackSourceId);
    } else {
      console.warn('[recognize] fallback metadata not found; using predictor auto crop fallback', {
        fallbackSourceId,
        fallbackMetadataPath,
      });
    }
    console.log('[recognize] invoking python predictor', {
      pythonBin,
      scriptPath,
      modelPath,
      imagePath,
      imageBytes: imageBuffer.length,
      datasetRoot: resolveShogiDatasetRoot(),
      fallbackSourceId: existsSync(fallbackMetadataPath) ? fallbackSourceId : null,
    });

    const { stdout, stderr } = await execFileAsync(
      pythonBin,
      args,
      { maxBuffer: 10 * 1024 * 1024 },
    );
    if (stderr.trim()) {
      console.warn('[recognize] predictor stderr:', stderr.trim());
    }
    const parsed = extractJsonObject(stdout);
    if (!parsed || typeof parsed.sfen !== 'string') {
      console.error('[recognize] failed to parse predictor stdout head:', stdout.slice(0, 1000));
      throw new Error('Failed to parse prediction output');
    }
    console.log('[recognize] predictor result', summarizePrediction(parsed));
    return parsed;
  } catch (err: any) {
    console.error('[recognize] predictor failed', {
      message: err?.message,
      code: err?.code,
      stdout: typeof err?.stdout === 'string' ? err.stdout.slice(0, 2000) : undefined,
      stderr: typeof err?.stderr === 'string' ? err.stderr.slice(0, 4000) : undefined,
    });
    throw err;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

app.post('/api/recognize-shogi-position', async (req, res) => {
  console.log('[recognize] request received', {
    contentType: req.headers['content-type'],
    bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : [],
    imageChars: typeof req.body?.image === 'string' ? req.body.image.length : 0,
  });

  const image = req.body?.image;
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    console.warn('[recognize] bad request: image data URL is missing or invalid');
    res.status(400).json({ error: 'image data URL is required' });
    return;
  }

  try {
    const parsed = await runLocalShogiPrediction(image);
    console.log('[recognize] response sent', summarizePrediction(parsed));
    res.json({
      ...parsed,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
      notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
      model: path.basename(resolvePredictionModelPath()),
      raw: parsed,
    });
  } catch (err: any) {
    console.error('Shogi image recognition error:', err);
    res.status(500).json({ error: err.message });
  }
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
    return;
  }

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

// ---- Generate explanations via Anthropic Claude ----

const FEW_SHOT_EXAMPLES = [
  { label: '△３三金', eval_cp: 1254, eval_percent: 17, line_labels: '▲２二銀不成 △４一玉 ▲３三銀成 △２一飛 ▲２六飛成', explanation: '▲２二銀不成が厳しい。そこに金を逃げても助からない。' },
  { label: '△４六桂打', eval_cp: 893, eval_percent: 25, line_labels: '▲５九玉 △２五歩 ▲２五同歩 △３八桂成', explanation: '特に強い狙いのない手。同飛車なら２三の銀を取れるが，同歩で何もない。' },
  { label: '△３二金', eval_cp: 312, eval_percent: 40, line_labels: '▲２二歩打 △３三飛 ▲２二歩成 △３一玉', explanation: 'シンプルに金取りに同銀とできる形にするのが最善手。少し意外な手だが，意外とこれで耐えている。' },
  { label: '▲９五角打', eval_cp: 513, eval_percent: 66, line_labels: '△９四飛 ▲７三角成 △７三同銀 ▲３四桂', explanation: '83飛には74歩ととって+1080 最善は94飛だが、角成同銀に34桂と打てば相手の飛車は働かず、一方的に攻めれる。' },
  { label: '▲７四歩', eval_cp: 46, eval_percent: 51, line_labels: '△７四同飛 ▲７五歩打 △９四飛 ▲９六歩', explanation: '相手の飛車が自然に良い位置に行くので良くない。' },
  { label: '▲１五歩', eval_cp: 46, eval_percent: 51, line_labels: '', explanation: 'チャンスを逃している' },
  { label: '▲６四歩', eval_cp: -73, eval_percent: 48, line_labels: '△６四同歩 ▲６四同飛車 △９九角成 ▲６五飛', explanation: '同歩が最善だが、同飛車99角成に飛車まわりが絶品。持ち駒は少ないが互角' },
  { label: '▲８八銀', eval_cp: -1003, eval_percent: 22, line_labels: '△３三飛成 ▲２九飛 △２八歩打 ▲２八同飛', explanation: '相手の手は多いが、こちらは持ち駒が少なく手が少ない。' },
  { label: '▲７三飛成', eval_cp: -413, eval_percent: 37, line_labels: '△９五角打 ▲７三同龍 △６四同歩 ▲６三歩成', explanation: '95角と打たれ龍を逃げても99角なりとされ劣勢。' },
  { label: '▲４九金', eval_cp: 723, eval_percent: 71, line_labels: '△３六歩打 ▲９六角打 △３七桂打 ▲９六同飛', explanation: '悪くはないが、なんの為に将棋を指しているのか分からない。' },
  { label: '▲７四香', eval_cp: 1616, eval_percent: 88, line_labels: '△７四同飛 ▲８三龍 △７四香打 ▲２五歩', explanation: '飛車を逃げると44桂打ちが激痛 詰めろなので香車を取る一択だが、冷静に同銀と取られて下手よし。' },
  { label: '▲７二歩打', eval_cp: 1022, eval_percent: 78, line_labels: '△８一玉 ▲７三桂打 △６二金 ▲７二角打', explanation: '次善手だが、駒を大量に渡してしまうので実践的には危うい。' },
  { label: '△２二玉', eval_cp: 304, eval_percent: 41, line_labels: '▲３五銀 ▲４四銀成 ▲３四銀成', explanation: '▲５四角打に備えてあらかじめ玉を逃げている。歩を突かれ，陣形を乱される。' },
  { label: '△５三歩打', eval_cp: 170, eval_percent: 45, line_labels: '▲６七金 ▲４四銀成 ▲１五歩打', explanation: '将来的な▲５四角打を警戒した手。玉頭に迫る歩を取り返す時に４三の銀を動かせないのを打開する。' },
  { label: '△５三金', eval_cp: 252, eval_percent: 42, line_labels: '▲３五銀 ▲３四銀成 ▲６七金', explanation: '５四の地点に効かせる手で悪くないが，せっかく固い玉が少し薄くなり残念。' },
  { label: '△７二歩打', eval_cp: 83, eval_percent: 47, line_labels: '▲８九玉 ▲２二銀成 ▲３五銀', explanation: 'これは後に８三や６三などに金を逃げた時に▲７二角打を喰らわないようにしている。' },
  { label: '△７四金', eval_cp: 175, eval_percent: 45, line_labels: '▲７三金 ▲６六飛成 ▲８七金', explanation: '相手に歩がないのがポイント。飛車先を通しつつ，歩成を促す。飛車にと金が当たるが，△８四飛がぴったりで，銀を守るために▲８七金には△８三飛で次に△８六歩打を狙った手が抜群に厳しい。' },
  { label: '△６一飛', eval_cp: 65, eval_percent: 48, line_labels: '▲６二金 ▲７二金 ▲５五銀', explanation: '相手の攻めを急かして角を手に入れる。飛車銀両取りをかけられるが無視。陣形は飛車に強い形。拠点と持ち駒を使って一気に攻め込む。' },
  { label: '△７六歩打', eval_cp: 78, eval_percent: 48, line_labels: '▲８五金 ▲７四銀 ▲６八銀', explanation: '桂馬が跳ねると自分の金に当たってしまい一見良くない攻めに見える。しかし，手順に自分の桂馬を跳ねることができ，７六の拠点を永久に残し続けることができる。自玉が広いからできる攻め。' },
  { label: '△６二角', eval_cp: 163, eval_percent: 45, line_labels: '▲２五歩打 ▲４四角成 ▲２四銀', explanation: '少しの差で△６二角が最善手。角を自分から交換すると相手の金が玉に自然に近づいてしまい相手の駒のバランスが良くなるという意味合いがある。' },
  { label: '△５二金', eval_cp: 142, eval_percent: 46, line_labels: '▲５四銀 ▲６三飛成 ▲７四金', explanation: '守っているように見えて遊んでいる４二の金を連結させた手。これ以外の手は攻め潰される。' },
  { label: '▲８六歩打', eval_cp: 121, eval_percent: 54, line_labels: '▲７六飛 ▲８二飛成 ▲９五飛', explanation: '後の８八歩に対し９七桂、８五桂と飛ぶ為の土台になっている。８八歩がなければ先手も満足な展開。' },
  { label: '▲８七金', eval_cp: 1068, eval_percent: 79, line_labels: '▲７五飛 ▲７四飛 ▲７九飛打', explanation: '８７金が好手。玉がいる為７８飛成はできず、７９角打も２９の飛車が効いており同飛と取られてしまう。なので７５か７４に逃げるしかないが、７５飛には金で追われ、７４飛には同馬同金で勝勢。後の飛車打ちや７９飛が痛く先手が一方的に攻める展開になる。' },
  { label: '▲５四歩打', eval_cp: 512, eval_percent: 65, line_labels: '▲６四歩 ▲６三歩成 ▲５四飛', explanation: 'ダンスの歩。△同金には▲５四歩→△５二金→▲６三歩成でなんと金がつかまっている。なので相手は△同金と取るしかない。' },
  { label: '▲２二角成', eval_cp: 1586, eval_percent: 88, line_labels: '▲３一金打 ▲３二金成 ▲４一金', explanation: '△同玉は▲６六角打で王手飛車，△同金は▲３一金打ちで割打ちの銀＋王手飛車の筋があるのでほぼ勝ち。' },
  { label: '▲４七角打', eval_cp: -2, eval_percent: 50, line_labels: '▲４六歩 ▲３五歩 ▲４六銀', explanation: '後手からの△６五歩を防ぎつつ、△４七銀打も防いでいる。相手の桂頭を睨んでおり、将来的に桂頭攻めも期待できる。更に自分の桂頭も守っている一石四鳥の美しい手。' },
  { label: '△３三桂', eval_cp: 0, eval_percent: 50, line_labels: '▲２三角打 ▲２一角 ▲３四角', explanation: '▲２三角打には２一飛で後手勝勢。▲２三歩打には△２一歩打で我慢すればどの変化も互角です。なので△３五歩に期待して桂馬を跳ねましょう。跳ねるときっといい事があります。' },
  { label: '△８七角成', eval_cp: -254, eval_percent: 58, line_labels: '▲８八同玉 ▲５四金 ▲４五歩打', explanation: 'すべて交換した後に王手飛車をかけられるわかりやすい好手。相手の陣形が打ち込みに弱い形なので迷いなく交換できる。相手が△３六飛としたところに目をつけられるか。' },
  { label: '△３七歩成', eval_cp: 130, eval_percent: 46, line_labels: '▲３五銀 ▲４八飛 ▲５五角', explanation: '▲３五銀を打ち飛車が逃げた後に桂馬をとるねらいがある。しかし，桂馬をとると▲５五角と打って銀香両取りがかかるため相手は桂馬をとれない。' },
  { label: '▲６四角', eval_cp: 1581, eval_percent: 88, line_labels: '▲６四飛 ▲６三飛 ▲５四銀', explanation: '銀を取った手が飛車に当たるので相手は無視できない。最後に▲６四飛とした手が銀取りと飛車なりの両狙いがあり，狭かったこちらの飛車が大活躍する。' },
  { label: '▲５三歩打', eval_cp: 853, eval_percent: 74, line_labels: '▲５二金 ▲５一金 ▲６四角成', explanation: 'と金や銀で突っ込むと精算されて相手の方がスッキリしてしまう。ここは攻め急ぐのをじっと我慢して歩を垂らすのが好手。' },
];

// Additional style reference explanations for tone/vocabulary learning
const STYLE_EXAMPLES: string[] = [
  '飛車を取っても敵陣に打つ場所がないので疑問手。',
  '玉頭の歩を伸ばすのが好手。どんどん桂跳ねや銀交換をして攻めをつなぐことができる。',
  '勝勢の局面で自玉頭を弱くする必要がない。',
  '83飛には74歩ととって+1080 最善は94飛だが、角成同銀に34桂と打てば相手の飛車は働かず、一方的に攻めれる。',
  '相手の飛車が自然に良い位置に行くので良くない。',
  'チャンスを逃している',
  '△７八桂成で角が詰み，△１五香からの王手金取りが痛い。',
  '金取りは無視して良い。左側の広さを生かしつつ豊富な持ち駒で攻めれば優勢。',
  '角を取られると△１五香からの王手金取りが痛い。',
  '相手玉は左側を受けづらいが、右側がまだ広い。',
  '相手の△２九飛成が先手となり悪手。',
  '銀と角を捨ててでも自玉を安全にする。どんどん自玉を固め大優勢になる。',
  '桂馬で相手玉を圧迫しつつ金を狙う。相手は金を逃げると狭くなる。',
  '相手の大駒である飛車から逃げる一手だが，自玉の左側は全く安全ではない。▲３七歩成を受けるのが難しいため悪手。',
  '飛車に当てつつ相手の玉を狙っているが，相手は意外と広い。',
  '自玉を固くする一手だが，角銀両取りを狙った相手の桂跳ねの味が良い。六５の地点を継続的に攻められて悪くなる。',
  'ここは相手の弱点の玉頭を狙うのが好手。',
  '相手が桂馬を打つ場所を自ら作りに行く手で悪手。',
  'シンプルに金取りに同銀とできる形にするのが最善手。少し意外な手だが，意外とこれで耐えている。',
  '特に強い狙いのない手。同飛車なら２三の銀を取れるが，同歩で何もない。',
  '▲２二銀不成が厳しい。そこに金を逃げても助からない。',
  '銀が玉頭から離れ少し左側が薄くなる。完封を目指すには甘い手。',
  '相手の玉頭に角を通す筋が抜群に良い。',
  '桂馬がはねて勢いがあるが，角道が止まってしまい自玉も狭くなるため疑問手。',
  '△２八桂成とされ飛車を走られて十字飛車をくらう。',
  '香取りは受けがないので４五の桂馬を自分から精算しに行くのが好手。',
  '相手の端は弱点ではないのでスジが悪い。',
  'たらしの歩が厳しい。次に打ち込む銀を取られても取られなくても相手は歩成りが受けられない。',
  '角を直接打ち込むのは少し重たい。1000点悪くして敗勢となる。',
  '歩を回収されて終わる。',
  '飛車先を通しておく',
  '角出の時２五に飛車を引けないため飛車を止められ攻めが重くなる',
  '馬と飛車の交換では相手が得をする。相手玉が広くなり飛車打ちには強い陣形となる。',
  '馬を引くと相手玉を固められ、攻めもうるさくて不利となる。',
  '歩成から桂馬を捕まえられるのを読み切れば踏み込める。',
  '相手の角は意外と広く，銀を打つのは勿体無い。一歩取られてしまう。',
  '棒銀を狙っているが，攻めが重たく相手にされない。相手の角の位置が良いので先行して攻められる。',
  '持ち駒に香があるため相手の飛車は捕まっている。落ち着いて捕まえに行く。',
  '攻防の角となっているが８四の地点にコマを足しても強い攻めにならない。',
  '先に銀の頭に歩を打つ手が好手。',
  '先手を取られ▲２二歩が後の▲３一角打を狙った手で厳しい。',
  '自分の銀をどかして桂馬を捕まえに行ってよい。銀交換して相手からの△３八銀打は問題ない。',
  '相手の８筋からの攻めが少しうるさくなる。',
  '先手を取られて△２七金とされると一気に厳しくなる。',
  '△１六桂に▲同角とできないので角を打った意味があまりない。香取りは変に受けない方が良い。',
  'ただ銀を交換しても相手は厳しくない。',
  '先に歩を打つが、相手の銀がくっつきいい形になってしまう。',
  '自玉がかなり危険になる。',
  '馬を切っても持ち駒が豊富なため攻めがつながる。相手は浮きゴマが多く、大ゴマを捨てられない。',
  '両取りの桂馬を打たれて後手ペースとなる。',
  '▲２三歩と垂らすのが相手の弱点。△同金には▲４二桂馬成が厳しく，放置すると相手の金が捕まっている。',
  '相手の大駒を狙に行くが，△同飛車とされて飛車を３筋に回られ大悪手となる。',
  '飛車を逃げると44桂打ちが激痛 詰めろなので香車を取る一択だが、冷静に同銀と取られて下手よし。',
  '悪くはないが、なんの為に将棋を指しているのか分からない。',
  '次善手だが、駒を大量に渡してしまうので実践的には危うい。',
  '少し悪いが飛車角交換をして攻めるのが最善手。',
  '桂馬を取られて▲５三桂打が厳しく後手敗勢。',
  '相手の角が狭いので誘導し技をかける。形勢は互角。',
  '先手の角と飛車の位置が良いため，角出を無視すると攻めがうるさい。',
  '桂打から一見危なく見えるが、相手玉は詰まない。',
  '同歩が最善だが、同飛車99角成に飛車まわりが絶品。持ち駒は少ないが互角',
  '95角と打たれ龍を逃げても99角なりとされ劣勢。',
  '相手の手は多いが、こちらは持ち駒が少なく手が少ない。',
  '銀をとられても２六の金を取る手の筋が抜群で先手大優勢。',
  '４五の角が相手の飛車を見ているため、銀をどかしてからの▲５五歩をとれず相手が厳しい。',
  '次の▲２五桂をねらっているが、そこまで厳しい攻めにならない。',
  '自玉の右側が狭いので左に逃げたくなるが、馬に左側も制圧されてしまう。',
  '左右から攻める心意気は良いが，緩手のため無視される。',
  '相手の端が弱いのは確かだが，相手玉に逃げ道がある盤面では少し重たい攻め。',
  'ここは急がず確実な弱点である端を攻める。',
  '５筋のコマの数が負けており，角も詰まされてしまうため厳しくなる。',
  '一手パスすると飛車や桂馬を足され５筋が厳しくなる。',
  '５筋にコマを足し飛車回りに備える好手。',
  '相手の△２九飛成が先手となり悪手。',
  '△６一銀で守られるためここでは緩手。',
  '角を切られて相手が一気に固くなる。',
  '自玉が固くみえるが，意外と弱い。△４五桂打と△５七角成の両方を消す一手。',
];

app.post('/api/generate-explanations', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
    return;
  }

  const { sfen, sideToMove, choices } = req.body;
  if (!sfen || !Array.isArray(choices) || choices.length === 0) {
    res.status(400).json({ error: 'sfen and choices are required' });
    return;
  }

  // Validate choices structure
  for (const c of choices) {
    if (!c.label || typeof c.label !== 'string') {
      res.status(400).json({ error: 'each choice must have a label' });
      return;
    }
  }

  const examplesText = FEW_SHOT_EXAMPLES.map(
    (ex) =>
      `指し手: ${ex.label} | 評価値: ${ex.eval_cp}cp (${ex.eval_percent}%) | 読み筋: ${ex.line_labels || 'なし'}\n解説: ${ex.explanation}`,
  ).join('\n\n');

  const choicesList = choices
    .map(
      (c: any, i: number) =>
        `${i + 1}. 指し手: ${c.label} | 評価値: ${c.eval_cp ?? '不明'}cp (${c.eval_percent ?? '不明'}%) | 読み筋: ${c.line_labels || 'なし'}${c.is_correct ? ' [正解手]' : ''}`,
    )
    .join('\n');

  const sideLabel = sideToMove === 'sente' ? '先手' : '後手';

  const styleExamplesText = STYLE_EXAMPLES.map((ex, i) => `${i + 1}. ${ex}`).join('\n');

  const prompt = `あなたは将棋の一手問題の解説者です。以下のルールに従って各選択肢の解説を生成してください。

## 解説の基本ルール

【全選択肢共通】
- 読み筋の具体的な手順を示しながら、その手の評価を説明する
- 1～3文程度のコンパクトな解説にする
- 将棋ファンに向けた自然な口語調で書く（常体：だ・である調、敬体は使わない）
- 文頭で「▲５六歩は」「△２九飛成は」のように選択肢の手を主語とせず、局面の狙いや形勢判断から書き始める
- 駒の符号は「▲３一角打」「△２二玉」のように先手は▲、後手は△、数字は全角、駒名は漢字の形式で書く
- 断定の強さは評価値差で調整する（差が小さい≒穏やかな表現、差が大きい≒強い表現）
- 語彙や言い回しは、下の実例に出てくる表現を優先して使うこと。新しい比喩や珍しい言い回しは増やさず、既存データにある自然な語彙を選ぶこと
- 例えば「いなす」のような、実例にない言い回しはできるだけ避けること

【正解手（[正解手]のマーク付き）の場合】
→ なぜこの手が「良い」のか、その手の「長所」「狙い」「効果」を中心に説明する
→ ポジティブな観点から記述する
→ 評価値が高い（+）なら、その優位性を説明する

【不正解手の場合】
→ なぜこの手が「ダメ」なのか、その手の「短所」「問題点」「弱点」を中心に説明する
→ 相手にされた攻撃や主導権喪失などの具体的な悪さを示す
→ 評価値が低い（-）なら、その劣位性を説明する

## スタイル参考（実例から学ぶ）

${styleExamplesText}

## 学習用の解説例

${examplesText}

## 対象局面

局面 (SFEN): ${sfen}
手番: ${sideLabel}

選択肢一覧:
${choicesList}

## 出力形式

JSON配列形式で返すこと。他の文字や説明は一切不要：
[
  {"index": 0, "explanation": "解説"},
  {"index": 1, "explanation": "解説"},
  {"index": 2, "explanation": "解説"}
]`;

  try {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: 'o1-2024-12-17',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = completion.choices[0]?.message?.content ?? '';

    // Extract JSON array from the response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      res.status(500).json({ error: 'Failed to parse AI response', raw: text });
      return;
    }

    const explanations = JSON.parse(jsonMatch[0]) as Array<{
      index: number;
      explanation: string;
    }>;

    const prefixedExplanations = explanations.map((item) => ({
      ...item,
      explanation: item.explanation.startsWith('【AI解説 (試験的) 】')
        ? item.explanation
        : `【AI解説 (試験的) 】${item.explanation}`,
    }));

    res.json({ explanations: prefixedExplanations });
  } catch (err: any) {
    console.error('OpenAI API error:', err);
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
    if (process.env.ENABLE_SHOGI_ENGINE === '1') {
      await engine.start();
      console.log('Shogi engine enabled');
    } else {
      console.log('Shogi engine disabled. Set ENABLE_SHOGI_ENGINE=1 to enable engine APIs.');
    }
    app.listen(PORT, HOST, () => {
      console.log(`Express API server running on http://${HOST}:${PORT}`);
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
