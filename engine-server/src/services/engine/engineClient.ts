import path from 'path';
import { existsSync } from 'fs';
import {
  UsiEngine,
  defaultEnginePath,
  type AnalyzeDiagnostics,
} from '../../features/kif-problem-generation/engine.js';

export type PvInfo = {
  multipv: number;
  evalType: 'cp' | 'mate';
  eval: number;
  pv: string[];
};

export type AnalyzeResult = {
  infos: PvInfo[];
  bestmove: string | null;
  diagnostics: AnalyzeDiagnostics;
};

export type AnalyzeArgs = {
  positionCommand: string;
  depth: number;
  pvPlies: number;
  searchMoves?: string[];
  label?: string;
  maxDurationMs?: number;
  stopWhen?: (info: PvInfo) => boolean;
  logDiagnostics?: boolean;
};

export type EngineInitOptions = {
  multipv: number;
  disableBook: boolean;
  threads?: number;
  cores?: number;
  hashMb?: number;
  pvIntervalMs?: number;
  ponder?: boolean;
};

export interface EngineClient {
  init(opts: EngineInitOptions): Promise<void>;
  setMultiPv(multipv: number): Promise<void>;
  analyze(args: AnalyzeArgs): Promise<AnalyzeResult>;
  write(line: string): void;
  waitFor(predicate: (line: string) => boolean, timeoutMs?: number): Promise<string>;
  quit(): Promise<void>;
  kill(): void;
}

export function createUsiEngineClient(engineExePath: string, engineEvalDir?: string): EngineClient {
  const engine = new UsiEngine({ engineExePath, engineEvalDir });

  return {
    init: (opts: EngineInitOptions) => engine.init(opts),
    setMultiPv: (m) => engine.setMultiPv(m),
    analyze: (args) => engine.analyze(args),
    write: (line) => engine.write(line),
    waitFor: (predicate, timeoutMs) => engine.waitFor(predicate, timeoutMs),
    quit: async () => {
      await engine.quit();
    },
    kill: () => engine.kill(),
  };
}

export { defaultEnginePath };

export function getEnginePath(): string {
  const fromEnv = process.env.ENGINE_PATH?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const isMac = process.platform === 'darwin';
  const engineGroupDir = isMac ? 'mac' : 'windows';
  const engineNames = isMac
    ? ['YaneuraOu_NNUE_halfKP256-V830Git_APPLEM1']
    : ['AobaNNUE_AVX2.exe', 'AobaNNUE_ZEN2.exe'];
  const candidates = engineNames.map((engineName) =>
    path.resolve(import.meta.dirname, '..', '..', '..', 'engines', engineGroupDir, engineName),
  );
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;

  return defaultEnginePath();
}
