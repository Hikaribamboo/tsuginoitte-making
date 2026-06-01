import { readFile } from 'fs/promises';
import path from 'path';

export type BookProblemSettings = {
  count: number;
  minDiff: number;
  maxDiff: number;
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

type GeneratorOutput = {
  summary?: {
    attemptedCount?: number;
    createdCount?: number;
    skippedCount?: number;
    startSfenOrdinal?: number;
    nextSfenOrdinal?: number;
    totalSfenCount?: number;
  };
  records?: Array<{ name: unknown; draft: unknown }>;
};

function resolveLocalBin(rootDir: string, command: string): string {
  return path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? `${command}.cmd` : command);
}

function parseGeneratedRecords(raw: unknown): Array<{ name: string; draft: Record<string, unknown> }> {
  const records = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as GeneratorOutput | null)?.records)
      ? (raw as GeneratorOutput).records!
      : [];

  return records
    .filter((item) => typeof item?.name === 'string' && item?.draft && typeof item.draft === 'object')
    .map((item) => ({ name: item.name as string, draft: item.draft as Record<string, unknown> }));
}

function summaryNotes(outputJsonPath: string, parsed: unknown): string[] {
  const summary = !Array.isArray(parsed) && parsed && typeof parsed === 'object'
    ? (parsed as GeneratorOutput).summary
    : null;
  const notes = [`output: ${outputJsonPath}`];
  if (summary) {
    notes.push(
      `book summary: attempted=${summary.attemptedCount ?? 0} created=${summary.createdCount ?? 0} skipped=${summary.skippedCount ?? 0}`,
    );
  }
  return notes;
}

export async function runBookProblemJob(args: BookProblemJobArgs): Promise<ProblemGenerationResult> {
  const { settings, rootDir, runCommand, setStep } = args;

  setStep('book から問題生成中');

  const outputJsonPath = path.join(rootDir, 'outputs', 'book_generated.json');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AMTS_BOOK_COUNT: String(settings.count),
    AMTS_BOOK_MIN_DIFF: String(settings.minDiff),
    AMTS_BOOK_MAX_DIFF: String(settings.maxDiff),
    AMTS_BOOK_OUTPUT_PATH: outputJsonPath,
  };

  const tsxPath = resolveLocalBin(rootDir, 'tsx');
  await runCommand(tsxPath, ['--no-cache', 'src/features/book-problem-generation/tools/generateFromBook.ts'], rootDir, env);

  setStep('生成結果を読み込み中');
  const raw = await readFile(outputJsonPath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  const generatedRecords = parseGeneratedRecords(parsed);

  return {
    createdCount: generatedRecords.length,
    generatedRecords,
    notes: summaryNotes(outputJsonPath, parsed),
  };
}
