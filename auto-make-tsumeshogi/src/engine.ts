// src/engine.ts
import { spawn } from "child_process";
import * as path from "path";

import { perfMark, startTimer } from "./debug/coarsePerf";

export type PvInfo = {
  multipv: number;
  evalType: "cp" | "mate";
  eval: number;
  pv: string[];
};

type AnalyzeResult = {
  infos: PvInfo[];
  bestmove: string | null;
};

function parseInfoLine(line: string): PvInfo | null {
  if (!line.startsWith("info ")) return null;
  if (!line.includes(" pv ")) return null;
  if (!line.includes(" score ")) return null;

  const tokens = line.trim().split(/\s+/);

  const mpIdx = tokens.indexOf("multipv");
  const scoreIdx = tokens.indexOf("score");
  const pvIdx = tokens.indexOf("pv");
  if (scoreIdx < 0 || pvIdx < 0) return null;

  const multipv = mpIdx >= 0 ? Number(tokens[mpIdx + 1]) : 1;
  if (!Number.isFinite(multipv) || multipv <= 0) return null;

  const scoreType = tokens[scoreIdx + 1];
  const scoreVal = Number(tokens[scoreIdx + 2]);
  if (!Number.isFinite(scoreVal)) return null;

  if (scoreType !== "cp" && scoreType !== "mate") return null;

  const pv = tokens.slice(pvIdx + 1);
  if (pv.length === 0) return null;

  return { multipv, evalType: scoreType, eval: scoreVal, pv };
}

export class UsiEngine {
  private proc;
  private buffer = "";
  private onLine?: (line: string) => void;

  private currentMultiPv: number | null = null;

  constructor(args: { engineExePath: string }) {
    this.proc = spawn(args.engineExePath);

    this.proc.stdout.on("data", (data) => {
      const text = data.toString();
      this.buffer += text;

      const parts = this.buffer.split(/\r?\n/);
      this.buffer = parts.pop() ?? "";

      for (const raw of parts) {
        const line = raw.trim();
        if (!line) continue;
        this.onLine?.(line);
      }
    });

    this.proc.stderr.on("data", (data) => {
      console.error("[ENGINE-ERR]", data.toString());
    });

    this.proc.on("exit", (code) => {
      console.log("[ENGINE-EXIT]", code);
    });
  }

  write(line: string) {
    this.proc.stdin.write(line.endsWith("\n") ? line : line + "\n");
  }

  async waitFor(predicate: (line: string) => boolean, timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.onLine = undefined;
        reject(new Error("waitFor timeout"));
      }, timeoutMs);

      this.onLine = (line) => {
        if (predicate(line)) {
          clearTimeout(timer);
          this.onLine = undefined;
          resolve(line);
        }
      };
    });
  }

  async init(args: {
    multipv: number;
    disableBook: boolean;
    threads?: number;
    hashMb?: number;
    ponder?: boolean;
  }) {
    this.write("usi");
    await this.waitFor((l) => l === "usiok", 30000);

    if (args.threads != null) this.write(`setoption name Threads value ${args.threads}`);
    if (args.hashMb != null) this.write(`setoption name Hash value ${args.hashMb}`);
    if (args.ponder != null) this.write(`setoption name USI_Ponder value ${args.ponder ? "true" : "false"}`);

    this.write(`setoption name USI_AnalyseMode value true`);

    if (args.disableBook) this.write("setoption name USI_OwnBook value false");

    this.write(`setoption name MultiPV value ${args.multipv}`);
    this.currentMultiPv = args.multipv;

    this.write("isready");
    await this.waitFor((l) => l === "readyok", 30000);

    this.write("ucinewgame");
    this.write("isready");
    await this.waitFor((l) => l === "readyok", 30000);
  }

  async setMultiPv(multipv: number) {
    if (this.currentMultiPv === multipv) return;

    this.write(`setoption name MultiPV value ${multipv}`);
    this.currentMultiPv = multipv;

    this.write("isready");
    await this.waitFor((l) => l === "readyok");
  }

  async analyze(args: {
    positionCommand: string;
    depth: number;
    pvPlies: number;
    searchMoves?: string[];
    label?: string;
  }): Promise<AnalyzeResult> {
    const latest: Map<number, PvInfo> = new Map();
    let bestmove: string | null = null;

    const end = startTimer();

    this.write(args.positionCommand);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.onLine = undefined;
        const ms = end();
        const tag = args.label ? `|${args.label}` : "";
        perfMark(`engine.analyze.timeout${tag}`, ms);
        reject(new Error("analyze timeout"));
      }, 180000);

      this.onLine = (line) => {
        if (line.startsWith("info ")) {
          const info = parseInfoLine(line);
          if (info) latest.set(info.multipv, { ...info, pv: info.pv.slice(0, args.pvPlies) });
          return;
        }

        if (line.startsWith("bestmove ")) {
          bestmove = line.split(/\s+/)[1] ?? null;

          clearTimeout(timeout);
          this.onLine = undefined;

          const infos = Array.from(latest.values()).sort((a, b) => a.multipv - b.multipv);

          const ms = end();
          const tag = args.label ? `|${args.label}` : "";
          perfMark(`engine.analyze${tag}`, ms);

          resolve({ infos, bestmove });
        }
      };

      if (args.searchMoves && args.searchMoves.length > 0) {
        this.write(`go depth ${args.depth} searchmoves ${args.searchMoves.join(" ")}`);
      } else {
        this.write(`go depth ${args.depth}`);
      }
    });
  }

  async quit() {
    this.write("quit");
  }
}

export function defaultEnginePath() {
  return path.resolve(__dirname, "../engines/YaneuraOu.exe");
}