import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeExistingExplanationDataset } from '../features/explanations/analysis/analyzeExistingExplanationDataset.js';
import { parseExistingExplanationDataset } from '../features/explanations/analysis/parseExistingDataset.js';
import type { AnalysisSummary } from '../features/explanations/analysis/types.js';
import { writeAnalysisReports } from '../features/explanations/analysis/writeAnalysisReports.js';

type Args = {
  input: string;
  out: string;
};

function parseArgs(argv: string[]): Args {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for --${key}`);
    }
    args.set(key, value);
    i += 1;
  }

  const input = args.get('input');
  const out = args.get('out') ?? './tmp/explanation-analysis';
  if (!input) {
    throw new Error('usage: npm run analyze:explanations -- --input ./data/next_move_explanations.json --out ./tmp/explanation-analysis');
  }
  return { input, out };
}

function topEntries(counts: Record<string, number>, limit = 10): Array<[string, number]> {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function formatNumber(value: number | null): string {
  return value == null ? '-' : value.toFixed(1);
}

function printSummary(summary: AnalysisSummary, outDir: string): void {
  const mergedPatternCounts: Record<string, number> = {};
  for (const [pattern, count] of Object.entries(summary.patternCountsCorrect)) {
    mergedPatternCounts[pattern] = (mergedPatternCounts[pattern] ?? 0) + count;
  }
  for (const [pattern, count] of Object.entries(summary.patternCountsWrong)) {
    mergedPatternCounts[pattern] = (mergedPatternCounts[pattern] ?? 0) + count;
  }

  console.log('[explanation-analysis] complete');
  console.log(`  output: ${outDir}`);
  console.log(`  problems: ${summary.problemCount}`);
  console.log(`  choices: ${summary.choiceCount}`);
  console.log(`  correct choices: ${summary.correctChoiceCount}`);
  console.log(`  wrong choices: ${summary.wrongChoiceCount}`);
  console.log(`  AI prefix choices: ${summary.aiPrefixChoiceCount}`);
  console.log(`  unknown choices: ${summary.unknownChoiceCount}`);
  console.log(`  unknown choice rate: ${summary.unknownChoiceRate.toFixed(3)}`);
  console.log(`  plan unknown primary reasons: ${summary.planUnknownPrimaryReasonCount}`);
  console.log(`  plan unknown primary reason rate: ${summary.planUnknownPrimaryReasonRate.toFixed(3)}`);
  console.log(`  unknown correct choices: ${summary.unknownCorrectChoiceCount}`);
  console.log(`  unknown wrong choices: ${summary.unknownWrongChoiceCount}`);
  console.log(`  average explanation length correct: ${formatNumber(summary.averageExplanationLengthCorrect)}`);
  console.log(`  average explanation length wrong: ${formatNumber(summary.averageExplanationLengthWrong)}`);
  console.log('  top suspectedPatterns:');
  for (const [pattern, count] of topEntries(mergedPatternCounts)) {
    console.log(`    ${pattern}: ${count}`);
  }
  console.log(`  unknown: ${summary.unknownChoiceCount}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  const outDir = path.resolve(args.out);
  const rawText = await readFile(inputPath, 'utf8');
  const rawJson = JSON.parse(rawText);
  const problems = parseExistingExplanationDataset(rawJson);
  const analysis = analyzeExistingExplanationDataset(problems);
  const summary = await writeAnalysisReports(analysis, outDir);
  printSummary(summary, outDir);
}

void main().catch((error) => {
  console.error('[explanation-analysis] failed:', error?.message ?? error);
  process.exit(1);
});
