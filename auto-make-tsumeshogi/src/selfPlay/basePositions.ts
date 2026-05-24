import basePositionsJson from "../data/basePositions.json";
import type { BasePosition } from "./types";

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isLikelySfen(v: string): boolean {
  const parts = v.trim().split(/\s+/);
  return parts.length >= 4;
}

export function loadBasePositions(): BasePosition[] {
  const raw: unknown = basePositionsJson;
  if (!Array.isArray(raw)) {
    throw new Error("basePositions.json must be an array");
  }

  const out: BasePosition[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown>;
    const id = item?.id;
    const initialSfen = item?.initial_sfen;
    const tags = item?.tags;

    if (typeof id !== "string" || id.trim() === "") {
      throw new Error(`basePositions[${i}] invalid id`);
    }
    if (seenIds.has(id)) {
      throw new Error(`basePositions duplicate id: ${id}`);
    }
    if (typeof initialSfen !== "string" || !isLikelySfen(initialSfen)) {
      throw new Error(`basePositions[${i}] invalid initial_sfen`);
    }
    if (!isStringArray(tags)) {
      throw new Error(`basePositions[${i}] invalid tags`);
    }

    seenIds.add(id);
    out.push({
      id,
      initial_sfen: initialSfen,
      tags,
    });
  }

  if (out.length === 0) {
    throw new Error("basePositions.json has no entries");
  }

  return out;
}
