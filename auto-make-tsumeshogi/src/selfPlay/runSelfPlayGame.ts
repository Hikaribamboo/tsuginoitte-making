import type { UsiEngine } from "../engine";
import type { SelfPlaySideConfig } from "../configs/selfPlayConfig";
import type { SelfPlayGameResult } from "./types";

type Side = "b" | "w";

function getInitialTurn(initialSfen: string): Side {
  const turn = initialSfen.trim().split(/\s+/)[1];
  if (turn !== "b" && turn !== "w") {
    throw new Error(`invalid initial sfen turn: ${initialSfen}`);
  }
  return turn;
}

function sideAtPly(initialTurn: Side, ply: number): Side {
  return ply % 2 === 0 ? initialTurn : initialTurn === "b" ? "w" : "b";
}

function buildPositionCommand(initialSfen: string, moves: string[]): string {
  if (moves.length === 0) {
    return `position sfen ${initialSfen}`;
  }
  return `position sfen ${initialSfen} moves ${moves.join(" ")}`;
}

function buildGoCommand(sideConfig: SelfPlaySideConfig): string {
  const nodes = Math.floor(sideConfig.nodes);
  const movetimeMs = Math.floor(sideConfig.movetimeMs);

  const parts: string[] = ["go"];
  if (Number.isFinite(nodes) && nodes > 0) {
    parts.push("nodes", String(nodes));
  }
  if (Number.isFinite(movetimeMs) && movetimeMs > 0) {
    parts.push("movetime", String(movetimeMs));
  }

  if (parts.length === 1) {
    parts.push("depth", "8");
  }

  return parts.join(" ");
}

async function searchBestMove(args: {
  engine: UsiEngine;
  positionCommand: string;
  goCommand: string;
}): Promise<string | null> {
  args.engine.write(args.positionCommand);
  args.engine.write(args.goCommand);

  const line = await args.engine.waitFor((l) => l.startsWith("bestmove "), 120000);
  const move = line.trim().split(/\s+/)[1] ?? null;
  if (!move || move === "resign" || move === "win" || move === "none" || move === "(none)") {
    return null;
  }
  return move;
}

export async function runSelfPlayGame(args: {
  initialSfen: string;
  maxMoves: number;
  engineBlack: UsiEngine;
  engineWhite: UsiEngine;
  configBlack: SelfPlaySideConfig;
  configWhite: SelfPlaySideConfig;
  verboseLogging: boolean;
}): Promise<SelfPlayGameResult> {
  const initialTurn = getInitialTurn(args.initialSfen);
  const moves: string[] = [];

  for (let ply = 0; ply < args.maxMoves; ply++) {
    const side = sideAtPly(initialTurn, ply);
    const engine = side === "b" ? args.engineBlack : args.engineWhite;
    const sideConfig = side === "b" ? args.configBlack : args.configWhite;

    const positionCommand = buildPositionCommand(args.initialSfen, moves);
    const goCommand = buildGoCommand(sideConfig);

    if (args.verboseLogging) {
      console.log(`[self-play] ply=${ply + 1} side=${side} go='${goCommand}'`);
    }

    const bestmove = await searchBestMove({
      engine,
      positionCommand,
      goCommand,
    });

    if (!bestmove) {
      return {
        moves,
        terminationReason: "bestmove_none",
      };
    }

    moves.push(bestmove);
  }

  return {
    moves,
    terminationReason: "maxMoves",
  };
}
