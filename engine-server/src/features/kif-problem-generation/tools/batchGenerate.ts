import "dotenv/config";
import path from 'path';
import { createClient } from "@supabase/supabase-js";

import { createUsiEngineClient, getEnginePath } from "../../../services/engine/engineClient";
import { config } from "../config.js";
import { createChoiceLabel } from "../label/createChoiceLabel.js";
import { buildProblemOutFromScan } from "../problem/problemBuilder.js";
import { scanGame } from "../scanGame.js";

type KifuRow = {
  id: number;
  initial_sfen: string;
  moves: string;
};

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function splitMoves(movesText: string): string[] {
  return movesText.trim().split(/\s+/).filter(Boolean);
}

function msToMinSec(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${String(s).padStart(2, "0")}s`;
}

export async function main() {
  const supabaseUrl = mustEnv("SUPABASE_URL");
  const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const enginePath = process.env.ENGINE_PATH?.trim() || getEnginePath();
  const engineEvalDir = process.env.EVAL_DIR?.trim() || path.join(path.dirname(enginePath), '..', 'eval');

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const engine = createUsiEngineClient(enginePath, engineEvalDir);

  await engine.init({
    multipv: config.scan.multipv,
    disableBook: config.engine.disableBook,
    threads: config.engine.threads,
    hashMb: config.engine.hashMb,
    ponder: config.engine.ponder,
  });

  const BATCH_MAX_MS = 30 * 60 * 1000;
  const batchStartMs = Date.now();

  try {
    const { data, error } = await supabase.rpc("claim_kifus", {
      batch_size: config.batch.generateBatchSize,
    });
    if (error) throw error;

    const kifus = (data ?? []) as KifuRow[];
    if (kifus.length === 0) {
      return;
    }

    const createdAt = new Date().toISOString();
    const prompt = "最善手を選んでください";

    const reviewProblemsPayload: Array<{
      created_at: string;
      prompt: string;
      root_sfen: string;
      correct_choice_id: number;
      intro_moves_usi: string[];
      root_eval_cp: number;
      root_eval_percent: number;
    }> = [];

    const reviewChoicesStash: Array<{
      tmpIndex: number;
      choice_id: number;
      usi: string;
      eval_cp: number;
      eval_percent: number;
      explanation: string;
      line: string[];
      label: string;
    }> = [];

    const doneKifuIds: number[] = [];
    const impossibleKifuIds: number[] = [];
    const ngKifus: Array<{ id: number; reason: string }> = [];

    let stoppedByTimeLimit = false;
    const unprocessedKifuIds: number[] = [];

    for (let i = 0; i < kifus.length; i++) {
      const kifu = kifus[i];
      const elapsed = Date.now() - batchStartMs;
      if (elapsed >= BATCH_MAX_MS) {
        stoppedByTimeLimit = true;
        for (let j = i; j < kifus.length; j++) {
          unprocessedKifuIds.push(kifus[j]!.id);
        }
        break;
      }

      try {
        const initialSfen = kifu.initial_sfen;
        const moves = splitMoves(kifu.moves);
        const scans = await scanGame({ engine, initialSfen, moves });
        let built = 0;

        for (const scan of scans) {
          if (built >= config.maxProblemsPerGame) break;
          const out = await buildProblemOutFromScan({
            engine,
            scan,
            problemId: 0,
            createdAt,
            prompt,
            blunderThreshold: config.finalize.blunderThresholdCp,
            shuffleSeed: kifu.id * 100 + built,
            evalScale: config.eval.scale,
            rootEvalDepth: config.scan.depth,
            rootEvalPvPlies: 2,
            rejectIfBestTooBadCp: config.finalize.rejectIfBestTooBadCp,
            rejectIfBestTooGoodCp: config.finalize.rejectIfBestTooGoodCp,
          });

          if (!out) continue;

          const tmpIndex = reviewProblemsPayload.length;
          reviewProblemsPayload.push({
            created_at: createdAt,
            prompt: out.prompt,
            root_sfen: out.rootSfen,
            correct_choice_id: out.correctChoiceId,
            intro_moves_usi: out.introMovesUsi,
            root_eval_cp: out.rootEvalCp,
            root_eval_percent: out.rootEvalPercent,
          });

          for (const c of out.choices) {
            reviewChoicesStash.push({
              tmpIndex,
              choice_id: c.choiceId,
              usi: c.usi,
              eval_cp: c.evalCp,
              eval_percent: c.evalPercent,
              explanation: "",
              line: c.line,
              label: createChoiceLabel({ state: out.stateForLabelAtS, usi: c.usi }),
            });
          }

          built += 1;
        }

        if (built > 0) {
          doneKifuIds.push(kifu.id);
        } else {
          impossibleKifuIds.push(kifu.id);
        }
      } catch (e: any) {
        ngKifus.push({ id: kifu.id, reason: String(e?.message ?? e) });
      }
    }

    if (reviewProblemsPayload.length === 0) {
      if (doneKifuIds.length > 0) {
        await supabase.from("kifus").update({ status: "done" }).in("id", doneKifuIds);
      }
      if (impossibleKifuIds.length > 0) {
        await supabase.from("kifus").update({ status: "impossible" }).in("id", impossibleKifuIds);
      }
      for (const ng of ngKifus) {
        await supabase.from("kifus").update({ status: "failed" }).eq("id", ng.id);
      }
      if (stoppedByTimeLimit && unprocessedKifuIds.length > 0) {
        await supabase.from("kifus").update({ status: "pending" }).in("id", unprocessedKifuIds);
      }
      return;
    }

    const { data: inserted, error: insErr } = await supabase
      .from("review_next_move_problems")
      .insert(reviewProblemsPayload)
      .select("id")
      .order("id", { ascending: true });

    if (insErr) throw insErr;

    const insertedIds = (inserted ?? []).map((r: { id: number | string }) => Number(r.id));
    if (insertedIds.length !== reviewProblemsPayload.length) {
      throw new Error("inserted review problems length mismatch");
    }

    const reviewChoicesPayload = reviewChoicesStash.map((c) => ({
      problem_id: insertedIds[c.tmpIndex],
      choice_id: c.choice_id,
      usi: c.usi,
      label: c.label,
      eval_cp: c.eval_cp,
      eval_percent: c.eval_percent,
      explanation: c.explanation,
      line: c.line,
    }));

    const { error: choiceErr } = await supabase.from("review_next_move_choices").insert(reviewChoicesPayload);
    if (choiceErr) throw choiceErr;

    if (doneKifuIds.length > 0) {
      const { error: e1 } = await supabase.from("kifus").update({ status: "done" }).in("id", doneKifuIds);
      if (e1) throw e1;
    }
    if (impossibleKifuIds.length > 0) {
      const { error: eImp } = await supabase.from("kifus").update({ status: "impossible" }).in("id", impossibleKifuIds);
      if (eImp) throw eImp;
    }
    for (const ng of ngKifus) {
      const { error: e2 } = await supabase.from("kifus").update({ status: "failed" }).eq("id", ng.id);
      if (e2) throw e2;
    }
    if (stoppedByTimeLimit && unprocessedKifuIds.length > 0) {
      await supabase.from("kifus").update({ status: "pending" }).in("id", unprocessedKifuIds);
    }
  } finally {
    await engine.quit();
  }
}

main().catch((e) => {
  const reason = String(e?.message ?? e);
  console.error(`致命的エラー: ${reason}`);
  process.exit(1);
});
