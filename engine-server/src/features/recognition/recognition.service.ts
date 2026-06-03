import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);

type PythonInvocation = {
  command: string;
  prefixArgs: string[];
};

function resolveShogiDatasetRoot(): string {
  const fromEnv = process.env.SHOGI_DATASET_ROOT?.trim();
  if (fromEnv) return fromEnv;

  const engineServerRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const candidates = [
    path.join(engineServerRoot, 'python', 'recognition'),
    path.resolve(engineServerRoot, '..', 'python', 'recognition'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found ?? candidates[0];
}

export function resolvePredictionScriptPath(): string {
  return process.env.SHOGI_PREDICTION_SCRIPT ?? path.join(resolveShogiDatasetRoot(), 'scripts', 'predict_sfen.py');
}

export function resolvePredictionModelPath(): string {
  return process.env.SHOGI_PREDICTION_MODEL ?? path.join(resolveShogiDatasetRoot(), 'models', 'resnet18_shogi_piece_classifier.pt');
}

function decodeDataUrlImage(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) {
    throw new Error('image data URL is invalid');
  }
  return Buffer.from(match[1], 'base64');
}

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

function resolvePythonInvocation(): PythonInvocation {
  const fromEnv = process.env.PYTHON_BIN?.trim();
  if (fromEnv) return { command: fromEnv, prefixArgs: [] };
  if (process.platform === 'win32') return { command: 'py', prefixArgs: ['-3'] };
  return { command: 'python3', prefixArgs: [] };
}

function formatExecError(error: unknown): string {
  const err = error as {
    message?: unknown;
    code?: unknown;
    signal?: unknown;
    stdout?: unknown;
    stderr?: unknown;
  };
  const parts = [String(err?.message ?? error)];
  if (err?.code !== undefined) parts.push(`code=${String(err.code)}`);
  if (err?.signal !== undefined) parts.push(`signal=${String(err.signal)}`);

  const stdout = typeof err?.stdout === 'string' ? err.stdout.trim() : '';
  const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
  if (stdout) parts.push(`stdout:\n${stdout}`);
  if (stderr) parts.push(`stderr:\n${stderr}`);

  return parts.join('\n');
}

export async function runLocalShogiPrediction(imageDataUrl: string): Promise<any> {
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
    const python = resolvePythonInvocation();
    const args = [scriptPath, '--image', imagePath, '--model', modelPath];
    const fallbackSourceId = process.env.SHOGI_PREDICTION_FALLBACK_SOURCE_ID ?? '002';
    const fallbackMetadataPath = path.join(resolveShogiDatasetRoot(), 'metadata', `${fallbackSourceId}.json`);
    if (existsSync(fallbackMetadataPath)) {
      args.push('--fallback-source-id', fallbackSourceId);
    }

    let stdout = '';
    let stderr = '';
    try {
      const result = await execFileAsync(python.command, [...python.prefixArgs, ...args], { maxBuffer: 10 * 1024 * 1024 });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      throw new Error(`prediction command failed: ${python.command} ${[...python.prefixArgs, ...args].join(' ')}\n${formatExecError(error)}`);
    }
    if (stderr.trim()) {
      console.warn('[recognize] predictor stderr:', stderr.trim());
    }

    const parsed = extractJsonObject(stdout);
    if (!parsed || typeof parsed.sfen !== 'string') {
      throw new Error('Failed to parse prediction output');
    }
    return parsed;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
