import basePositionsJson from "../data/basePositions.json";
import type { BasePosition } from "./types";

type BasePositionRow = {
  id: string;
  initial_sfen: string;
  tags: string[] | null;
};

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        order: (column: string, opts?: { ascending?: boolean }) => Promise<{
          data: BasePositionRow[] | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isLikelySfen(v: string): boolean {
  const parts = v.trim().split(/\s+/);
  return parts.length >= 4;
}

function parseBasePositions(raw: unknown, sourceLabel: string): BasePosition[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${sourceLabel} must be an array`);
  }

  const out: BasePosition[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown>;
    const id = item?.id;
    const initialSfen = item?.initial_sfen;
    const tags = item?.tags;

    if (typeof id !== "string" || id.trim() === "") {
      throw new Error(`${sourceLabel}[${i}] invalid id`);
    }
    if (seenIds.has(id)) {
      throw new Error(`${sourceLabel} duplicate id: ${id}`);
    }
    if (typeof initialSfen !== "string" || !isLikelySfen(initialSfen)) {
      throw new Error(`${sourceLabel}[${i}] invalid initial_sfen`);
    }
    if (!isStringArray(tags)) {
      throw new Error(`${sourceLabel}[${i}] invalid tags`);
    }

    seenIds.add(id);
    out.push({
      id,
      initial_sfen: initialSfen,
      tags,
    });
  }

  return out;
}

async function loadDbBasePositions(supabase: SupabaseLike): Promise<BasePosition[]> {
  const { data, error } = await supabase
    .from("making_base_positions")
    .select("id, initial_sfen, tags")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn(`[self-play] could not load making_base_positions: ${error.message ?? String(error)}`);
    return [];
  }

  const rows = (data ?? []).map((row) => ({
    ...row,
    tags: row.tags ?? [],
  }));
  return parseBasePositions(rows, "making_base_positions");
}

export async function loadBasePositions(supabase?: SupabaseLike): Promise<BasePosition[]> {
  const bundled = parseBasePositions(basePositionsJson, "basePositions.json");
  const fromDb = supabase ? await loadDbBasePositions(supabase) : [];
  const merged = new Map<string, BasePosition>();

  for (const base of bundled) merged.set(base.id, base);
  for (const base of fromDb) merged.set(base.id, base);

  const out = Array.from(merged.values());
  if (out.length === 0) {
    throw new Error("basePositions has no entries");
  }

  return out;
}
