import "dotenv/config";
import { existsSync } from "fs";
import path from "path";

import { engineConfig } from "../../../engine-config.js";
import { AnalyzeError } from "../engine.js";
import { createUsiEngineClient, getEnginePath, type EngineClient } from "../../../services/engine/engineClient.js";

type BenchOptions = {
  position: string;
  depth: number;
  move: string | null;
  multipv: number;
  repeat: number;
  freshEngine: boolean;
  threads: number;
  hashMb: number;
  maxMs: number;
};

function parsePositiveInt(value: string | undefined, name: string, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parseBoolean(value: string | undefined, name: string, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function parseArgs(argv: string[]): BenchOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`invalid argument near: ${key ?? "(end)"}`);
    values.set(key.slice(2), value);
  }

  const position = values.get("position")?.trim();
  if (!position?.startsWith("position ")) throw new Error('--position must start with "position "');

  return {
    position,
    depth: parsePositiveInt(values.get("depth"), "depth", 26),
    move: values.get("move")?.trim() || null,
    multipv: parsePositiveInt(values.get("multipv"), "multipv", 1),
    repeat: parsePositiveInt(values.get("repeat"), "repeat", 3),
    freshEngine: parseBoolean(values.get("freshEngine"), "freshEngine", false),
    threads: parsePositiveInt(values.get("threads"), "threads", engineConfig.threads),
    hashMb: parsePositiveInt(values.get("hashMb"), "hashMb", engineConfig.hashMb),
    maxMs: parsePositiveInt(values.get("maxMs"), "maxMs", 5 * 60 * 1000),
  };
}

function resolveEngineEvalDir(enginePath: string): string {
  const fromEnv = process.env.EVAL_DIR?.trim();
  if (fromEnv) return fromEnv;

  const candidates = [
    path.join(path.dirname(enginePath), "eval"),
    path.join(path.dirname(enginePath), "..", "eval"),
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, "nn.bin")))
    ?? candidates.find((candidate) => existsSync(candidate))
    ?? candidates[0];
}

async function createEngine(enginePath: string, engineEvalDir: string, options: BenchOptions): Promise<EngineClient> {
  const engine = createUsiEngineClient(enginePath, engineEvalDir);
  await engine.init({
    multipv: options.multipv,
    disableBook: !engineConfig.ownBook,
    threads: options.threads,
    cores: options.threads,
    hashMb: options.hashMb,
    pvIntervalMs: engineConfig.pvIntervalMs,
    ponder: engineConfig.ponder,
  });
  return engine;
}

async function closeEngine(engine: EngineClient | null): Promise<void> {
  if (!engine) return;
  await engine.quit().catch(() => undefined);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const enginePath = process.env.ENGINE_PATH?.trim() || getEnginePath();
  const engineEvalDir = resolveEngineEvalDir(enginePath);
  let engine: EngineClient | null = null;

  console.error(`[benchPosition] options=${JSON.stringify({ ...options, enginePath, engineEvalDir })}`);

  try {
    for (let run = 1; run <= options.repeat; run += 1) {
      if (!engine || options.freshEngine) {
        await closeEngine(engine);
        engine = await createEngine(enginePath, engineEvalDir, options);
      }

      const startedAt = Date.now();
      const runContext = {
        run,
        freshEngine: options.freshEngine,
        position: options.position,
        depth: options.depth,
        move: options.move,
        multipv: options.multipv,
        threads: options.threads,
        hashMb: options.hashMb,
        maxMs: options.maxMs,
      };
      try {
        const result = await engine.analyze({
          positionCommand: options.position,
          depth: options.depth,
          pvPlies: 9,
          searchMoves: options.move ? [options.move] : undefined,
          label: `benchPosition-run${run}`,
          maxDurationMs: options.maxMs,
          logDiagnostics: false,
        });
        console.log(JSON.stringify({
          ...runContext,
          wallMs: result.diagnostics.wallMs,
          bestmove: result.bestmove,
          maxDepth: result.diagnostics.maxDepth,
          lastDepth: result.diagnostics.lastDepth,
          nodes: result.diagnostics.nodes,
          nps: result.diagnostics.nps,
          hashfull: result.diagnostics.hashfull,
          lastScore: result.diagnostics.lastScore,
          timeout: result.diagnostics.timeout,
        }));
      } catch (error) {
        const diagnostics = error instanceof AnalyzeError ? error.diagnostics : null;
        console.log(JSON.stringify({
          ...runContext,
          wallMs: diagnostics?.wallMs ?? Date.now() - startedAt,
          bestmove: diagnostics?.bestmove ?? null,
          maxDepth: diagnostics?.maxDepth ?? null,
          lastDepth: diagnostics?.lastDepth ?? null,
          nodes: diagnostics?.nodes ?? null,
          nps: diagnostics?.nps ?? null,
          hashfull: diagnostics?.hashfull ?? null,
          lastScore: diagnostics?.lastScore ?? null,
          timeout: diagnostics?.timeout ?? false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  } finally {
    await closeEngine(engine);
  }
}

main().catch((error) => {
  console.error(`[benchPosition] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
