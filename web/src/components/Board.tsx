import React from 'react';
import type { Board as BoardType, Side, HandPieces, PieceType, HandPieceType } from '../types/shogi';
import { pieceKanji } from '../types/shogi';

export interface ArrowInfo {
  from: { row: number; col: number } | null;
  to: { row: number; col: number };
  style?: 'primary' | 'secondary' | 'tertiary';
  showNextLabel?: boolean;
}

interface BoardProps {
  board: BoardType;
  senteHand: HandPieces;
  goteHand: HandPieces;
  sideToMove: Side;
  selectedCell?: { row: number; col: number } | null;
  arrow?: ArrowInfo | null;
  arrows?: ArrowInfo[];
  onCellClick?: (row: number, col: number) => void;
  onHandPieceClick?: (side: Side, pieceType: HandPieceType) => void;
}

const FILE_LABELS = ['９', '８', '７', '６', '５', '４', '３', '２', '１'];
const RANK_LABELS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

const Board: React.FC<BoardProps> = ({
  board,
  senteHand,
  goteHand,
  sideToMove,
  selectedCell,
  arrow,
  arrows,
  onCellClick,
  onHandPieceClick,
}) => {
  const arrowList = arrows ?? (arrow ? [arrow] : []);

  return (
    <div className="flex items-start gap-4">
      {/* Gote hand (top-left) */}
      <HandDisplay
        side="gote"
        hand={goteHand}
        onClick={onHandPieceClick}
        label="☖持駒"
      />

      <div className="flex flex-col items-center">
        {/* File labels */}
        <div className="grid grid-cols-[repeat(9,48px)] justify-items-center text-[13px] text-gray-500 mb-0.5">
          {FILE_LABELS.map((f, i) => (
            <span key={i}>{f}</span>
          ))}
        </div>

        <div className="flex items-start gap-0.5">
          <div className="relative">
            <div className="grid grid-cols-[repeat(9,48px)] grid-rows-[repeat(9,48px)] border-2 border-[#8b6914] bg-[#deb862]">
              {board.map((row, ri) =>
                row.map((cell, ci) => {
                  const isSelected = selectedCell?.row === ri && selectedCell?.col === ci;
                  return (
                    <div
                      key={`${ri}-${ci}`}
                      className={`w-12 h-12 border border-[#c5a23e] flex items-center justify-center cursor-pointer relative select-none hover:bg-white/30 ${isSelected ? 'bg-blue-500/35' : ''}`}
                      onClick={() => onCellClick?.(ri, ci)}
                    >
                      {cell && (
                        <span
                          className={`text-[22px] font-bold leading-none ${cell.side === 'gote' ? 'rotate-180' : ''} ${cell.promoted ? 'text-red-700' : 'text-[#1a1a1a]'}`}
                        >
                          {pieceKanji(cell)}
                        </span>
                      )}
                    </div>
                  );
                }),
              )}
            </div>
            {arrowList.length > 0 && (
              <ArrowOverlay arrows={arrowList} />
            )}
          </div>
          {/* Rank labels */}
          <div className="flex flex-col justify-around h-[calc(48px*9+2px)] text-[13px] text-gray-500 pl-1">
            {RANK_LABELS.map((r, i) => (
              <span key={i}>{r}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Sente hand (bottom-right) */}
      <HandDisplay
        side="sente"
        hand={senteHand}
        onClick={onHandPieceClick}
        label="☗持駒"
      />
    </div>
  );
};

// ---- Hand piece display ----

const HAND_ORDER: HandPieceType[] = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
const HAND_KANJI: Record<HandPieceType, string> = {
  R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩',
};

interface HandDisplayProps {
  side: Side;
  hand: HandPieces;
  onClick?: (side: Side, type: HandPieceType) => void;
  label: string;
}

const HandDisplay: React.FC<HandDisplayProps> = ({ side, hand, onClick, label }) => {
  const pieces = HAND_ORDER.filter((t) => hand[t] > 0);
  return (
    <div className={`min-w-12 p-2 bg-[#f0e6c8] border border-[#c5a23e] rounded ${side === 'sente' ? 'self-end' : 'self-start'}`}>
      <div className="text-xs text-gray-500 mb-1 whitespace-nowrap">{label}</div>
      <div className="flex flex-col gap-1">
        {pieces.length === 0 && <span className="text-[11px] text-gray-400">なし</span>}
        {pieces.map((t) => (
          <span
            key={t}
            className="text-[20px] font-bold cursor-pointer p-0.5 rounded text-center hover:bg-blue-500/20"
            onClick={() => onClick?.(side, t)}
          >
            {HAND_KANJI[t]}
            {hand[t] > 1 && <sub>{hand[t]}</sub>}
          </span>
        ))}
      </div>
    </div>
  );
};

// ---- Arrow overlay ----

const CELL_SIZE = 48;

interface ArrowOverlayProps {
  arrows: ArrowInfo[];
}

const ARROW_STYLE = {
  primary: {
    stroke: 'rgba(220,38,38,0.85)',
    strokeWidth: 6,
    markerId: 'arrowhead-primary',
    markerSize: { w: 5, h: 3, refX: 3.5, refY: 1.6 },
  },
  secondary: {
    stroke: 'rgba(22, 92, 242, 0.69)',
    strokeWidth: 4,
    markerId: 'arrowhead-secondary',
    markerSize: { w: 6, h: 5, refX: 5.5, refY: 2.5 },
  },
  tertiary: {
    stroke: 'rgba(41, 115, 232, 0.79)',
    strokeWidth: 3,
    markerId: 'arrowhead-tertiary',
    markerSize: { w: 5, h: 4, refX: 4.5, refY: 2 },
  },
} as const;

const ArrowOverlay: React.FC<ArrowOverlayProps> = ({ arrows }) => {
  const boardW = 9 * CELL_SIZE;
  const boardH = 9 * CELL_SIZE;
  const drawable = arrows.filter((a) => a.from !== null);

  return (
    <svg className="absolute top-[2px] left-[2px] pointer-events-none z-10" style={{ width: boardW, height: boardH }} viewBox={`0 0 ${boardW} ${boardH}`}>
      <defs>
        {(Object.keys(ARROW_STYLE) as Array<keyof typeof ARROW_STYLE>).map((key) => {
          const s = ARROW_STYLE[key];
          return (
            <marker
              key={s.markerId}
              id={s.markerId}
              markerWidth={String(s.markerSize.w)}
              markerHeight={String(s.markerSize.h)}
              refX={String(s.markerSize.refX)}
              refY={String(s.markerSize.refY)}
              orient="auto"
            >
              <polygon
                points={`0 0, ${s.markerSize.w} ${s.markerSize.h / 2}, 0 ${s.markerSize.h}`}
                fill={s.stroke}
              />
            </marker>
          );
        })}
      </defs>
      {drawable.map((a, idx) => {
        const styleKey = a.style ?? 'primary';
        const style = ARROW_STYLE[styleKey];
        const from = a.from!;
        const x1 = from.col * CELL_SIZE + CELL_SIZE / 2;
        const y1 = from.row * CELL_SIZE + CELL_SIZE / 2;
        const x2 = a.to.col * CELL_SIZE + CELL_SIZE / 2;
        const y2 = a.to.row * CELL_SIZE + CELL_SIZE / 2;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        return (
          <g key={`${from.row}-${from.col}-${a.to.row}-${a.to.col}-${idx}`}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={style.stroke}
              strokeWidth={String(style.strokeWidth)}
              strokeLinecap="round"
              markerEnd={`url(#${style.markerId})`}
            />
            {a.showNextLabel && (
              <text
                x={String(midX + 8)}
                y={String(midY - 8)}
                fill="rgba(220,38,38,0.72)"
                fontSize="14"
                fontWeight="700"
              >
                次
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

export default Board;
