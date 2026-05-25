// src/problem/correctRootSfenMeta.ts
function parseSfenTokens(sfen: string): string[] | null {
  const tokens = sfen.trim().split(/\s+/);
  // sfenは通常 4トークン: board turn hand moveNumber
  if (tokens.length < 4) return null;
  return tokens;
}

function getInitialTurn(initialSfen: string): "b" | "w" | null {
  const tokens = parseSfenTokens(initialSfen);
  if (!tokens) return null;
  const t = tokens[1];
  return t === "b" || t === "w" ? t : null;
}

function getInitialMoveNumber(initialSfen: string): number | null {
  const tokens = parseSfenTokens(initialSfen);
  if (!tokens) return null;
  const n = Number(tokens[3]);
  return Number.isFinite(n) ? n : null;
}

function flipTurn(t: "b" | "w"): "b" | "w" {
  return t === "b" ? "w" : "b";
}

function expectedTurn(initialTurn: "b" | "w", appliedPlies: number): "b" | "w" {
  // 1手適用するごとに手番が反転
  return appliedPlies % 2 === 0 ? initialTurn : flipTurn(initialTurn);
}

function expectedMoveNumber(initialMoveNumber: number, appliedPlies: number): number {
  // USIのSFEN move numberは ply単位で増える前提
  return initialMoveNumber + appliedPlies;
}

export function correctRootSfenMeta(args: {
  rootSfen: string;
  initialSfen: string;
  appliedPlies: number; // rootに適用済みの手数
}): string {
  const { rootSfen, initialSfen, appliedPlies } = args;

  const rootTokens = parseSfenTokens(rootSfen);
  if (!rootTokens) return rootSfen;

  const initTurn = getInitialTurn(initialSfen);
  const initMoveNo = getInitialMoveNumber(initialSfen);
  if (!initTurn || initMoveNo == null) return rootSfen;

  const expTurn = expectedTurn(initTurn, appliedPlies);
  const expMoveNo = expectedMoveNumber(initMoveNo, appliedPlies);

  // boardとhandは絶対に触らない
  rootTokens[1] = expTurn;
  rootTokens[3] = String(expMoveNo);

  return rootTokens.slice(0, 4).join(" ");
}