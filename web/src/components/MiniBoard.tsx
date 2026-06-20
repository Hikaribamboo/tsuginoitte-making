import React from 'react';
import ShogiBoardPreview from './ShogiBoardPreview';

interface MiniBoardProps {
  sfen: string;
  size?: number; // cell size in px, default 18
}

const MiniBoard: React.FC<MiniBoardProps> = ({ sfen, size = 18 }) => {
  return (
    <ShogiBoardPreview
      sfen={sfen}
      cellSize={size}
      maxWidth={(size * 9) + 2}
      className="mini-board"
      errorText=""
      errorMinHeight={size * 9}
    />
  );
};

export default MiniBoard;
