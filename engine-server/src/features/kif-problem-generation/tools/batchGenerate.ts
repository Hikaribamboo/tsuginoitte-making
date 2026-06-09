import "dotenv/config";
import { existsSync } from "fs";
import path from 'path';
import { createClient } from "@supabase/supabase-js";
import { engineConfig } from "../../../engine-config.js";

import { createUsiEngineClient, getEnginePath } from "../../../services/engine/engineClient";
import { config } from "../config.js";
import { createChoiceLabel } from "../label/createChoiceLabel.js";
import { buildProblemOutFromScan } from "../problem/problemBuilder.js";
import { scanGame } from "../scanGame.js";

type KifuRow = {
  id: number;
  initial_sfen: string;
  moves: string;
  source_ref?: string | null;
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

export async function main() {
  const supabaseUrl = mustEnv("SUPABASE_URL");
  const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const enginePath = process.env.ENGINE_PATH?.trim() || getEnginePath();
  const engineEvalDir = resolveEngineEvalDir(enginePath);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const engine = createUsiEngineClient(enginePath, engineEvalDir);

  console.log(
    `設定: pass1 depth=${config.scan.depth} minDiff=${config.scan.minDiff} pass2 depth=${config.finalize.depth} minDiff=${config.finalize.minDiff}`,
  );

  await engine.init({
    multipv: config.scan.multipv,
    disableBook: !engineConfig.ownBook,
    threads: engineConfig.threads,
    hashMb: engineConfig.hashMb,
    ponder: engineConfig.ponder,
  });

  try {
    const { data, error } = await supabase.rpc("claim_making_kifus", {
      batch_size: config.batch.generateBatchSize,
    });
    if (error) throw error;

    const kifus = (data ?? []) as KifuRow[];
    if (kifus.length === 0) {
      return;
    }

    const createdAt = new Date().toISOString();
    const prompt = "最善手を選んでください";

    for (let i = 0; i < kifus.length; i++) {
      const kifu = kifus[i];
      let finalized = false;

      try {
        const initialSfen = kifu.initial_sfen;
        const moves = splitMoves(kifu.moves);
        const scans = await scanGame({ engine, initialSfen, moves });
        let built = 0;
        const kifuDraftProblemsPayload: Array<{
          created_at: string;
          prompt: string;
          root_sfen: string;
          correct_choice_id: number;
          intro_moves_usi: string[];
          root_eval_cp: number;
          root_eval_percent: number;
          source_type: string;
          source_ref: string;
          source_payload: Record<string, unknown>;
          source_snapshot: Record<string, unknown>;
        }> = [];
        const kifuDraftChoicesStash: Array<{
          tmpIndex: number;
          choice_id: number;
          usi: string;
          eval_cp: number;
          eval_percent: number;
          explanation: string;
          line: string[];
          label: string;
          source_snapshot: Record<string, unknown>;
        }> = [];

        for (const scan of scans) {
          if (built >= config.maxProblemsPerGame) break;
          const out = await buildProblemOutFromScan({
            engine,
            scan,
            problemId: 0,
            createdAt,
            prompt,
            minDiff: config.finalize.minDiff,
            shuffleSeed: kifu.id * 100 + built,
            rootEvalDepth: config.scan.depth,
            rootEvalPvPlies: 2,
            rejectIfBestTooBadCp: config.finalize.rejectIfBestTooBadCp,
            rejectIfBestTooGoodCp: config.finalize.rejectIfBestTooGoodCp,
          });

          if (!out) {
            continue;
          }

          const tmpIndex = kifuDraftProblemsPayload.length;
          const sourceRef = `making_kifu:${kifu.id}:problem:${built + 1}`;
          kifuDraftProblemsPayload.push({
            created_at: createdAt,
            prompt: out.prompt,
            root_sfen: out.rootSfen,
            correct_choice_id: out.correctChoiceId,
            intro_moves_usi: out.introMovesUsi,
            root_eval_cp: out.rootEvalCp,
            root_eval_percent: out.rootEvalPercent,
            source_type: "kif_problem_generation",
            source_ref: sourceRef,
            source_payload: {
              source_kifu_id: kifu.id,
              source_kifu_ref: kifu.source_ref ?? null,
              generated_at: createdAt,
              problem_index_in_kifu: built + 1,
            },
            source_snapshot: {
              source: "batchGenerate",
              source_kifu_id: kifu.id,
              source_ref: sourceRef,
            },
          });

          for (const c of out.choices) {
            kifuDraftChoicesStash.push({
              tmpIndex,
              choice_id: c.choiceId,
              usi: c.usi,
              eval_cp: c.evalCp,
              eval_percent: c.evalPercent,
              explanation: "",
              line: c.line,
              label: createChoiceLabel({ state: out.stateForLabelAtS, usi: c.usi }),
              source_snapshot: {
                source: "batchGenerate",
                source_kifu_id: kifu.id,
                problem_source_ref: sourceRef,
              },
            });
          }

          built += 1;
        }

        if (built === 0) {
          const { error: impossibleErr } = await supabase.from("making_kifus").update({ status: "impossible" }).eq("id", kifu.id);
          if (impossibleErr) throw impossibleErr;
          finalized = true;
          continue;
        }

        const { data: inserted, error: insErr } = await supabase
          .from("making_draft_problems")
          .insert(kifuDraftProblemsPayload.map((problem) => ({
            workspace_id: null,
            mode: "next_move",
            status: "draft",
            prompt: problem.prompt,
            root_sfen: problem.root_sfen,
            intro_moves_usi: problem.intro_moves_usi,
            correct_choice_id: problem.correct_choice_id,
            root_eval_cp: problem.root_eval_cp,
            root_eval_percent: problem.root_eval_percent,
            problem_rating: null,
            problem_rating_games: 0,
            manual_difficulty_tier: null,
            display_no: null,
            tags: [],
            review_comment: null,
            source_type: problem.source_type,
            source_ref: problem.source_ref,
            source_payload: problem.source_payload,
            source_snapshot: problem.source_snapshot,
            created_at: problem.created_at,
            updated_at: problem.created_at,
          })))
          .select("id")
          .order("id", { ascending: true });

        if (insErr) throw insErr;

        const insertedIds = (inserted ?? []).map((r: { id: number | string }) => Number(r.id));
        if (insertedIds.length !== kifuDraftProblemsPayload.length) {
          throw new Error("inserted draft problems length mismatch");
        }

        const draftChoicesPayload = kifuDraftChoicesStash.map((c) => ({
          draft_problem_id: insertedIds[c.tmpIndex],
          choice_id: c.choice_id,
          usi: c.usi,
          label: c.label,
          eval_cp: c.eval_cp,
          eval_percent: c.eval_percent,
          explanation: c.explanation,
          line: c.line,
          source_snapshot: c.source_snapshot,
        }));

        const { error: choiceErr } = await supabase.from("making_draft_choices").insert(draftChoicesPayload);
        if (choiceErr) throw choiceErr;

        const { error: doneErr } = await supabase.from("making_kifus").update({ status: "done" }).eq("id", kifu.id);
        if (doneErr) throw doneErr;
        finalized = true;
      } catch (e: any) {
        if (!finalized) {
          const { error: failedErr } = await supabase.from("making_kifus").update({ status: "failed" }).eq("id", kifu.id);
          if (failedErr) {
            throw failedErr;
          }
        }
        console.error(`[batchGenerate] kifu ${kifu.id} failed: ${String(e?.message ?? e)}`);
      }
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
