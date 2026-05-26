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

export async function loadBasePositions(supabase: SupabaseLike): Promise<BasePosition[]> {
  const { data, error } = await supabase
    .from("making_base_positions")
    .select("id, initial_sfen, tags")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`could not load active making_base_positions: ${error.message ?? String(error)}`);
  }

  const rows = (data ?? []).map((row) => ({
    ...row,
    tags: row.tags ?? [],
  }));
  const out = parseBasePositions(rows, "making_base_positions");
  if (out.length === 0) {
    throw new Error("making_base_positions has no active entries");
  }

  return out;
}
