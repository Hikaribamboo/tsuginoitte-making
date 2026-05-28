import type { KifuInsertRow } from "./types";

function isLikelySfen(v: string): boolean {
  const parts = v.trim().split(/\s+/);
  return parts.length >= 4;
}

const USI_MOVE_RE = /^[1-9][a-i][1-9][a-i]\+?$|^[PLNSGBRK]\*[1-9][a-i]$/;

function areValidMovesText(v: string): boolean {
  const tokens = v.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((x) => USI_MOVE_RE.test(x));
}

export function buildKifuInsertRow(args: {
  initialSfen: string;
  movesText: string;
  tags: string[];
  basePositionId: string;
}): KifuInsertRow {
  return {
    source_type: "self_play",
    source_ref: null,
    initial_sfen: args.initialSfen,
    moves: args.movesText,
    status: "pending",
    tags: args.tags,
    base_position_id: args.basePositionId,
    source_payload: {
      generated_by: "self_play",
    },
  };
}

export function validateKifuInsertRow(row: KifuInsertRow): void {
  if (!isLikelySfen(row.initial_sfen)) {
    throw new Error("invalid initial_sfen");
  }
  if (!areValidMovesText(row.moves)) {
    throw new Error("invalid moves");
  }
  if (row.status !== "pending") {
    throw new Error("invalid status");
  }
  if (row.base_position_id != null && row.base_position_id.trim() === "") {
    throw new Error("invalid base_position_id");
  }
  if (row.tags != null && !Array.isArray(row.tags)) {
    throw new Error("invalid tags");
  }
}

export async function insertKifuRows(args: {
  supabase: {
    from: (table: string) => {
      insert: (rows: KifuInsertRow[]) => any;
    };
  };
  rows: KifuInsertRow[];
  chunkSize?: number;
  verboseLogging?: boolean;
}): Promise<void> {
  if (args.rows.length === 0) return;

  const chunkSize = args.chunkSize ?? 200;
  for (let i = 0; i < args.rows.length; i += chunkSize) {
    const chunk = args.rows.slice(i, i + chunkSize);
    const { error } = await args.supabase.from("making_kifus").insert(chunk);
    if (error) {
      throw error;
    }
    if (args.verboseLogging) {
      console.log(`[self-play] inserted ${Math.min(i + chunk.length, args.rows.length)}/${args.rows.length}`);
    }
  }
}
