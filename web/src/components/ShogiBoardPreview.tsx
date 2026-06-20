import { parseSfen } from '../lib/sfen';
import {
  HAND_PIECE_TYPES,
  pieceKanji,
  type HandPieces,
  type HandPieceType,
  type Side,
} from '../types/shogi';

const FILE_LABELS = ['９', '８', '７', '６', '５', '４', '３', '２', '１'];
const RANK_LABELS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HAND_KANJI: Record<HandPieceType, string> = {
  R: '飛',
  B: '角',
  G: '金',
  S: '銀',
  N: '桂',
  L: '香',
  P: '歩',
};

interface ShogiBoardPreviewProps {
  sfen: string;
  flipped?: boolean;
  cellSize?: number;
  maxWidth?: number;
  showCoordinates?: boolean;
  showHands?: boolean;
  showTurn?: boolean;
  className?: string;
  errorText?: string;
  errorMinHeight?: number;
}

export default function ShogiBoardPreview({
  sfen,
  flipped = false,
  cellSize,
  maxWidth,
  showCoordinates = false,
  showHands = false,
  showTurn = false,
  className = '',
  errorText = '盤面を表示できません（root_sfen形式エラー）',
  errorMinHeight,
}: ShogiBoardPreviewProps) {
  try {
    const state = parseSfen(sfen);
    const topSide: Side = flipped ? 'sente' : 'gote';
    const bottomSide: Side = flipped ? 'gote' : 'sente';
    const topHand = topSide === 'sente' ? state.senteHand : state.goteHand;
    const bottomHand = bottomSide === 'sente' ? state.senteHand : state.goteHand;
    const rowIndexes = flipped ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const colIndexes = flipped ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const fileLabels = flipped ? [...FILE_LABELS].reverse() : FILE_LABELS;
    const rankLabels = flipped ? [...RANK_LABELS].reverse() : RANK_LABELS;
    const cellTrack = cellSize == null ? 'minmax(0, 1fr)' : `${cellSize}px`;
    const labelStyle = cellSize == null ? undefined : { gridTemplateColumns: `repeat(9, ${cellTrack})` };
    const boardStyle = {
      gridTemplateColumns: `repeat(9, ${cellTrack})`,
      gridTemplateRows: `repeat(9, ${cellTrack})`,
    };

    return (
      <div
        className={`mx-auto flex w-full flex-col gap-2 ${className}`}
        style={{ maxWidth }}
      >
        {showHands ? <HandStrip side={topSide} hand={topHand} placement="top" /> : null}

        <div className="flex justify-center">
          <div className={showCoordinates ? 'grid grid-cols-[1fr_auto] gap-x-1' : 'w-full'}>
            {showCoordinates ? (
              <>
                <div
                  className="grid justify-items-center text-[11px] font-semibold text-slate-500"
                  style={labelStyle}
                >
                  {fileLabels.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                <div />
              </>
            ) : null}

            <div
              className="grid overflow-hidden rounded-sm border-2 border-amber-800 bg-amber-200 shadow-sm"
              style={boardStyle}
            >
              {rowIndexes.map((row) =>
                colIndexes.map((col) => {
                  const cell = state.board[row][col];
                  return (
                    <div
                      key={`${row}-${col}`}
                      className="flex aspect-square items-center justify-center border-r border-b border-amber-700/35 bg-[#e5c463] font-semibold leading-none text-slate-950"
                      style={{
                        width: cellSize,
                        height: cellSize,
                        fontSize: cellSize == null ? 'clamp(13px,1.3vw,19px)' : cellSize * 0.62,
                      }}
                    >
                      {cell ? (
                        <span
                          className={cell.promoted ? 'text-rose-700' : ''}
                          style={{ transform: cell.side !== bottomSide ? 'rotate(180deg)' : undefined }}
                        >
                          {pieceKanji(cell)}
                        </span>
                      ) : null}
                    </div>
                  );
                }),
              )}
            </div>

            {showCoordinates ? (
              <div
                className="grid content-stretch justify-items-center text-[11px] font-semibold text-slate-500"
                style={{ gridTemplateRows: `repeat(9, ${cellTrack})` }}
              >
                {rankLabels.map((label) => (
                  <span key={label} className="flex items-center" style={{ height: cellSize }}>
                    {label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {showHands ? <HandStrip side={bottomSide} hand={bottomHand} placement="bottom" /> : null}

        {showTurn ? (
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <span>手番</span>
            <span className="rounded-full bg-white px-2 py-[2px] font-semibold text-slate-700 ring-1 ring-slate-200">
              {sideName(state.sideToMove)}
            </span>
            <span>{state.moveNumber}手目</span>
          </div>
        ) : null}
      </div>
    );
  } catch {
    return (
      <div
        className="grid place-items-center rounded-md border border-rose-200 bg-rose-50 px-3 text-center text-sm font-semibold text-rose-700"
        style={{ minHeight: errorMinHeight }}
      >
        {errorText}
      </div>
    );
  }
}

function HandStrip({
  side,
  hand,
  placement,
}: {
  side: Side;
  hand: HandPieces;
  placement: 'top' | 'bottom';
}) {
  const pieces = HAND_PIECE_TYPES.filter((type) => hand[type] > 0);

  return (
    <div
      className={`flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm ${
        placement === 'top' ? 'justify-start' : 'justify-end'
      }`}
    >
      <div className="shrink-0 text-xs font-semibold text-slate-500">{sideName(side)} 持ち駒</div>
      {pieces.length === 0 ? (
        <div className="text-xs text-slate-400">なし</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {pieces.map((type) => (
            <span
              key={type}
              className="inline-flex h-7 min-w-7 items-center justify-center rounded border border-amber-300 bg-amber-50 px-1.5 text-sm font-semibold text-slate-900"
            >
              {HAND_KANJI[type]}
              {hand[type] > 1 ? <span className="ml-0.5 text-[11px] font-bold">{hand[type]}</span> : null}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function sideName(side: Side): string {
  return side === 'sente' ? '先手' : '後手';
}
