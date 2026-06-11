import { envBool, envInt } from "../../env.js";

// 最終解析で使う探索深さ
const FINALIZE_DEPTH = envInt("AMTS_FINALIZE_DEPTH", 26, 26, 80);

export const config = {
  scan: {
    // 作問候補を探す最初の解析で使う探索深さ
    depth: 16,

    // 最初の解析で取得する候補手数
    multipv: 1,

    // 最初の解析で作問候補として抽出する評価値差
    minDiff: 200,

    // 最初の解析結果をすべてログ出力するか
    debugAllPass1: envBool("AMTS_DEBUG_PASS1_ALL", false),
  },

  finalize: {
    // 作問候補を確定する解析で使う探索深さ
    depth: FINALIZE_DEPTH,

    // 保存する読み筋の最大手数
    pvPlies: 9,

    // 最終解析で実戦手と不正解手に必要な評価値差
    minDiff: envInt("AMTS_FINALIZE_MIN_DIFF", 200, 1, 10000),

    // 同じ棋譜から作る問題同士に必要な最小手数差
    minCandidateGapPlies: 10,

    // ユーザー側が不利すぎる問題を除外する評価値
    rejectIfBestTooBadCp: 400,

    // ユーザー側が有利すぎる問題を除外する評価値
    rejectIfBestTooGoodCp: 2400,
  },

  // 一局から作成する問題の最大数
  maxProblemsPerGame: envInt("AMTS_MAX_PROBLEMS_PER_GAME", 3, 1, 50),

  batch: {
    // 一回の処理で取得する棋譜数
    generateBatchSize: envInt("AMTS_BATCH_SIZE", 1, 1, 5000),
  },
} as const;
