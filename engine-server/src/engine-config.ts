import { envBool, envInt, envUsiOptions } from "./env.js";

// エンジンが探索に使うスレッド数
const threads = envInt("AMTS_ENGINE_THREADS", 4, 1, 128);

// エンジンが置換表に使うメモリ量をメガバイトで指定
const hashMb = envInt("AMTS_ENGINE_HASH_MB", 1024, 64, 262144);

// エンジンが探索に使うコア数
const cores = envInt("AMTS_ENGINE_CORES", threads, 1, 128);

// 解析中の読み筋を出力する間隔をミリ秒で指定
const pvIntervalMs = envInt("AMTS_ENGINE_PV_INTERVAL_MS", 300, 0, 60000);

// 通常解析で同時に取得する候補手数
const multipv = envInt("AMTS_ENGINE_MULTIPV", 3, 1, 500);

// 評価関数が出力する評価値の尺度
const fvScale = envInt("FV_SCALE", 16, 1, 128);

// エンジン応答を待つ最大時間をミリ秒で指定
const waitTimeoutMs = envInt("AMTS_ENGINE_WAIT_TIMEOUT_MS", 180000, 1000, 1800000);

// 解析停止後に最善手を待つ最大時間をミリ秒で指定
const stopTimeoutMs = envInt("AMTS_ENGINE_STOP_TIMEOUT_MS", 5000, 100, 60000);

// 再現性を優先する評価時に使うスレッド数
const stableThreads = 1;

// 評価APIで深さを省略した場合に使う探索深さ
const defaultEvaluateDepth = 20;

// 詰み評価を評価値へ変換する際の絶対値
const mateScoreCp = 30000;

// NUMA環境で探索スレッドを自動配置する設定
const numaPolicy = "auto";

// 相手の手を確率的に先読みする機能を無効化
const stochasticPonder = false;

// エンジン内部の探索深さ上限を無制限に設定
const depthLimit = 0;

// エンジン内部の探索局面数上限を無制限に設定
const nodesLimit = 0;

// 解析用途としてエンジンを動作させる設定
const analyseMode = true;

// 検討モード固有の評価調整を無効化
const considerationMode = false;

// 読み筋の出力失敗時に不完全な読み筋を出さない設定
const outputFailLhPv = false;

// 先手側の千日手評価値
const drawValueBlack = 0;

// 後手側の千日手評価値
const drawValueWhite = 0;

export const engineConfig = {
  threads,
  hashMb,
  cores,
  pvIntervalMs,
  multipv,
  fvScale,
  waitTimeoutMs,
  stopTimeoutMs,
  defaultEvaluateDepth,
  mateScoreCp,

  // 定跡ファイルを探索に使うか
  ownBook: envBool("AMTS_ENGINE_OWN_BOOK", false),

  // 相手の手番中に先読みするか
  ponder: false,

  stableThreads,

  // 全エンジン起動経路で共通して適用するUSI設定
  usiOptions: {
    NumaPolicy: numaPolicy,
    Stochastic_Ponder: stochasticPonder,
    DepthLimit: depthLimit,
    NodesLimit: nodesLimit,
    FV_SCALE: fvScale,
    USI_AnalyseMode: analyseMode,
    ConsiderationMode: considerationMode,
    OutputFailLHPV: outputFailLhPv,
    DrawValueBlack: drawValueBlack,
    DrawValueWhite: drawValueWhite,
  },

  // 環境変数から追加適用するUSI設定
  extraUsiOptions: envUsiOptions("AMTS_ENGINE_USI_OPTIONS"),
} as const;
