import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  diagnoseExplanationDebugDirectory,
  listExplanationDebugDirectories,
  summarizeExplanationDiagnostics,
} from '../features/explanations/diagnoseExplanationDebug.js';
import { evaluateExplanationQuality } from '../features/explanations/evaluateExplanationQuality.js';

type CliOptions = {
  debugRoot: string;
  analysisSummaryPath: string;
  limit?: number;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    debugRoot: './tmp/explanation-generation-debug',
    analysisSummaryPath: './tmp/explanation-analysis/analysis-summary.json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--debug-root') {
      options.debugRoot = argv[index + 1] ?? options.debugRoot;
      index += 1;
    } else if (arg === '--analysis-summary') {
      options.analysisSummaryPath = argv[index + 1] ?? options.analysisSummaryPath;
      index += 1;
    } else if (arg === '--limit') {
      const value = Number(argv[index + 1]);
      options.limit = Number.isFinite(value) && value > 0 ? value : undefined;
      index += 1;
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const debugRoot = path.resolve(process.cwd(), options.debugRoot);
  const analysisSummaryPath = path.resolve(process.cwd(), options.analysisSummaryPath);
  const debugDirs = await listExplanationDebugDirectories(debugRoot, options.limit);
  const reports = [];

  for (const debugDir of debugDirs) {
    reports.push(await diagnoseExplanationDebugDirectory(debugDir, { write: true }));
  }

  const summary = summarizeExplanationDiagnostics(debugRoot, reports);
  const evaluation = await evaluateExplanationQuality({
    debugRoot,
    reports,
    analysisSummaryPath,
    write: true,
  });
  await mkdir(debugRoot, { recursive: true });
  await writeFile(path.join(debugRoot, 'diagnostic-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  console.log(JSON.stringify({
    debugRoot,
    folderCount: summary.folderCount,
    choiceCount: summary.choiceCount,
    codeCounts: summary.codeCounts,
    confidenceDistribution: summary.confidenceDistribution,
    output: path.join(debugRoot, 'diagnostic-summary.json'),
    evaluationOutput: path.join(debugRoot, 'evaluation-summary.json'),
    analysisFeatureCoverageOutput: path.join(debugRoot, 'analysis-feature-coverage.json'),
    metrics: evaluation.metrics,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
