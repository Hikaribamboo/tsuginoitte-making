import { getEnginePath } from "../../../services/engine/engineClient";

export type SelfPlaySideConfig = {
  enginePath: string;
  threads: number;
  hashMb: number;
  disableBook: boolean;
  ponder: boolean;
  nodes: number;
  movetimeMs: number;
  // NOTE: randomness is reserved for future move-selection perturbation and is currently unused.
  randomness: number;
};

export type SelfPlayConfigProfile = {
  runName: string;
  gamesPerBasePosition: number;
  maxMoves: number;
  insertToSupabase: boolean;
  verboseLogging: boolean;
  engineBlack: SelfPlaySideConfig;
  engineWhite: SelfPlaySideConfig;
};

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(raw.toLowerCase())) return false;
  return fallback;
}

const defaultPath = process.env.ENGINE_PATH?.trim() || getEnginePath();

export const selfPlayProfiles: Record<string, SelfPlayConfigProfile> = {
  baseline: {
    runName: "baseline-self-play",
    gamesPerBasePosition: 3,
    maxMoves: 180,
    insertToSupabase: true,
    verboseLogging: true,
    engineBlack: {
      enginePath: defaultPath,
      threads: 2,
      hashMb: 512,
      disableBook: true,
      ponder: false,
      nodes: 1200,
      movetimeMs: 120,
      randomness: 0,
    },
    engineWhite: {
      enginePath: defaultPath,
      threads: 2,
      hashMb: 512,
      disableBook: true,
      ponder: false,
      nodes: 1200,
      movetimeMs: 120,
      randomness: 0,
    },
  },
};

export const activeSelfPlayProfile = "baseline";

const baseSelfPlayConfig = selfPlayProfiles[activeSelfPlayProfile];

if (!baseSelfPlayConfig) {
  throw new Error(`self-play profile not found: ${activeSelfPlayProfile}`);
}

export const selfPlayConfig: SelfPlayConfigProfile = {
  ...baseSelfPlayConfig,
  runName: process.env.AMTS_SP_RUN_NAME?.trim() || baseSelfPlayConfig.runName,
  gamesPerBasePosition: envInt(
    "AMTS_SP_GAMES_PER_BASE_POSITION",
    baseSelfPlayConfig.gamesPerBasePosition,
    1,
    10000,
  ),
  maxMoves: envInt("AMTS_SP_MAX_MOVES", baseSelfPlayConfig.maxMoves, 1, 2000),
  verboseLogging: envBool("AMTS_SP_VERBOSE_LOGGING", baseSelfPlayConfig.verboseLogging),
  engineBlack: {
    ...baseSelfPlayConfig.engineBlack,
    nodes: envInt("AMTS_SP_BLACK_NODES", baseSelfPlayConfig.engineBlack.nodes, 1, 1000000000),
    movetimeMs: envInt(
      "AMTS_SP_BLACK_MOVETIME_MS",
      baseSelfPlayConfig.engineBlack.movetimeMs,
      1,
      3600000,
    ),
  },
  engineWhite: {
    ...baseSelfPlayConfig.engineWhite,
    nodes: envInt("AMTS_SP_WHITE_NODES", baseSelfPlayConfig.engineWhite.nodes, 1, 1000000000),
    movetimeMs: envInt(
      "AMTS_SP_WHITE_MOVETIME_MS",
      baseSelfPlayConfig.engineWhite.movetimeMs,
      1,
      3600000,
    ),
  },
};
