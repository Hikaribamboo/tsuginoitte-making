import path from 'path';
import { existsSync } from 'fs';
import { UsiEngine, defaultEnginePath } from './usiEngineAdapter.js';

export type PvInfo = {
  multipv: number;
  evalType: 'cp' | 'mate';
  eval: number;
  pv: string[];
};

export type AnalyzeResult = {
  infos: PvInfo[];
  bestmove: string | null;
};

export type EngineInitOptions = {
  multipv: number;
  disableBook: boolean;
  threads?: number;
  hashMb?: number;
  ponder?: boolean;
};

export interface EngineClient {
  init(opts: EngineInitOptions): Promise<void>;
  setMultiPv(multipv: number): Promise<void>;
  analyze(args: { positionCommand: string; depth: number; pvPlies: number; searchMoves?: string[]; label?: string }): Promise<AnalyzeResult>;
  write(line: string): void;
  waitFor(predicate: (line: string) => boolean, timeoutMs?: number): Promise<string>;
  quit(): Promise<void>;
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
  };
}

export { defaultEnginePath };

export function getEnginePath(): string {
  const fromEnv = process.env.ENGINE_PATH?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const isMac = process.platform === 'darwin';
  const engineName = isMac ? 'YaneuraOu_NNUE_halfKP256-V830Git_APPLEM1' : 'AobaNNUE_ZEN2.exe';
  const engineGroupDir = isMac ? 'mac' : 'windows';
  const candidates = [
    path.resolve(import.meta.dirname, '..', '..', '..', 'engines', engineGroupDir, engineName),
    path.resolve(import.meta.dirname, '..', '..', 'engines', engineGroupDir, engineName),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;

  return defaultEnginePath();
}
