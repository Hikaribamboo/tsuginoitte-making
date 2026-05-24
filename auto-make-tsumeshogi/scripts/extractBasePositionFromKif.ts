import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

type CliArgs = {
  inputPath: string;
  outputRawPath: string;
  plies: number;
  id: string;
};

const DEST_FILE_MAP: Record<string, string> = {
  "１": "1",
  "２": "2",
  "３": "3",
  "４": "4",
  "５": "5",
  "６": "6",
  "７": "7",
  "８": "8",
  "９": "9",
};

const DEST_RANK_MAP: Record<string, number> = {
  "一": 1,
  "二": 2,
  "三": 3,
  "四": 4,
  "五": 5,
  "六": 6,
  "七": 7,
  "八": 8,
  "九": 9,
};

const DROP_PIECE_MAP: Record<string, string> = {
  "歩": "P",
  "香": "L",
  "桂": "N",
  "銀": "S",
  "金": "G",
  "角": "B",
  "飛": "R",
};

function toRankLetter(rank: number): string {
  if (rank < 1 || rank > 9) {
    throw new Error(`invalid rank: ${rank}`);
  }
  return String.fromCharCode("a".charCodeAt(0) + rank - 1);
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const idx = argv.indexOf(name);
    if (idx < 0) return undefined;
    return argv[idx + 1];
  };

  const inputPath = resolve(get("--input") ?? "src/data/sample_kif.kif");
  const outputRawPath = resolve(get("--output") ?? "src/data/basePositionsRaw.txt");
  const pliesRaw = get("--plies") ?? "15";
  const id = get("--id") ?? `sample_kif_p${pliesRaw}`;

  const plies = Number(pliesRaw);
  if (!Number.isInteger(plies) || plies <= 0) {
    throw new Error(`--plies must be a positive integer: ${pliesRaw}`);
  }

  return { inputPath, outputRawPath, plies, id };
}

function parseStrategyTags(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const tags: string[] = [];

  for (const prefix of ["先手の戦法：", "後手の戦法："]) {
    const line = lines.find((x) => x.startsWith(prefix));
    if (!line) continue;

    const body = line.slice(prefix.length).trim();
    const parts = body
      .split(/[，,]/)
      .map((x) => x.trim())
      .filter(Boolean);

    for (const p of parts) {
      if (!tags.includes(p)) tags.push(p);
    }
  }

  return tags;
}

function parseMoveTexts(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const m = line.match(/^\s*\d+\s+(.+?)\s+\(/);
    if (!m) continue;

    const moveText = m[1].trim();
    if (moveText === "投了") break;

    out.push(moveText);
  }

  return out;
}

function normalizeMoveText(moveText: string): string {
  return moveText.replace(/\s+/g, "");
}

function parseDestination(raw: string, prevTo: string | null): { to: string; rest: string } {
  if (raw.startsWith("同")) {
    if (!prevTo) {
      throw new Error(`"同" cannot be parsed without previous move: ${raw}`);
    }

    const rest = raw.slice(1);
    return { to: prevTo, rest };
  }

  const fileCh = raw[0];
  const rankCh = raw[1];
  const file = DEST_FILE_MAP[fileCh];
  const rankNum = DEST_RANK_MAP[rankCh];

  if (!file || !rankNum) {
    throw new Error(`invalid destination: ${raw}`);
  }

  const to = `${file}${toRankLetter(rankNum)}`;
  return { to, rest: raw.slice(2) };
}

function toUsiFromKifMove(moveText: string, prevTo: string | null): { usi: string; to: string } {
  const raw = normalizeMoveText(moveText);
  const { to, rest } = parseDestination(raw, prevTo);

  if (rest.includes("打")) {
    const pieceKanji = rest[0];
    const piece = DROP_PIECE_MAP[pieceKanji];
    if (!piece) {
      throw new Error(`invalid drop piece: ${moveText}`);
    }
    return { usi: `${piece}*${to}`, to };
  }

  const src = raw.match(/\((\d)(\d)\)$/);
  if (!src) {
    throw new Error(`source square not found: ${moveText}`);
  }

  const fromFile = src[1];
  const fromRank = Number(src[2]);
  const from = `${fromFile}${toRankLetter(fromRank)}`;

  const promote = /成\(\d\d\)$/.test(raw);
  return { usi: `${from}${to}${promote ? "+" : ""}`, to };
}

function movesToUsi(moveTexts: string[]): string[] {
  const usiMoves: string[] = [];
  let prevTo: string | null = null;

  for (const mt of moveTexts) {
    const { usi, to } = toUsiFromKifMove(mt, prevTo);
    usiMoves.push(usi);
    prevTo = to;
  }

  return usiMoves;
}

function upsertRawLine(rawPath: string, id: string, lineBody: string): void {
  let lines: string[] = [];

  try {
    lines = readFileSync(rawPath, "utf8").split(/\r?\n/);
  } catch {
    lines = [];
  }

  const next = `${id}|${lineBody}`;
  let replaced = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;

    const curId = line.split("|", 1)[0]?.trim();
    if (curId === id) {
      lines[i] = next;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
      lines.push(next);
    } else {
      lines[lines.length - 1] = next;
    }
  }

  const out = lines.join("\n").replace(/\n*$/, "\n");
  writeFileSync(rawPath, out, "utf8");
}

async function main() {
  // Usage:
  // npx ts-node scripts/extractBasePositionFromKif.ts --input src/data/sample_kif.kif --plies 15 --id sample_kif_001_p15
  const args = parseArgs();

  const text = readFileSync(args.inputPath, "utf8");
  const tags = parseStrategyTags(text);
  const moveTexts = parseMoveTexts(text);
  const usiMoves = movesToUsi(moveTexts).slice(0, args.plies);

  if (usiMoves.length === 0) {
    throw new Error("no moves parsed from KIF");
  }

  const tagsText = tags.join(",");
  const cmd = usiMoves.length > 0 ? `position startpos moves ${usiMoves.join(" ")}` : "position startpos";

  upsertRawLine(args.outputRawPath, args.id, `${tagsText}|${cmd}`);

  console.log(`[kif->raw] id=${args.id}`);
  console.log(`[kif->raw] tags=${tagsText}`);
  console.log(`[kif->raw] plies=${usiMoves.length}`);
  console.log(`[kif->raw] wrote ${args.outputRawPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
