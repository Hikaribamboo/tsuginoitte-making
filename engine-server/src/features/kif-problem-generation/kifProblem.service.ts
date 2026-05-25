import path from 'path';

export type KifProblemSettings = {
  runBatchGenerate: boolean;
  bookPath?: string | null;
  bookIndexFile?: string | null;
  stateFile?: string | null;
  bookType?: 'petashock' | 'qhapaq';
  enginePath?: string | null;
  batchSize?: number | null;
  maxProblemsPerGame?: number | null;
  maxScanResultsPerGame?: number | null;
  scanDepth?: number | null;
  finalizeDepth?: number | null;
  suspiciousMinDiff?: number | null;
  suspiciousMaxDiff?: number | null;
  maxDiff?: number | null;
  randomSeed?: number | null;
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

export type KifProblemResult = {
  notes: string[];
};

type KifProblemJobArgs = {
  settings: KifProblemSettings;
  rootDir: string;
  runCommand: RunCommand;
  setStep: (step: string) => void;
};

export async function runKifProblemJob(args: KifProblemJobArgs): Promise<KifProblemResult> {
  const { settings, rootDir, runCommand, setStep } = args;
  if (!settings.runBatchGenerate) {
    return { notes: [] };
  }

  setStep('kif から問題生成中 (batchGenerate)');

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (settings.bookPath) env.BOOK_PATH = settings.bookPath;
  if (settings.bookIndexFile) env.BOOK_INDEX_FILE = settings.bookIndexFile;
  if (settings.stateFile) env.STATE_FILE = settings.stateFile;
  if (settings.bookType) env.BOOK_TYPE = settings.bookType;
  if (settings.enginePath) env.ENGINE_PATH = settings.enginePath;
  if (settings.batchSize != null) env.AMTS_BATCH_SIZE = String(settings.batchSize);
  if (settings.maxProblemsPerGame != null) env.AMTS_MAX_PROBLEMS_PER_GAME = String(settings.maxProblemsPerGame);
  if (settings.maxScanResultsPerGame != null) env.AMTS_MAX_SCAN_RESULTS_PER_GAME = String(settings.maxScanResultsPerGame);
  if (settings.scanDepth != null) env.AMTS_SCAN_DEPTH = String(settings.scanDepth);
  if (settings.finalizeDepth != null) env.AMTS_FINALIZE_DEPTH = String(settings.finalizeDepth);
  if (settings.suspiciousMinDiff != null) env.AMTS_SUSPICIOUS_MIN_DIFF = String(settings.suspiciousMinDiff);
  if (settings.suspiciousMaxDiff != null) env.AMTS_SUSPICIOUS_MAX_DIFF = String(settings.suspiciousMaxDiff);
  if (settings.generateRunName) env.AMTS_SP_RUN_NAME = settings.generateRunName;
  if (settings.gamesPerBasePosition != null) env.AMTS_SP_GAMES_PER_BASE_POSITION = String(settings.gamesPerBasePosition);
  if (settings.totalGames != null) env.AMTS_SP_TOTAL_GAMES = String(settings.totalGames);
  if (settings.maxMoves != null) env.AMTS_SP_MAX_MOVES = String(settings.maxMoves);
  if (settings.blackNodes != null) env.AMTS_SP_BLACK_NODES = String(settings.blackNodes);
  if (settings.whiteNodes != null) env.AMTS_SP_WHITE_NODES = String(settings.whiteNodes);
  if (settings.blackMovetimeMs != null) env.AMTS_SP_BLACK_MOVETIME_MS = String(settings.blackMovetimeMs);
  if (settings.whiteMovetimeMs != null) env.AMTS_SP_WHITE_MOVETIME_MS = String(settings.whiteMovetimeMs);
  if (!env.ENGINE_PATH) {
    env.ENGINE_PATH = path.join(rootDir, 'engines', 'mac', 'YaneuraOu_NNUE_halfKP256-V830Git_APPLEM1');
  }

  const tsxPath = path.join(rootDir, 'node_modules', '.bin', 'tsx');
  await runCommand(tsxPath, ['--no-cache', 'src/features/kif-problem-generation/tools/batchGenerate.ts'], rootDir, env);
  return { notes: ['batchGenerate completed'] };
}
