import type { PvInfo } from "./engine";

export type ScanResult = {
  t: number;               // 出題局面 index（moves[t] が実戦手）
  rootSfen: string;        // t-2まで適用した局面，move number付き
  introMoveUsi: string;    // moves[t-1]
  actualMoveUsi: string;   // moves[t]
  infos: PvInfo[];         // S局面でのMultiPV解析結果
};