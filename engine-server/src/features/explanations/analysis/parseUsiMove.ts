import type { ParsedUsiMove } from './types.js';

export function parseUsiMove(usi: string): ParsedUsiMove {
  const raw = typeof usi === 'string' ? usi.trim() : '';
  const isPromotion = raw.endsWith('+');
  const normalized = isPromotion ? raw.slice(0, -1) : raw;
  const dropMatch = normalized.match(/^([PLNSGBR])\*([1-9][a-i])$/);
  if (dropMatch) {
    return {
      raw,
      isDrop: true,
      isPromotion,
      from: null,
      to: dropMatch[2],
      dropPiece: dropMatch[1],
    };
  }

  const moveMatch = normalized.match(/^([1-9][a-i])([1-9][a-i])$/);
  return {
    raw,
    isDrop: false,
    isPromotion,
    from: moveMatch?.[1] ?? null,
    to: moveMatch?.[2] ?? null,
    dropPiece: null,
  };
}
