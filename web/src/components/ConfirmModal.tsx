import React from 'react';

interface ConfirmModalProps {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'キャンセル',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={busy ? undefined : onCancel}>
      <div
        className="mx-4 w-full max-w-[380px] rounded-xl bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="mb-2 text-base font-semibold text-slate-900">{title}</h3>
        <div className="mb-4 text-[13px] leading-relaxed text-slate-600">{message}</div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="text-[13px] disabled:opacity-50">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50 ${
              danger
                ? 'border-red-600 bg-red-600 hover:bg-red-700'
                : 'border-sky-600 bg-sky-600 hover:bg-sky-700'
            }`}
          >
            {busy ? '処理中...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
