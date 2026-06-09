import { envBool, envInt } from "../../env.js";

// 最終解析で使う探索深さ
const FINALIZE_DEPTH = envInt("AMTS_FINALIZE_DEPTH", 26, 26, 80);

export const config = {
  scan: {
    // 作問候補を探す最初の解析で使う探索深さ
    depth: envInt("AMTS_SCAN_DEPTH", 12, 1, 50),

    // 最初の解析で取得する候補手数
    multipv: 1,

    // 最初の解析結果をすべてログ出力するか
    debugAllPass1: envBool("AMTS_DEBUG_PASS1_ALL", false),
  },

  finalize: {
    // 作問候補を確定する解析で使う探索深さ
    depth: FINALIZE_DEPTH,

    // 保存する読み筋の最大手数
    pvPlies: 9,

    // 実戦手を悪手候補と判定する評価値差
    blunderThresholdCp: 200,

    // 同じ棋譜から作る問題同士に必要な最小手数差
    minCandidateGapPlies: 10,

    // ユーザー側が不利すぎる問題を除外する評価値
    rejectIfBestTooBadCp: 400,

    // ユーザー側が有利すぎる問題を除外する評価値
    rejectIfBestTooGoodCp: 2400,
  },

  // 不自然な評価値変化として扱う最小差
  suspiciousMinDiff: envInt("AMTS_SUSPICIOUS_MIN_DIFF", 140, 1, 10000),

  // 不自然な評価値変化として扱う最大差
  suspiciousMaxDiff: envInt("AMTS_SUSPICIOUS_MAX_DIFF", 1200, 1, 10000),

  // 一局から検査する作問候補の最大数
  maxCandidates: envInt("AMTS_MAX_CANDIDATES", 20, 1, 300),

  // 一局から作成する問題の最大数
  maxProblemsPerGame: envInt("AMTS_MAX_PROBLEMS_PER_GAME", 3, 1, 50),

  // 一局の最初の解析から保持する候補の最大数
  maxScanResultsPerGame: envInt("AMTS_MAX_SCAN_RESULTS_PER_GAME", 12, 1, 200),

  batch: {
    // 一回の処理で取得する棋譜数
    generateBatchSize: envInt("AMTS_BATCH_SIZE", 1, 1, 5000),
  },
} as const;
