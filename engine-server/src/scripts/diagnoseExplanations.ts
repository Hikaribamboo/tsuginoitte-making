import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  diagnoseExplanationDebugDirectory,
  listExplanationDebugDirectories,
  summarizeExplanationDiagnostics,
} from '../features/explanations/diagnoseExplanationDebug.js';

type CliOptions = {
  debugRoot: string;
  limit?: number;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    debugRoot: './tmp/explanation-generation-debug',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--debug-root') {
      options.debugRoot = argv[index + 1] ?? options.debugRoot;
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
  const debugDirs = await listExplanationDebugDirectories(debugRoot, options.limit);
  const reports = [];

  for (const debugDir of debugDirs) {
    reports.push(await diagnoseExplanationDebugDirectory(debugDir, { write: true }));
  }

  const summary = summarizeExplanationDiagnostics(debugRoot, reports);
  await mkdir(debugRoot, { recursive: true });
  await writeFile(path.join(debugRoot, 'diagnostic-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  console.log(JSON.stringify({
    debugRoot,
    folderCount: summary.folderCount,
    choiceCount: summary.choiceCount,
    codeCounts: summary.codeCounts,
    confidenceDistribution: summary.confidenceDistribution,
    output: path.join(debugRoot, 'diagnostic-summary.json'),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
