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

function engineServerRoot(): string {
  return path.resolve(import.meta.dirname, '..', '..', '..');
}

function resolvePythonInvocations(): PythonInvocation[] {
  const fromEnv = process.env.PYTHON_BIN?.trim();
  if (fromEnv) return [{ command: fromEnv, prefixArgs: [] }];

  const root = engineServerRoot();
  const candidates: PythonInvocation[] = [];
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? '';
    const programFiles = process.env.ProgramFiles ?? '';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? '';
    const pythonVersions = ['313', '312', '311', '310'];
    for (const candidate of [
      path.join(root, '.venv', 'Scripts', 'python.exe'),
      path.join(resolveShogiDatasetRoot(), '.venv', 'Scripts', 'python.exe'),
      ...pythonVersions.flatMap((version) => [
        localAppData ? path.join(localAppData, 'Programs', 'Python', `Python${version}`, 'python.exe') : '',
        programFiles ? path.join(programFiles, `Python${version}`, 'python.exe') : '',
        programFilesX86 ? path.join(programFilesX86, `Python${version}`, 'python.exe') : '',
      ]),
    ]) {
      if (existsSync(candidate)) candidates.push({ command: candidate, prefixArgs: [] });
    }
    candidates.push({ command: 'python', prefixArgs: [] });
    candidates.push({ command: 'python3', prefixArgs: [] });
    candidates.push({ command: 'py', prefixArgs: ['-3'] });
    return candidates;
  }

  for (const candidate of [
    path.join(root, '.venv', 'bin', 'python'),
    path.join(resolveShogiDatasetRoot(), '.venv', 'bin', 'python'),
  ]) {
    if (existsSync(candidate)) candidates.push({ command: candidate, prefixArgs: [] });
  }
  candidates.push({ command: 'python3', prefixArgs: [] });
  candidates.push({ command: 'python', prefixArgs: [] });
  return candidates;
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

function isPythonNotFoundError(error: unknown): boolean {
  const err = error as { code?: unknown; stderr?: unknown; stdout?: unknown } | null;
  const code = err?.code;
  const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
  const stdout = typeof err?.stdout === 'string' ? err.stdout.trim() : '';
  return (
    code === 'ENOENT' ||
    code === 9009 ||
    code === '9009' ||
    stderr === 'Python' ||
    stdout === 'Python'
  );
}

async function runPython(args: string[]): Promise<{ stdout: string; stderr: string; commandLine: string }> {
  const attempts: string[] = [];
  let lastError = '';

  for (const python of resolvePythonInvocations()) {
    const fullArgs = [...python.prefixArgs, ...args];
    const commandLine = `${python.command} ${fullArgs.join(' ')}`;
    attempts.push(commandLine);

    try {
      const result = await execFileAsync(python.command, fullArgs, { maxBuffer: 10 * 1024 * 1024 });
      return { stdout: result.stdout, stderr: result.stderr, commandLine };
    } catch (error) {
      lastError = formatExecError(error);
      if (!isPythonNotFoundError(error)) {
        throw new Error(`prediction command failed: ${commandLine}\n${lastError}`);
      }
    }
  }

  throw new Error(
    [
      'prediction command failed: no Python executable was found',
      `attempted:\n${attempts.map((attempt) => `- ${attempt}`).join('\n')}`,
      lastError ? `last error:\n${lastError}` : '',
      'Set PYTHON_BIN to the full path of python.exe if Python is installed in a custom location.',
    ].filter(Boolean).join('\n'),
  );
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
    const args = [scriptPath, '--image', imagePath, '--model', modelPath];
    const fallbackSourceId = process.env.SHOGI_PREDICTION_FALLBACK_SOURCE_ID ?? '002';
    const fallbackMetadataPath = path.join(resolveShogiDatasetRoot(), 'metadata', `${fallbackSourceId}.json`);
    if (existsSync(fallbackMetadataPath)) {
      args.push('--fallback-source-id', fallbackSourceId);
    }

    const { stdout, stderr, commandLine } = await runPython(args);
    console.log(`[recognize] predictor command: ${commandLine}`);
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
