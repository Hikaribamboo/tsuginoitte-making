import "dotenv/config";
import { existsSync } from "fs";
import path from 'path';
import { createClient } from "@supabase/supabase-js";

import { createUsiEngineClient } from "../../../services/engine/engineClient";
import { selfPlayConfig } from "../configs/selfPlayConfig.js";
import { loadBasePositions } from "../selfPlay/basePositions.js";
import { buildKifuInsertRow, insertKifuRows, validateKifuInsertRow } from "../selfPlay/kifuInsert.js";
import { runSelfPlayGame } from "../selfPlay/runSelfPlayGame.js";
import type { KifuInsertRow } from "../selfPlay/types.js";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set`);
  }
  return v;
}

function parseOptionalPositiveInt(raw: string | undefined): number | null {
  if (!raw || !raw.trim()) return null;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

function resolveEngineEvalDir(enginePath: string): string {
  const fromEnv = process.env.EVAL_DIR?.trim();
  if (fromEnv) return fromEnv;

  const candidates = [
    path.join(path.dirname(enginePath), 'eval'),
    path.join(path.dirname(enginePath), '..', 'eval'),
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, 'nn.bin')))
    ?? candidates.find((candidate) => existsSync(candidate))
    ?? candidates[0];
}

async function main() {
  const payload: KifuInsertRow[] = [];
  const totalGamesLimit = parseOptionalPositiveInt(process.env.AMTS_SP_TOTAL_GAMES);
  const engineEvalDir = resolveEngineEvalDir(selfPlayConfig.engineBlack.enginePath);
  console.error(`[generateKifus] blackEnginePath=${selfPlayConfig.engineBlack.enginePath} exists=${existsSync(selfPlayConfig.engineBlack.enginePath)}`);
  console.error(`[generateKifus] whiteEnginePath=${selfPlayConfig.engineWhite.enginePath} exists=${existsSync(selfPlayConfig.engineWhite.enginePath)}`);
  console.error(`[generateKifus] engineEvalDir=${engineEvalDir} exists=${existsSync(engineEvalDir)}`);
  const supabaseUrl = mustEnv("SUPABASE_URL");
  const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const basePositions = await loadBasePositions(supabase as any);

  const blackEngine = createUsiEngineClient(selfPlayConfig.engineBlack.enginePath, engineEvalDir);
  const whiteEngine = createUsiEngineClient(selfPlayConfig.engineWhite.enginePath, engineEvalDir);

  await blackEngine.init({
    multipv: 1,
    disableBook: selfPlayConfig.engineBlack.disableBook,
    threads: selfPlayConfig.engineBlack.threads,
    hashMb: selfPlayConfig.engineBlack.hashMb,
    ponder: selfPlayConfig.engineBlack.ponder,
  });

  await whiteEngine.init({
    multipv: 1,
    disableBook: selfPlayConfig.engineWhite.disableBook,
    threads: selfPlayConfig.engineWhite.threads,
    hashMb: selfPlayConfig.engineWhite.hashMb,
    ponder: selfPlayConfig.engineWhite.ponder,
  });

  try {
    let generatedGames = 0;
    outer: for (const base of basePositions) {
      for (let i = 0; i < selfPlayConfig.gamesPerBasePosition; i++) {
        if (totalGamesLimit != null && generatedGames >= totalGamesLimit) {
          break outer;
        }

        const result = await runSelfPlayGame({
          initialSfen: base.initial_sfen,
          maxMoves: selfPlayConfig.maxMoves,
          engineBlack: blackEngine,
          engineWhite: whiteEngine,
          configBlack: selfPlayConfig.engineBlack,
          configWhite: selfPlayConfig.engineWhite,
          verboseLogging: selfPlayConfig.verboseLogging,
        });

        const movesText = result.moves.join(" ");
        const row = buildKifuInsertRow({
          initialSfen: base.initial_sfen,
          movesText,
          tags: base.tags,
          basePositionId: base.id,
        });

        try {
          validateKifuInsertRow(row);
          payload.push(row);
          generatedGames += 1;
        } catch {
          // skip invalid row
        }
      }
    }

    if (!selfPlayConfig.insertToSupabase) {
      return;
    }

    await insertKifuRows({
      supabase,
      rows: payload,
      verboseLogging: selfPlayConfig.verboseLogging,
    });
  } finally {
    await blackEngine.quit();
    await whiteEngine.quit();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
