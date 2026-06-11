import { supabase } from './rpc';

export type KifuStatus = 'pending' | 'processing' | 'done' | 'failed' | 'impossible' | 'unknown';

export interface KifuStatusCount {
  status: KifuStatus;
  count: number;
}

export interface KifuTagCount {
  tag: string;
  count: number;
}

export interface KifuSummary {
  total: number;
  statuses: KifuStatusCount[];
  tags: KifuTagCount[];
  sampledAllRows: boolean;
}

export interface BasePosition {
  id: string;
  initial_sfen: string;
  tags: string[];
  note: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateBasePositionInput {
  id: string;
  initialSfen: string;
  tags?: string[];
  note?: string | null;
  isActive?: boolean;
}

export interface CreateKifuInput {
  initialSfen: string;
  moves: string[];
  tags?: string[];
  basePositionId?: string | null;
  sourceType?: string;
  sourceRef?: string | null;
  sourcePayload?: Record<string, unknown>;
  sourceSnapshot?: Record<string, unknown>;
}

export interface MakingKifuInsertRow {
  source_type: 'shogi_quest';
  source_ref: string;
  initial_sfen: string;
  moves: string;
  status: 'pending';
  kifu_hash: string | null;
  tags: string[];
  base_position_id: null;
  source_payload: Record<string, unknown>;
}

export interface MakingKifuInsertFailure {
  sourceRef: string;
  message: string;
}

export interface MakingKifuInsertResult {
  insertedSourceRefs: string[];
  duplicateSourceRefs: string[];
  failures: MakingKifuInsertFailure[];
}

const KNOWN_STATUSES: KifuStatus[] = ['pending', 'processing', 'done', 'failed', 'impossible'];

function normalizeTagArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export async function getKifuSummary(maxTagScanRows = 20000): Promise<KifuSummary> {
  const statusMap = new Map<KifuStatus, number>();
  for (const status of KNOWN_STATUSES) {
    statusMap.set(status, 0);
  }
  statusMap.set('unknown', 0);

  const tagMap = new Map<string, number>();
  const pageSize = 1000;
  let offset = 0;
  let sampledRows = 0;
  let reachedEnd = false;

  while (sampledRows < maxTagScanRows) {
    const upper = offset + pageSize - 1;
    const { data, error } = await supabase
      .from('making_kifus')
      .select('status, tags')
      .range(offset, upper);
    if (error) throw error;

    const rows = data ?? [];
    for (const row of rows) {
      const rawStatus = (row as { status?: unknown }).status;
      const normalizedStatus: KifuStatus = KNOWN_STATUSES.includes(rawStatus as KifuStatus)
        ? (rawStatus as KifuStatus)
        : 'unknown';
      statusMap.set(normalizedStatus, (statusMap.get(normalizedStatus) ?? 0) + 1);

      const tags = normalizeTagArray((row as { tags?: unknown }).tags);
      for (const tag of tags) {
        tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
      }
    }

    sampledRows += rows.length;
    if (rows.length < pageSize) {
      reachedEnd = true;
      break;
    }
    offset += pageSize;
  }

  const statuses: KifuStatusCount[] = Array.from(statusMap.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));

  const tags: KifuTagCount[] = Array.from(tagMap.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  return {
    total: sampledRows,
    statuses,
    tags,
    sampledAllRows: reachedEnd,
  };
}

export async function createKifus(inputs: CreateKifuInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  const payload = inputs.map((input) => ({
    source_type: input.sourceType ?? 'imported',
    source_ref: input.sourceRef ?? null,
    initial_sfen: input.initialSfen,
    moves: input.moves.join(' '),
    status: 'pending',
    tags: input.tags ?? [],
    base_position_id: input.basePositionId ?? null,
    source_payload: {
      created_from: 'making_kifus_generator',
      moves_count: input.moves.length,
      ...(input.sourcePayload ?? {}),
    },
    source_snapshot: input.sourceSnapshot ?? {},
  }));

  const chunkSize = 500;
  let inserted = 0;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { error } = await supabase.from('making_kifus').insert(chunk);
    if (error) throw error;
    inserted += chunk.length;
  }
  return inserted;
}

export async function listExistingMakingKifuSourceRefs(
  sourceType: string,
  sourceRefs: string[],
): Promise<Set<string>> {
  const uniqueRefs = Array.from(new Set(sourceRefs.map((ref) => ref.trim()).filter(Boolean)));
  const existing = new Set<string>();

  for (let index = 0; index < uniqueRefs.length; index += 100) {
    const chunk = uniqueRefs.slice(index, index + 100);
    const { data, error } = await supabase
      .from('making_kifus')
      .select('source_ref')
      .eq('source_type', sourceType)
      .in('source_ref', chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      if (typeof row.source_ref === 'string') existing.add(row.source_ref);
    }
  }

  return existing;
}

export async function insertMakingKifuRows(rows: MakingKifuInsertRow[]): Promise<MakingKifuInsertResult> {
  const insertedSourceRefs: string[] = [];
  const duplicateSourceRefs: string[] = [];
  const failures: MakingKifuInsertFailure[] = [];
  const existing = await listExistingMakingKifuSourceRefs('shogi_quest', rows.map((row) => row.source_ref));

  for (const row of rows) {
    if (existing.has(row.source_ref)) {
      duplicateSourceRefs.push(row.source_ref);
      continue;
    }

    const { error } = await supabase.from('making_kifus').insert(row);
    if (!error) {
      insertedSourceRefs.push(row.source_ref);
      continue;
    }

    const isDuplicate = error.code === '23505' || /duplicate|unique/i.test(error.message);
    if (isDuplicate) {
      duplicateSourceRefs.push(row.source_ref);
    } else {
      failures.push({ sourceRef: row.source_ref, message: error.message });
    }
  }

  return { insertedSourceRefs, duplicateSourceRefs, failures };
}

export async function listBasePositions(): Promise<BasePosition[]> {
  const { data, error } = await supabase
    .from('making_base_positions')
    .select('id, initial_sfen, tags, note, is_active, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as BasePosition[];
}

export async function createBasePosition(input: CreateBasePositionInput): Promise<BasePosition> {
  const payload = {
    id: input.id.trim(),
    initial_sfen: input.initialSfen.trim(),
    tags: input.tags ?? [],
    note: input.note?.trim() || null,
    is_active: input.isActive ?? true,
  };

  const { data, error } = await supabase
    .from('making_base_positions')
    .insert(payload)
    .select('id, initial_sfen, tags, note, is_active, created_at, updated_at')
    .single();

  if (error) throw error;
  return data as BasePosition;
}
