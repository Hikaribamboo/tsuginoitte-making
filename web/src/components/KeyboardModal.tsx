import React, { useEffect, useMemo, useRef, useState } from 'react';

interface KeyboardModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onInsert: (text: string) => void;
  onDelete: () => void;
}

type Position = { x: number; y: number };

const KEY_ROWS = [
  ['▲','１', '２', '３', '４', '５', '６', '７', '８', '９'],
  [ '△','ー', '二', '三', '四', '五', '六', '七', '八', '九'],
  ['飛', '角', '金', '銀', '桂', '香', '歩', '玉', '同'],
  ['龍', '馬', '成銀', '成桂', '成香', 'と', '成', '打'],
];

const KeyboardModal: React.FC<KeyboardModalProps> = ({ open, title, onClose, onInsert, onDelete }) => {
  const [position, setPosition] = useState<Position>({ x: 96, y: 96 });
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const modalStyle = useMemo(
    () => ({
      left: `${position.x}px`,
      top: `${position.y}px`,
    }),
    [position],
  );

  useEffect(() => {
    if (!open) return;
    setPosition({
      x: Math.max(12, Math.round(window.innerWidth - 320)),
      y: Math.max(12, Math.round(window.innerHeight - 228)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;

      setPosition({
        x: Math.max(12, dragState.originX + (event.clientX - dragState.startX)),
        y: Math.max(12, dragState.originY + (event.clientY - dragState.startY)),
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      dragStateRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [open]);

  if (!open) return null;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return (
    <div className="fixed inset-0 z-[80] pointer-events-none bg-transparent">
      <div
        className="fixed z-[81] pointer-events-auto w-[292px] max-w-[calc(100vw-24px)] rounded-lg border border-sky-200 bg-white shadow-2xl"
        style={modalStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-center justify-between rounded-t-lg border-b border-sky-100 bg-sky-50 px-2 py-1 cursor-move select-none"
          onPointerDown={handlePointerDown}
        >
          <div className="text-[12px] font-semibold text-slate-700">{title}</div>
          <button
            type="button"
            className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="px-2 py-2">
          <div className="grid gap-1.5">
            {KEY_ROWS.map((row, rowIndex) => (
              <div
                key={rowIndex}
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
              >
                {row.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => onInsert(key)}
                    className={`flex h-7 items-center justify-center rounded-md border border-sky-200 bg-white text-center leading-none text-slate-900 shadow-[0_1px_0_rgba(15,23,42,0.04)] transition-colors hover:bg-sky-50 active:bg-sky-100 ${
                      key.length >= 2 ? 'text-[11px] font-medium' : 'text-[15px] font-light'
                    }`}
                  >
                    {key}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onPointerDown={(event) => event.preventDefault()}
              onClick={onDelete}
              className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100 active:bg-rose-200"
            >
              削除
            </button>
          </div>
          <div className="mt-1.5 text-right text-[9px] text-slate-400">
            {title}
          </div>
        </div>
      </div>
    </div>
  );
};

export default KeyboardModal;
