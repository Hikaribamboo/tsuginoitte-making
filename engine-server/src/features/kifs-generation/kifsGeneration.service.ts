import path from 'path';

export type KifsGenerationSettings = {
  generateRunName?: string | null;
  gamesPerBasePosition?: number | null;
  totalGames?: number | null;
  maxMoves?: number | null;
  blackNodes?: number | null;
  whiteNodes?: number | null;
  blackMovetimeMs?: number | null;
  whiteMovetimeMs?: number | null;
};

export type RunCommand = (
  cmd: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
) => Promise<void>;

export type KifsGenerationResult = {
  notes: string[];
};

type KifsGenerationJobArgs = {
  settings: KifsGenerationSettings;
  rootDir: string;
  runCommand: RunCommand;
  setStep: (step: string) => void;
};

export async function runKifsGenerationJob(args: KifsGenerationJobArgs): Promise<KifsGenerationResult> {
  const { settings, rootDir, runCommand, setStep } = args;
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (settings.generateRunName) env.AMTS_SP_RUN_NAME = settings.generateRunName;
  if (settings.gamesPerBasePosition != null) env.AMTS_SP_GAMES_PER_BASE_POSITION = String(settings.gamesPerBasePosition);
  if (settings.totalGames != null) env.AMTS_SP_TOTAL_GAMES = String(settings.totalGames);
  if (settings.maxMoves != null) env.AMTS_SP_MAX_MOVES = String(settings.maxMoves);
  if (settings.blackNodes != null) env.AMTS_SP_BLACK_NODES = String(settings.blackNodes);
  if (settings.whiteNodes != null) env.AMTS_SP_WHITE_NODES = String(settings.whiteNodes);
  if (settings.blackMovetimeMs != null) env.AMTS_SP_BLACK_MOVETIME_MS = String(settings.blackMovetimeMs);
  if (settings.whiteMovetimeMs != null) env.AMTS_SP_WHITE_MOVETIME_MS = String(settings.whiteMovetimeMs);
  if (!env.ENGINE_PATH) {
    env.ENGINE_PATH = path.join(rootDir, 'src', 'engines', 'mac', 'YaneuraOu_NNUE_halfKP256-V830Git_APPLEM1');
  }

  setStep('kifs 生成中 (generate:kifus)');
  const tsxPath = path.join(rootDir, 'node_modules', '.bin', 'tsx');
  await runCommand(tsxPath, ['--no-cache', 'src/features/kifs-generation/tools/generateKifus.ts'], rootDir, env);
  return { notes: ['generate:kifus completed'] };
}
