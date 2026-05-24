// scripts/importSfensToDb.ts
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { parsePositionSfenText } from "./_parsePositionSfen";

type KifuInsert = {
  initial_sfen: string;
  moves: string;
  status: "pending";
};

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function listSfenFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) continue;
    if (name.toLowerCase().endsWith(".sfen")) out.push(p);
  }
  return out.sort();
}

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: ts-node scripts/importSfensToDb.ts <folder>");

  const supabaseUrl = mustEnv("SUPABASE_URL");
  const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const files = listSfenFiles(dir);
  if (files.length === 0) {
    console.log("no .sfen files");
    return;
  }

  const payload: KifuInsert[] = [];
  const skipped: Array<{ file: string; reason: string }> = [];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const parsed = parsePositionSfenText(text);

    if (!parsed) {
      skipped.push({ file, reason: "parse failed (not position sfen ... moves ...)" });
      continue;
    }
    if (parsed.moves.length < 2) {
      skipped.push({ file, reason: "moves too short" });
      continue;
    }

    payload.push({
      initial_sfen: parsed.initialSfen,
      moves: parsed.moves.join(" "),
      status: "pending",
    });
  }

  console.log(`files=${files.length} payload=${payload.length} skipped=${skipped.length}`);
  if (skipped.length > 0) {
    console.log("skipped examples:");
    for (const s of skipped.slice(0, 5)) console.log(`- ${s.file} ${s.reason}`);
  }

  if (payload.length === 0) return;

  // チャンクinsert
  const chunkSize = 200;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { error } = await supabase.from("kifus").insert(chunk);
    if (error) throw error;
    console.log(`inserted ${Math.min(i + chunk.length, payload.length)}/${payload.length}`);
  }

  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});