function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const FINALIZE_DEPTH = envInt("AMTS_FINALIZE_DEPTH", 18, 1, 80);

// src/config.ts
export const config = {
  engine: {
    threads: envInt("AMTS_ENGINE_THREADS", 4, 1, 128),
    hashMb: envInt("AMTS_ENGINE_HASH_MB", 1024, 64, 262144),
    disableBook: true,
    ponder: false,
  },

  scan: {
    depth: envInt("AMTS_SCAN_DEPTH", 12, 1, 50),
    multipv: 1,
  },

  finalize: {
    depth: FINALIZE_DEPTH,
    multipv: 3,
    pvPlies: 9,

    blunderThresholdCp: 400,

    choiceDepthSteps: [FINALIZE_DEPTH, FINALIZE_DEPTH + 4],

    dynamicMpBaseSteps: [3, 10],
    dynamicMpTail: 30,
    dynamicMpInsert20WorstLossThreshold: 400,

    minCandidateGapPlies: 12,

    rejectIfBestTooBadCp: 400,
    rejectIfBestTooGoodCp: 2400,
  },

  eval: {
    scale: 1000,
  },

  suspiciousMinDiff: envInt("AMTS_SUSPICIOUS_MIN_DIFF", 500, 1, 10000),
  suspiciousMaxDiff: envInt("AMTS_SUSPICIOUS_MAX_DIFF", 1600, 1, 10000),

  maxCandidates: envInt("AMTS_MAX_CANDIDATES", 20, 1, 300),
  maxProblemsPerGame: envInt("AMTS_MAX_PROBLEMS_PER_GAME", 3, 1, 50),
  maxScanResultsPerGame: envInt("AMTS_MAX_SCAN_RESULTS_PER_GAME", 12, 1, 200),

  batch: {
    generateBatchSize: envInt("AMTS_BATCH_SIZE", 1, 1, 5000),
  },
} as const;
