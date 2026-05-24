// scripts/_parsePositionSfen.ts
export function parsePositionSfenText(text: string): { initialSfen: string; moves: string[] } | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 6) return null;

  // position sfen <board> <turn> <hand> <moveNumber> moves <m1> <m2> ...
  if (tokens[0] !== "position" || tokens[1] !== "sfen") return null;

  const movesIdx = tokens.indexOf("moves");
  if (movesIdx < 0) return null;

  const sfenTokens = tokens.slice(2, movesIdx);
  if (sfenTokens.length < 4) return null;

  const initialSfen = sfenTokens.slice(0, 4).join(" ");
  const moves = tokens.slice(movesIdx + 1);

  // USIっぽいものだけ残す（安全）
  const re = /^[1-9][a-i][1-9][a-i]\+?$|^[PLNSGBRK]\*[1-9][a-i]$/;
  const filtered = moves.filter((m) => re.test(m));

  if (filtered.length === 0) return null;

  return { initialSfen, moves: filtered };
}