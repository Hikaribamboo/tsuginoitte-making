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

export interface CreateKifuInput {
  initialSfen: string;
  moves: string[];
  tags?: string[];
  basePositionId?: string | null;
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
      .from('kifus')
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
    initial_sfen: input.initialSfen,
    moves: input.moves.join(' '),
    status: 'pending',
    tags: input.tags ?? [],
    base_position_id: input.basePositionId ?? null,
  }));

  const chunkSize = 500;
  let inserted = 0;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { error } = await supabase.from('kifus').insert(chunk);
    if (error) throw error;
    inserted += chunk.length;
  }
  return inserted;
}
