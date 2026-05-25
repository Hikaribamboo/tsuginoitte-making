// src/debug/coarsePerf.ts
type Stat = { count: number; totalMs: number; maxMs: number };

const stats = new Map<string, Stat>();

function nowMs(): number {
  return Number(process.hrtime.bigint() / 1000000n);
}

// engine側などで使う「開始→経過ms」を返すタイマー
export function startTimer() {
  const start = nowMs();
  return () => nowMs() - start;
}

// 集計用
export function perfMark(label: string, ms: number) {
  const s = stats.get(label) ?? { count: 0, totalMs: 0, maxMs: 0 };
  s.count += 1;
  s.totalMs += ms;
  s.maxMs = Math.max(s.maxMs, ms);
  stats.set(label, s);
}

export function startCoarse(label: string) {
  const end = startTimer();
  return () => {
    const ms = end();
    perfMark(label, ms);
    console.log(`${label}: ${ms}ms`);
  };
}
