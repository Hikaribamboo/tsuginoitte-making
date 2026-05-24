import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

import { UsiEngine } from "../src/engine";
import { selfPlayConfig } from "../src/configs/selfPlayConfig";
import { loadBasePositions } from "../src/selfPlay/basePositions";
import { buildKifuInsertRow, insertKifuRows, validateKifuInsertRow } from "../src/selfPlay/kifuInsert";
import { runSelfPlayGame } from "../src/selfPlay/runSelfPlayGame";
import type { KifuInsertRow } from "../src/selfPlay/types";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set`);
  }
  return v;
}

function validateConfig(): void {
  if (!selfPlayConfig.runName.trim()) throw new Error("runName must not be empty");
  if (!Number.isInteger(selfPlayConfig.gamesPerBasePosition) || selfPlayConfig.gamesPerBasePosition <= 0) {
    throw new Error("gamesPerBasePosition must be a positive integer");
  }
  if (!Number.isInteger(selfPlayConfig.maxMoves) || selfPlayConfig.maxMoves <= 0) {
    throw new Error("maxMoves must be a positive integer");
  }
}

function parseOptionalPositiveInt(raw: string | undefined): number | null {
  if (!raw || !raw.trim()) return null;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

async function main() {
  // Usage:
  // npx ts-node scripts/generateKifus.ts
  validateConfig();

  const basePositions = loadBasePositions();
  const payload: KifuInsertRow[] = [];
  const totalGamesLimit = parseOptionalPositiveInt(process.env.AMTS_SP_TOTAL_GAMES);

  const blackEngine = new UsiEngine({ engineExePath: selfPlayConfig.engineBlack.enginePath });
  const whiteEngine = new UsiEngine({ engineExePath: selfPlayConfig.engineWhite.enginePath });

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
    console.log(`[self-play] runName=${selfPlayConfig.runName}`);
    console.log(`[self-play] basePositions=${basePositions.length} gamesPerBasePosition=${selfPlayConfig.gamesPerBasePosition}`);
    if (totalGamesLimit != null) {
      console.log(`[self-play] total game limit enabled: ${totalGamesLimit}`);
    }
    console.log(
      `[self-play] randomness black=${selfPlayConfig.engineBlack.randomness} white=${selfPlayConfig.engineWhite.randomness} (reserved, currently unused)`
    );

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
        } catch (e: any) {
          console.warn(`[self-play] skipped invalid row base=${base.id} game=${i + 1}: ${String(e?.message ?? e)}`);
        }

        if (selfPlayConfig.verboseLogging) {
          console.log(
            `[self-play] base=${base.id} game=${i + 1}/${selfPlayConfig.gamesPerBasePosition} plies=${result.moves.length} end=${result.terminationReason}`
          );
        }
      }
    }

    console.log(`[self-play] generated valid rows=${payload.length}`);

    if (!selfPlayConfig.insertToSupabase) {
      console.log("[self-play] insertToSupabase=false so DB insert was skipped");
      return;
    }

    const supabaseUrl = mustEnv("SUPABASE_URL");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    await insertKifuRows({
      supabase,
      rows: payload,
      verboseLogging: selfPlayConfig.verboseLogging,
    });

    console.log("[self-play] done");
  } finally {
    await blackEngine.quit();
    await whiteEngine.quit();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
