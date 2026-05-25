import { existsSync } from 'fs';
import path from 'path';
import { readFile } from 'fs/promises';

export type BookProblemSettings = {
  bookPath: string;
  bookType: 'petashock' | 'qhapaq';
  enginePath: string;
  count: number;
  depth: number;
  namePrefix: string;
  scanMode: 'sequential' | 'random';
  incorrectSource: 'book' | 'legal';
  incorrectSelection: 'top' | 'bottom' | 'random' | 'mixed';
  minDiff: number;
  maxDiff: number | null;
  maxLineMoves: number;
  minLineMoves: number;
  randomSeed: number | null;
  limitScan: number | null;
  bookIndexFile: string | null;
  stateFile: string | null;
  verboseSkipLog: boolean;
  buildBookIndex: boolean;
};

export type RunCommand = (
  cmd: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
) => Promise<void>;

export type ProblemGenerationResult = {
  createdCount: number;
  generatedRecords: Array<{ name: string; draft: Record<string, unknown> }>;
  notes: string[];
};

type BookProblemJobArgs = {
  settings: BookProblemSettings;
  rootDir: string;
  runCommand: RunCommand;
  setStep: (step: string) => void;
};

export async function runBookProblemJob(args: BookProblemJobArgs): Promise<ProblemGenerationResult> {
  const { settings, rootDir, runCommand, setStep } = args;
  const projectVenvPython = path.join(rootDir, '.venv', 'bin', 'python');
  const pythonBin = process.env.PYTHON_BIN ?? (existsSync(projectVenvPython) ? projectVenvPython : 'python3');

  if (!settings.bookPath) {
    throw new Error('bookPath is required');
  }
  if (!settings.enginePath) {
    throw new Error('enginePath is required');
  }

  if (settings.buildBookIndex) {
    setStep('book index を作成中');
    const indexArgs = ['-m', 'src.main', '--book', settings.bookPath, '--book-type', settings.bookType, '--build-book-index'];
    if (settings.bookIndexFile) {
      indexArgs.push('--book-index-file', settings.bookIndexFile);
    }
    await runCommand(pythonBin, indexArgs, rootDir);
  }

  setStep('book から問題生成中');
  const commandArgs = [
    '-m',
    'src.main',
    '--book',
    settings.bookPath,
    '--book-type',
    settings.bookType,
    '--engine',
    settings.enginePath,
    '--count',
    String(settings.count),
    '--depth',
    String(settings.depth),
    '--name-prefix',
    settings.namePrefix,
    '--scan-mode',
    settings.scanMode,
    '--incorrect-source',
    settings.incorrectSource,
    '--incorrect-selection',
    settings.incorrectSelection,
    '--min-diff',
    String(settings.minDiff),
    '--max-line-moves',
    String(settings.maxLineMoves),
    '--min-line-moves',
    String(settings.minLineMoves),
    '--dry-run',
  ];

  if (settings.maxDiff !== null) {
    commandArgs.push('--max-diff', String(settings.maxDiff));
  }
  if (settings.randomSeed !== null) {
    commandArgs.push('--random-seed', String(settings.randomSeed));
  }
  if (settings.limitScan !== null) {
    commandArgs.push('--limit-scan', String(settings.limitScan));
  }
  if (settings.bookIndexFile) {
    commandArgs.push('--book-index-file', settings.bookIndexFile);
  }
  if (settings.stateFile) {
    commandArgs.push('--state-file', settings.stateFile);
  }
  if (settings.verboseSkipLog) {
    commandArgs.push('--verbose-skip-log');
  }

  await runCommand(pythonBin, commandArgs, rootDir);

  setStep('生成結果を読み込み中');
  const outputJsonPath = path.join(rootDir, 'outputs', 'petashock_generated.json');
  const raw = await readFile(outputJsonPath, 'utf-8');
  const parsed = JSON.parse(raw) as Array<{ name: unknown; draft: unknown }>;
  const generatedRecords = parsed
    .filter((item) => typeof item?.name === 'string' && item?.draft && typeof item.draft === 'object')
    .map((item) => ({ name: item.name as string, draft: item.draft as Record<string, unknown> }));

  return {
    createdCount: generatedRecords.length,
    generatedRecords,
    notes: [`output: ${outputJsonPath}`],
  };
}