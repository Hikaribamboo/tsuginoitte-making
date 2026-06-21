import { parseUsiMove } from './parseUsiMove.js';
import type { LineFacts } from './types.js';

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function extractLineFacts(line: string[]): LineFacts {
  const moves = Array.isArray(line) ? line.filter((move) => typeof move === 'string' && move.trim()).map((move) => move.trim()) : [];
  const parsedMoves = moves.map(parseUsiMove);
  const dropPieces = unique(parsedMoves.map((move) => move.dropPiece).filter((piece): piece is string => Boolean(piece)));
  const promotedMoves = parsedMoves.filter((move) => move.isPromotion).map((move) => move.raw);
  const destinationSquares = unique(parsedMoves.map((move) => move.to).filter((square): square is string => Boolean(square)));

  return {
    firstResponse: moves[0] ?? null,
    firstSixMoves: moves.slice(0, 6),
    moveCount: moves.length,

    hasDrop: parsedMoves.some((move) => move.isDrop),
    hasPromotion: parsedMoves.some((move) => move.isPromotion),

    dropPieces,
    promotedMoves,

    hasPawnDrop: dropPieces.includes('P'),
    hasSilverDrop: dropPieces.includes('S'),
    hasGoldDrop: dropPieces.includes('G'),
    hasBishopDrop: dropPieces.includes('B'),
    hasRookDrop: dropPieces.includes('R'),
    hasKnightDrop: dropPieces.includes('N'),
    hasLanceDrop: dropPieces.includes('L'),

    destinationSquares,
  };
}
