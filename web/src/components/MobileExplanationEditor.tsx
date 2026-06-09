import React from 'react';
import Board from './Board';
import type { Board as BoardType, HandPieces, Side } from '../types/shogi';

interface MobileExplanationEditorProps {
  board: BoardType;
  senteHand: HandPieces;
  goteHand: HandPieces;
  sideToMove: Side;
  title: string;
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
}

const MobileExplanationEditor: React.FC<MobileExplanationEditorProps> = ({
  board,
  senteHand,
  goteHand,
  sideToMove,
  title,
  value,
  onChange,
  onDone,
}) => {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <div className="mobile-explanation-mode">
      <header className="mobile-explanation-header">
        <strong>{title}</strong>
        <button type="button" onClick={onDone}>完了</button>
      </header>

      <div className="mobile-explanation-board">
        <Board
          mobile
          board={board}
          senteHand={senteHand}
          goteHand={goteHand}
          sideToMove={sideToMove}
        />
      </div>

      <textarea
        ref={textareaRef}
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="解説入力"
        placeholder="解説・メモを入力してください"
        className="mobile-explanation-textarea"
      />
    </div>
  );
};

export default MobileExplanationEditor;
