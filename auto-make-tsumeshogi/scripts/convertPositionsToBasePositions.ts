import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { parseSfen, toSfen, applyUsiMove } from "../src/shogi/sfenEngine";

type BasePositionInput = {
  id: string;
  tags: string[];
  positionCommand: string;
};

const HIRATE_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

function parseRawLine(line: string): BasePositionInput | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const parts = trimmed.split("|", 3);
  if (parts.length < 3) return null;

  const id = parts[0].trim();
  const tagsStr = parts[1].trim();
  const positionCommand = parts[2].trim();

  if (!id || !positionCommand) return null;

  const tags = tagsStr
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  return { id, tags, positionCommand };
}

function applyMovesToSfen(initialSfen: string, moves: string[]): string {
  const pos = parseSfen(initialSfen);

  for (const move of moves) {
    applyUsiMove(pos, move);
  }

  return toSfen(pos);
}

function positionCommandToSfen(positionCommand: string): string {
  const tokens = positionCommand.trim().split(/\s+/);
  if (tokens[0] !== "position") {
    throw new Error(`invalid position command: ${positionCommand}`);
  }

  const movesIdx = tokens.indexOf("moves");

  let initialSfen = "";
  if (tokens[1] === "startpos") {
    initialSfen = HIRATE_SFEN;
  } else if (tokens[1] === "sfen") {
    const sfenTokens = movesIdx >= 0 ? tokens.slice(2, movesIdx) : tokens.slice(2);
    if (sfenTokens.length < 4) {
      throw new Error(`invalid sfen tokens: ${positionCommand}`);
    }
    initialSfen = sfenTokens.slice(0, 4).join(" ");
  } else {
    throw new Error(`unsupported position command: ${positionCommand}`);
  }

  const moves = movesIdx >= 0 ? tokens.slice(movesIdx + 1) : [];
  return applyMovesToSfen(initialSfen, moves);
}

async function main() {
  const rawPath = resolve(__dirname, "../src/data/basePositionsRaw.txt");
  const outPath = resolve(__dirname, "../src/data/basePositions.json");

  const text = readFileSync(rawPath, "utf8");
  const lines = text.split("\n");

  const positions = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsed = parseRawLine(line);
    if (!parsed) continue;

    try {
      const initialSfen = positionCommandToSfen(parsed.positionCommand);

      positions.push({
        id: parsed.id,
        initial_sfen: initialSfen,
        tags: parsed.tags,
      });

      console.log(`[convert] line ${i + 1}: ${parsed.id} OK`);
    } catch (e: any) {
      console.warn(`[convert] line ${i + 1}: ${parsed.id} FAILED: ${String(e?.message ?? e)}`);
    }
  }

  writeFileSync(outPath, JSON.stringify(positions, null, 2), "utf8");
  console.log(`[convert] wrote ${positions.length} positions to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
