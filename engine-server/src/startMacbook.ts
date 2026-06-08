import 'dotenv/config';
import { existsSync } from 'fs';
import path from 'path';
import { ShogiEngine } from './engine.js';

const MAC_ENGINE_NAMES = [
  'YaneuraOu_NNUE_halfKP256-V830Git_APPLEM1',
  'YaneuraOu_NNUE_halfkp_1024x2_8_64-V900Git_APPLEM1',
];

function engineServerRoot(): string {
  return path.resolve(import.meta.dirname, '..');
}

function resolveEvalDir(root: string, enginePath: string): string {
  const fromEnv = process.env.EVAL_DIR?.trim();
  if (fromEnv) return fromEnv;

  const candidates = [
    path.join(path.dirname(enginePath), 'eval'),
    path.join(root, 'engines', 'eval'),
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, 'nn.bin'))) ?? candidates[0];
}

async function validateEngine(enginePath: string, evalDir: string): Promise<boolean> {
  const engine = new ShogiEngine(enginePath, evalDir);
  try {
    await engine.start();
    return true;
  } catch (error: any) {
    console.warn(`[macbook] engine validation failed: ${enginePath}`);
    console.warn(`[macbook] ${error?.message ?? error}`);
    return false;
  } finally {
    engine.stop();
  }
}

async function selectMacEngine(): Promise<string> {
  if (process.platform !== 'darwin') {
    throw new Error('start:macbook is intended for macOS');
  }

  const root = engineServerRoot();
  const candidates = MAC_ENGINE_NAMES.map((name) => path.join(root, 'engines', 'mac', name));

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      console.warn(`[macbook] engine not found: ${candidate}`);
      continue;
    }
    console.log(`[macbook] validating engine: ${candidate}`);
    const evalDir = resolveEvalDir(root, candidate);
    console.log(`[macbook] validating eval dir: ${evalDir}`);
    const ok = await validateEngine(candidate, evalDir);
    if (ok) return candidate;
  }

  throw new Error(`No usable macOS engine found. Tried: ${candidates.join(', ')}`);
}

async function main() {
  process.env.HOST = process.env.HOST?.trim() || '0.0.0.0';
  process.env.PORT = process.env.PORT?.trim() || '8765';
  process.env.ENABLE_SHOGI_ENGINE = process.env.ENABLE_SHOGI_ENGINE?.trim() || '1';
  process.env.AMTS_ENGINE_THREADS = process.env.AMTS_ENGINE_THREADS?.trim() || '4';
  process.env.AMTS_ENGINE_HASH_MB = process.env.AMTS_ENGINE_HASH_MB?.trim() || '1024';
  process.env.AMTS_ENGINE_OWN_BOOK = process.env.AMTS_ENGINE_OWN_BOOK?.trim() || 'false';
  process.env.FV_SCALE = process.env.FV_SCALE?.trim() || '40';
  process.env.AMTS_FINALIZE_DEPTH = process.env.AMTS_FINALIZE_DEPTH?.trim() || '24';
  process.env.AMTS_ENGINE_USI_OPTIONS = process.env.AMTS_ENGINE_USI_OPTIONS?.trim()
    || [
      'FV_SCALE=40',
      'ConsiderationMode=false',
      'OutputFailLHPV=false',
      'DrawValueBlack=0',
      'DrawValueWhite=0',
    ].join(';');

  process.env.ENGINE_PATH = await selectMacEngine();
  process.env.EVAL_DIR = resolveEvalDir(engineServerRoot(), process.env.ENGINE_PATH);
  console.log(`[macbook] selected engine: ${process.env.ENGINE_PATH}`);
  console.log(`[macbook] eval dir: ${process.env.EVAL_DIR}`);

  await import('./index.js');
}

void main().catch((error) => {
  console.error('[macbook] failed to start:', error);
  process.exit(1);
});
