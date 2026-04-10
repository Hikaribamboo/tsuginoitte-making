import React from 'react';
import { parseSfen } from '../lib/sfen';
import { pieceKanji } from '../types/shogi';

interface MiniBoardProps {
  sfen: string;
  size?: number; // cell size in px, default 18
}

const MiniBoard: React.FC<MiniBoardProps> = ({ sfen, size = 18 }) => {
  const { board } = parseSfen(sfen);
  const gridSize = size * 9;

  return (
    <div
      className="mini-board"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(9, ${size}px)`,
        gridTemplateRows: `repeat(9, ${size}px)`,
        border: '1px solid #8b6914',
        background: '#deb862',
        width: gridSize + 2,
        height: gridSize + 2,
        flexShrink: 0,
      }}
    >
      {board.map((row, ri) =>
        row.map((cell, ci) => (
          <div
            key={`${ri}-${ci}`}
            style={{
              width: size,
              height: size,
              borderRight: ci < 8 ? '1px solid #c5a23e' : undefined,
              borderBottom: ri < 8 ? '1px solid #c5a23e' : undefined,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: size * 0.6,
              fontWeight: 'bold',
              lineHeight: 1,
              color: cell?.promoted ? '#b91c1c' : '#1a1a1a',
              transform: cell?.side === 'gote' ? 'rotate(180deg)' : undefined,
            }}
          >
            {cell ? pieceKanji(cell) : ''}
          </div>
        )),
      )}
    </div>
  );
};

export default MiniBoard;
