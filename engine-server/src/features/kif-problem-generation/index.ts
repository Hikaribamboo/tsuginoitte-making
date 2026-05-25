// src/index.ts
import { writeFileSync } from "fs";
import { resolve } from "path";
import { kifu } from "./data/kifu";
import { startCoarse } from "./debug/coarsePerf";
import { createUsiEngineClient, getEnginePath } from "../../services/engine/engineClient";
import { config } from "./config";
import { scanGame } from "./scanGame";
import { buildProblemOutFromScan } from "./problem/problemBuilder";
import { buildInsertSql } from "./sql/buildSql";

async function main() {
  const engine = createUsiEngineClient(getEnginePath());

  await engine.init({
    multipv: config.scan.multipv,
    disableBook: config.engine.disableBook,
    threads: config.engine.threads,
    hashMb: config.engine.hashMb,
    ponder: config.engine.ponder,
  });

  const initialSfen = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
  const moves = kifu.trim().split(/\s+/);

  const endScan = startCoarse("TOTAL scanGame");
  const scans = await scanGame({ engine, initialSfen, moves });
  endScan();

  const prompt = "最善手を選んでください";
  let nextId = 58;

  const endSql = startCoarse("TOTAL SQL build");
  const sqlBlocks: string[] = [];

  for (const scan of scans.slice(0, 3)) {
    // src/index.ts の呼び出し部分だけ
// src/index.ts の呼び出し部分
  const problemOut = await buildProblemOutFromScan({
    engine,
    scan,
    problemId: nextId,
    createdAt: new Date().toISOString(),
    prompt,
    blunderThreshold: config.finalize.blunderThresholdCp,
    shuffleSeed: nextId,
    evalScale: config.eval.scale,
    rootEvalDepth: config.scan.depth,
    rootEvalPvPlies: 2,
    rejectIfBestTooBadCp: config.finalize.rejectIfBestTooBadCp,
    rejectIfBestTooGoodCp: config.finalize.rejectIfBestTooGoodCp,
  });

    if (!problemOut) continue;

    sqlBlocks.push(buildInsertSql(problemOut));
    nextId += 1;
  }

  const out = sqlBlocks.join("\n\n");
  const outPath = resolve(process.cwd(), "out.sql");
  writeFileSync(outPath, out, "utf8");
  endSql();

  console.log(`written: ${outPath}`);

  await engine.quit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
