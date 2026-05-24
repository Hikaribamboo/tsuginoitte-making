import path from 'path';
import { readdir } from 'fs/promises';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');

export type MakingPathOptions = {
  enginePaths: string[];
  bookPaths: string[];
};

async function listFilesRecursive(
  rootDir: string,
  matcher: (filePath: string) => boolean,
  maxDepth = 4,
): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, String(entry.name));
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entry.isFile() && matcher(fullPath)) {
        out.push(fullPath);
      }
    }
  }

  await walk(rootDir, 0);
  return out;
}

export async function listMakingPathOptions(): Promise<MakingPathOptions> {
  const enginesDir = path.join(REPO_ROOT, 'tuginoitte-making', 'tsuginoitte-making', 'engines');
  const autoMakeDir = path.join(REPO_ROOT, 'auto-make-tsumeshogi');
  const draftMakingDir = path.join(REPO_ROOT, 'tsuginoitte-draft-making');

  const [enginePaths, bookPaths] = await Promise.all([
    listFilesRecursive(
      enginesDir,
      (filePath) =>
        !filePath.endsWith('.txt') &&
        !filePath.endsWith('.md') &&
        !filePath.endsWith('.json') &&
        !filePath.endsWith('.yaml') &&
        !filePath.endsWith('.yml'),
    ),
    Promise.all([
      listFilesRecursive(autoMakeDir, (filePath) => filePath.endsWith('.db')),
      listFilesRecursive(draftMakingDir, (filePath) => filePath.endsWith('.db')),
    ]).then(([a, b]) => [...a, ...b]),
  ]);

  return {
    enginePaths: Array.from(new Set(enginePaths)).sort(),
    bookPaths: Array.from(new Set(bookPaths)).sort(),
  };
}
