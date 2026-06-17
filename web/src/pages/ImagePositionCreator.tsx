import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Board from '../components/Board';
import MiniBoard from '../components/MiniBoard';
import { recognizeShogiPosition } from '../api/backend';
import {
  createWorkspace,
  listWorkspaces,
  saveWorkspaceDraft,
  type Workspace,
} from '../api/workspaces';
import {
  deleteImagePositionItem,
  listImagePositionItems,
  putImagePositionItem,
  type ImagePositionItem,
} from '../lib/image-position-store';
import {
  hasBlockingPositionIssue,
  validateSfenPosition,
  type PositionIssue,
} from '../lib/position-validation';
import { applyUsiMove, boardToSfen, EMPTY_SFEN, parseSfen, toUsiSquare } from '../lib/sfen';
import { usiToLabel } from '../lib/usi-to-label';
import { getValidDestinations, getValidDropSquares } from '../lib/legal-moves';
import type { Board as BoardType, HandPieceType, HandPieces, Piece, PieceType, Side } from '../types/shogi';
import {
  CAN_PROMOTE,
  HAND_PIECE_TYPES,
  PIECE_KANJI,
  PROMOTED_KANJI,
} from '../types/shogi';

const PIECE_TYPES: PieceType[] = ['K', 'R', 'B', 'G', 'S', 'N', 'L', 'P'];
const TOTAL_PIECES: Record<PieceType, number> = {
  K: 2,
  R: 2,
  B: 2,
  G: 4,
  S: 4,
  N: 4,
  L: 4,
  P: 18,
};

const STATUS_LABEL: Record<ImagePositionItem['status'], string> = {
  idle: '未生成',
  recognizing: '生成中',
  ready: '生成済み',
  error: '要確認',
};

const STATUS_CLASS: Record<ImagePositionItem['status'], string> = {
  idle: 'bg-gray-100 text-gray-600',
  recognizing: 'bg-blue-100 text-blue-700',
  ready: 'bg-emerald-100 text-emerald-700',
  error: 'bg-red-100 text-red-700',
};

type RecognitionModelVariant = 'normal' | 'kio';

const MODEL_VARIANT_LABEL: Record<RecognitionModelVariant, string> = {
  normal: 'ノーマル',
  kio: '棋桜',
};

function normalizeModelVariant(value: ImagePositionItem['recognitionModelVariant']): RecognitionModelVariant {
  return value === 'kio' ? 'kio' : 'normal';
}

function sortItems(items: ImagePositionItem[]): ImagePositionItem[] {
  return [...items].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

function createItemId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeRecognizedSfen(value: string | null | undefined): string | null {
  if (!value) return null;
  let source = value.trim();
  const positionMatch = source.match(/^position\s+sfen\s+(.+)$/i);
  if (positionMatch) source = positionMatch[1].trim();
  if (/^sfen\s+/i.test(source)) source = source.replace(/^sfen\s+/i, '').trim();
  source = source.split(/\s+moves\s+/i)[0]?.trim() ?? source;

  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return `${parts[0]} b - 1`;
  if (parts.length === 2) return `${parts[0]} ${parts[1]} - 1`;
  if (parts.length === 3) return `${parts[0]} ${parts[1]} ${parts[2]} 1`;
  if (parts.length >= 4) return parts.slice(0, 4).join(' ');
  return null;
}

function buildDefaultChoices(correct?: { usi: string; label: string }) {
  return {
    correct: {
      slotLabel: 'correct',
      usi: correct?.usi ?? '',
      label: correct?.label ?? '',
      explanation: '',
      line: [],
      eval_cp: null,
      eval_percent: null,
    },
    incorrect1: {
      slotLabel: 'incorrect1',
      usi: '',
      label: '',
      explanation: '',
      line: [],
      eval_cp: null,
      eval_percent: null,
    },
    incorrect2: {
      slotLabel: 'incorrect2',
      usi: '',
      label: '',
      explanation: '',
      line: [],
      eval_cp: null,
      eval_percent: null,
    },
  };
}

function getNextWorkspaceNumber(items: Workspace[]) {
  return items.reduce((maxNo, ws) => {
    const m = ws.name.match(/^#(\d+)\b/);
    if (!m) return maxNo;
    const n = Number.parseInt(m[1], 10);
    return Number.isNaN(n) ? maxNo : Math.max(maxNo, n);
  }, 0) + 1;
}

function buildAutoWorkspaceName(nextNumber: number, suffix = '画像局面') {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `#${nextNumber} ${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} ${suffix}`;
}

function makeIssue(severity: PositionIssue['severity'], message: string): PositionIssue {
  return { severity, message };
}

function issueSummary(issues: PositionIssue[]) {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  if (errors > 0) return `エラー ${errors}件`;
  if (warnings > 0) return `警告 ${warnings}件`;
  return '問題なし';
}

async function fileToResizedDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const maxSide = 1400;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('画像を読み込めませんでした'));
        return;
      }
      ctx.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`${file.name} を画像として読み込めませんでした`));
    };
    image.src = objectUrl;
  });
}

function cloneBoard(board: BoardType): BoardType {
  return board.map((row) => row.map((piece) => (piece ? { ...piece } : null)));
}

type PieceSelection =
  | { source: 'board'; row: number; col: number; piece: Piece }
  | { source: 'hand'; side: Side; type: HandPieceType; piece: Piece }
  | { source: 'box'; type: PieceType; piece: Piece };
type BoardCell = { row: number; col: number };
type MoveRegistrationMode = 'intro' | 'correct' | null;

function cloneHand(hand: HandPieces): HandPieces {
  return { ...hand };
}

function isHandPieceType(type: PieceType): type is HandPieceType {
  return type !== 'K';
}

function rotatePieceVariant(piece: Piece): Piece {
  if (!CAN_PROMOTE[piece.type]) {
    return { ...piece, side: piece.side === 'sente' ? 'gote' : 'sente' };
  }
  if (!piece.promoted) {
    return { ...piece, promoted: true };
  }
  if (piece.side === 'sente') {
    return { ...piece, side: 'gote', promoted: false };
  }
  return { ...piece, side: 'sente', promoted: false };
}

function countPositionPieces(board: BoardType, senteHand: HandPieces, goteHand: HandPieces): Record<PieceType, number> {
  const counts: Record<PieceType, number> = {
    K: 0,
    R: 0,
    B: 0,
    G: 0,
    S: 0,
    N: 0,
    L: 0,
    P: 0,
  };

  for (const row of board) {
    for (const piece of row) {
      if (piece) counts[piece.type] += 1;
    }
  }
  for (const type of HAND_PIECE_TYPES) {
    counts[type] += senteHand[type] + goteHand[type];
  }
  return counts;
}

function missingPieceCounts(board: BoardType, senteHand: HandPieces, goteHand: HandPieces): Record<PieceType, number> {
  const counts = countPositionPieces(board, senteHand, goteHand);
  return PIECE_TYPES.reduce((acc, type) => {
    acc[type] = Math.max(0, TOTAL_PIECES[type] - counts[type]);
    return acc;
  }, {} as Record<PieceType, number>);
}

function selectionMatchesBoard(selection: PieceSelection | null, row: number, col: number): boolean {
  return selection?.source === 'board' && selection.row === row && selection.col === col;
}

const ImagePositionCreator: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const itemsRef = useRef<ImagePositionItem[]>([]);
  const [items, setItems] = useState<ImagePositionItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState('');
  const [showDeleteImageConfirm, setShowDeleteImageConfirm] = useState(false);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    let cancelled = false;
    listImagePositionItems()
      .then((loaded) => {
        if (!cancelled) setItems(sortItems(loaded));
      })
      .catch((err: any) => {
        if (!cancelled) setMessage(`画像局面の読み込みに失敗しました: ${err.message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveItem = useCallback(async (next: ImagePositionItem) => {
    setItems((prev) => sortItems([next, ...prev.filter((item) => item.id !== next.id)]));
    await putImagePositionItem(next);
  }, []);

  const patchItem = useCallback(async (
    id: string,
    patch: Partial<ImagePositionItem>,
  ) => {
    const current = itemsRef.current.find((item) => item.id === id);
    if (!current) return;
    const next: ImagePositionItem = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await saveItem(next);
  }, [saveItem]);

  const activeItem = useMemo(
    () => items.find((item) => item.id === activeId) ?? null,
    [activeId, items],
  );

  const handleFiles = useCallback(async (fileList: File[] | FileList) => {
    const imageFiles = Array.from(fileList).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    setUploading(true);
    setMessage('');
    try {
      const createdItems: ImagePositionItem[] = [];
      for (const file of imageFiles) {
        const now = new Date().toISOString();
        const imageDataUrl = await fileToResizedDataUrl(file);
        const item: ImagePositionItem = {
          id: createItemId(),
          fileName: file.name || 'clipboard-image.jpg',
          imageDataUrl,
          memo: '',
          sfen: null,
          introMoveUsi: '',
          correctMoveUsi: '',
          correctMoveLabel: '',
          status: 'idle',
          issues: [],
          recognitionNotes: [],
          recognitionModelVariant: 'normal',
          createdAt: now,
          updatedAt: now,
        };
        createdItems.push(item);
        await putImagePositionItem(item);
      }
      setItems((prev) => sortItems([...createdItems, ...prev]));
      setMessage(`${createdItems.length}枚の画像を追加しました`);
    } catch (err: any) {
      setMessage(err.message ?? '画像の追加に失敗しました');
    } finally {
      setUploading(false);
    }
  }, []);

  const handleRecognize = useCallback(async (id: string) => {
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (!item) return;
    const modelVariant = normalizeModelVariant(item.recognitionModelVariant);

    await patchItem(id, {
      status: 'recognizing',
      issues: [],
      recognitionNotes: [],
      recognitionModelVariant: modelVariant,
    });

    try {
      const result = await recognizeShogiPosition(item.imageDataUrl, modelVariant);
      const sfen = normalizeRecognizedSfen(result.sfen);
      if (!sfen) {
        throw new Error('画像認識結果にSFENが含まれていません');
      }
      const issues = validateSfenPosition(sfen);
      const validationNotes = Array.isArray(result.validationIssues)
        ? result.validationIssues.map((issue) => issue.message)
        : [];
      await patchItem(id, {
        sfen,
        status: hasBlockingPositionIssue(issues) ? 'error' : 'ready',
        issues,
        recognitionNotes: result.notes && result.notes.length > 0 ? result.notes : validationNotes,
        recognitionSquares: result.squares ?? [],
        recognitionPieceBox: result.pieceBox ?? [],
        recognitionValidationIssues: result.validationIssues ?? [],
        recognitionModelVariant: result.modelVariant ?? modelVariant,
        recognitionModel: result.model,
        recognitionConfidence: result.confidence,
        recognizedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      await patchItem(id, {
        status: 'error',
        issues: [makeIssue('error', err.message ?? '画像認識に失敗しました')],
        recognitionNotes: [],
      });
    }
  }, [patchItem]);

  const handleDelete = useCallback(async (id: string) => {
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (!item) return;
    if (!window.confirm(`「${item.fileName}」を削除しますか？`)) return;
    await deleteImagePositionItem(id);
    setItems((prev) => prev.filter((candidate) => candidate.id !== id));
    if (activeId === id) setActiveId(null);
  }, [activeId]);

  const handleConfirmDeleteImage = useCallback(async () => {
    const id = deleteCandidateId;
    if (!id) return;
    try {
      await deleteImagePositionItem(id);
      setItems((prev) => prev.filter((candidate) => candidate.id !== id));
      if (activeId === id) setActiveId(null);
      setMessage('画像データを削除しました');
    } catch (err: any) {
      setMessage(`画像データの削除に失敗しました: ${err.message}`);
    } finally {
      setShowDeleteImageConfirm(false);
      setDeleteCandidateId(null);
    }
  }, [deleteCandidateId, activeId]);

  if (activeItem) {
    return (
      <>
        <ImagePositionDetail
          item={activeItem}
          patchItem={patchItem}
          onBack={() => setActiveId(null)}
          onAskDeleteSourceImage={(id) => {
            setDeleteCandidateId(id);
            setShowDeleteImageConfirm(true);
          }}
        />

        {/* Post-save: ask to delete source image data modal */}
        {showDeleteImageConfirm && deleteCandidateId && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => { setShowDeleteImageConfirm(false); setDeleteCandidateId(null); }}
          >
            <div
              className="bg-white rounded-xl shadow-2xl p-5 w-full max-w-[380px] mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-semibold mb-2">画像データの削除</h3>
              <p className="text-[13px] text-gray-600 mb-4">
                この下書きは画像から作成されました。画像データを削除しますか？
                <br />削除するとローカルの保存データ（IndexedDB）から削除されます。
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowDeleteImageConfirm(false); setDeleteCandidateId(null); }}
                  className="text-[13px]"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => { void handleConfirmDeleteImage(); }}
                  className="bg-red-600 text-white border-red-600 hover:bg-red-700 text-[13px] px-4 py-1.5 rounded"
                >
                  削除する
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="image-position-page max-w-[1120px] mx-auto flex flex-col gap-4">
      <div className="image-position-header flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">画像から局面作成</h2>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
        >
          PCからインポート
        </button>
      </div>

      <div
        className={`border border-dashed rounded-lg p-4 bg-white/70 transition-colors ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-blue-200'}`}
        tabIndex={0}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files).filter((file) => file.type.startsWith('image/'));
          if (files.length > 0) {
            e.preventDefault();
            void handleFiles(files);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          void handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold text-gray-700">
            画像をペースト、ドラッグドロップ、またはインポート
          </div>
          <div className="text-[12px] text-gray-500">
            将棋盤のスクリーンショットを複数枚まとめて追加できます。生成後にサムネイルへ検出結果と不自然な点を表示します。
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              画像を選択
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  const clipboardItems = await navigator.clipboard.read();
                  const files: File[] = [];
                  for (const clipboardItem of clipboardItems) {
                    const imageType = clipboardItem.types.find((type) => type.startsWith('image/'));
                    if (!imageType) continue;
                    const blob = await clipboardItem.getType(imageType);
                    files.push(new File([blob], 'clipboard-image.jpg', { type: blob.type }));
                  }
                  if (files.length === 0) {
                    setMessage('クリップボードに画像がありません');
                    return;
                  }
                  await handleFiles(files);
                } catch {
                  setMessage('クリップボード画像の読み取りに失敗しました');
                }
              }}
              disabled={uploading}
            >
              クリップボードから貼り付け
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.currentTarget.value = '';
          }}
        />
      </div>

      {message && (
        <div className="text-[12px] bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2">
          {message}
        </div>
      )}

      {/* Post-save: ask to delete source image data modal */}
      {showDeleteImageConfirm && deleteCandidateId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => { setShowDeleteImageConfirm(false); setDeleteCandidateId(null); }}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-5 w-full max-w-[380px] mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-2">画像データの削除</h3>
            <p className="text-[13px] text-gray-600 mb-4">
              この下書きは画像から作成されました。画像データを削除しますか？
              <br />削除するとローカルの保存データ（IndexedDB）から削除されます。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowDeleteImageConfirm(false); setDeleteCandidateId(null); }}
                className="text-[13px]"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => { void handleConfirmDeleteImage(); }}
                className="bg-red-600 text-white border-red-600 hover:bg-red-700 text-[13px] px-4 py-1.5 rounded"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-[13px] text-gray-500 py-8 text-center">読み込み中...</div>
      ) : items.length === 0 ? (
        <div className="text-[13px] text-gray-500 py-8 text-center border border-dashed border-gray-300 rounded-lg">
          まだ画像局面がありません。上の欄に画像を追加してください。
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {items.map((item) => (
            <ImagePositionCard
              key={item.id}
              item={item}
              onMemoChange={(memo) => void patchItem(item.id, { memo })}
              onModelVariantChange={(recognitionModelVariant) => void patchItem(item.id, { recognitionModelVariant })}
              onRecognize={() => void handleRecognize(item.id)}
              onOpen={() => setActiveId(item.id)}
              onDelete={() => void handleDelete(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface ImagePositionCardProps {
  item: ImagePositionItem;
  onMemoChange: (memo: string) => void;
  onModelVariantChange: (modelVariant: RecognitionModelVariant) => void;
  onRecognize: () => void;
  onOpen: () => void;
  onDelete: () => void;
}

const ImagePositionCard: React.FC<ImagePositionCardProps> = ({
  item,
  onMemoChange,
  onModelVariantChange,
  onRecognize,
  onOpen,
  onDelete,
}) => {
  const shownIssues = item.issues.slice(0, 3);
  const canRecognize = item.status !== 'recognizing';
  const modelVariant = normalizeModelVariant(item.recognitionModelVariant);
  return (
    <div className="border border-gray-200 rounded-lg bg-white/85 p-3 flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="w-[132px] h-[112px] bg-gray-100 border border-gray-200 rounded overflow-hidden flex items-center justify-center flex-shrink-0">
          <img
            src={item.imageDataUrl}
            alt={item.fileName}
            className="w-full h-full object-contain"
          />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-center gap-1 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_CLASS[item.status]}`}>
              {STATUS_LABEL[item.status]}
            </span>
            <span className={hasBlockingPositionIssue(item.issues) ? 'text-[10px] text-red-700' : 'text-[10px] text-gray-500'}>
              {issueSummary(item.issues)}
            </span>
          </div>
          <div className="text-[12px] font-semibold truncate" title={item.fileName}>
            {item.fileName}
          </div>
          {item.sfen ? (
            <MiniBoard sfen={item.sfen} size={12} />
          ) : (
            <div className="text-[11px] text-gray-400 border border-dashed border-gray-200 rounded p-2">
              SFEN未生成
            </div>
          )}
        </div>
      </div>

      <textarea
        rows={2}
        value={item.memo}
        onChange={(e) => onMemoChange(e.target.value)}
        placeholder="メモ"
        className="text-[12px]"
      />

      {item.recognitionNotes.length > 0 && (
        <div className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1">
          {item.recognitionNotes.slice(0, 2).join(' / ')}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="grid grid-cols-2 gap-1 w-[164px]">
          {(['normal', 'kio'] as const).map((variant) => (
            <button
              key={variant}
              type="button"
              onClick={() => onModelVariantChange(variant)}
              disabled={!canRecognize}
              className={modelVariant === variant
                ? 'bg-slate-800 text-white border-slate-800 hover:bg-slate-700'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}
            >
              {MODEL_VARIANT_LABEL[variant]}
            </button>
          ))}
        </div>
        {item.recognitionModel && (
          <div className="text-[10px] text-gray-500 truncate" title={item.recognitionModel}>
            {MODEL_VARIANT_LABEL[modelVariant]} / {item.recognitionModel}
          </div>
        )}
      </div>

      {shownIssues.length > 0 && (
        <div className="flex flex-col gap-1">
          {shownIssues.map((issue, idx) => (
            <div
              key={`${issue.message}-${idx}`}
              className={`text-[11px] px-2 py-1 rounded ${issue.severity === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}
            >
              {issue.message}
            </div>
          ))}
          {item.issues.length > shownIssues.length && (
            <div className="text-[10px] text-gray-500">
              ほか {item.issues.length - shownIssues.length} 件
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-auto">
        <button
          type="button"
          onClick={onRecognize}
          disabled={!canRecognize}
          className="flex-1 bg-blue-600 text-white border-blue-600 hover:bg-blue-700 disabled:opacity-60"
        >
          {item.status === 'recognizing' ? '生成中...' : '画像から局面を生成'}
        </button>
        <button type="button" onClick={onOpen}>
          開く
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-red-600 border-red-200 hover:bg-red-50"
          title="削除"
        >
          削除
        </button>
      </div>
    </div>
  );
};

interface ImagePositionDetailProps {
  item: ImagePositionItem;
  patchItem: (id: string, patch: Partial<ImagePositionItem>) => Promise<void>;
  onBack: () => void;
  onAskDeleteSourceImage: (id: string) => void;
}

const ImagePositionDetail: React.FC<ImagePositionDetailProps> = ({
  item,
  patchItem,
  onBack,
  onAskDeleteSourceImage,
}) => {
  const navigate = useNavigate();
  const parsed = useMemo(() => parseSfen(item.sfen ?? EMPTY_SFEN), [item.sfen]);
  const currentSfen = item.sfen ?? EMPTY_SFEN;
  const displaySfen = useMemo(() => {
    const introMoveUsi = item.introMoveUsi?.trim();
    if (!introMoveUsi) return currentSfen;
    try {
      const result = applyUsiMove(
        parsed.board,
        parsed.senteHand,
        parsed.goteHand,
        parsed.sideToMove,
        introMoveUsi,
      );
      const nextSide = parsed.sideToMove === 'sente' ? 'gote' : 'sente';
      return boardToSfen(
        result.board,
        nextSide,
        result.senteHand,
        result.goteHand,
        parsed.moveNumber + 1,
      );
    } catch {
      return currentSfen;
    }
  }, [currentSfen, item.introMoveUsi, parsed]);
  const displayParsed = useMemo(() => parseSfen(displaySfen), [displaySfen]);
  const recognitionValidationIssues = useMemo(
    () => item.recognitionValidationIssues ?? [],
    [item.recognitionValidationIssues],
  );
  const [selection, setSelection] = useState<PieceSelection | null>(null);
  const [moveMode, setMoveMode] = useState<MoveRegistrationMode>(null);
  const [moveSelectedCell, setMoveSelectedCell] = useState<BoardCell | null>(null);
  const [introDestination, setIntroDestination] = useState<BoardCell | null>(null);
  const introDestinationRef = useRef<BoardCell | null>(null);
  const [moveSelectedHandPiece, setMoveSelectedHandPiece] = useState<{ side: Side; type: HandPieceType } | null>(null);
  const [promotionChoice, setPromotionChoice] = useState<{
    fromSq: string;
    toSq: string;
    pieceType: PieceType;
  } | null>(null);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setSelection(null);
    setMoveMode(null);
    setMoveSelectedCell(null);
    setMoveSelectedHandPiece(null);
    setIntroDestination(null);
    introDestinationRef.current = null;
    setPromotionChoice(null);
  }, [item.id]);

  const rulePieceBox = useMemo(
    () => missingPieceCounts(displayParsed.board, displayParsed.senteHand, displayParsed.goteHand),
    [displayParsed.board, displayParsed.goteHand, displayParsed.senteHand],
  );
  const rulePieceBoxTotal = useMemo(
    () => PIECE_TYPES.reduce((total, type) => total + rulePieceBox[type], 0),
    [rulePieceBox],
  );

  const commitState = useCallback((next: {
    board: BoardType;
    sideToMove: Side;
    senteHand: HandPieces;
    goteHand: HandPieces;
    moveNumber: number;
  }, options?: { clearMoveRegistration?: boolean }) => {
    const moveNumber = next.sideToMove === 'gote' ? 2 : next.moveNumber;
    const nextSfen = boardToSfen(
      next.board,
      next.sideToMove,
      next.senteHand,
      next.goteHand,
      moveNumber,
    );
    const issues = validateSfenPosition(nextSfen);
    void patchItem(item.id, {
      sfen: nextSfen,
      ...(options?.clearMoveRegistration
        ? { introMoveUsi: '', correctMoveUsi: '', correctMoveLabel: '' }
        : {}),
      status: hasBlockingPositionIssue(issues) ? 'error' : 'ready',
      issues,
    });
  }, [item.id, patchItem]);

  const updateSideToMove = useCallback((sideToMove: Side) => {
    setMoveMode(null);
    setSelection(null);
    setMoveSelectedCell(null);
    setMoveSelectedHandPiece(null);
    setIntroDestination(null);
    introDestinationRef.current = null;
    setPromotionChoice(null);
    commitState({ ...displayParsed, sideToMove }, { clearMoveRegistration: true });
  }, [commitState, displayParsed]);

  const removeSelectionFromState = useCallback((
    source: PieceSelection,
    board: BoardType,
    senteHand: HandPieces,
    goteHand: HandPieces,
  ) => {
    if (source.source === 'board') {
      board[source.row][source.col] = null;
      return;
    }
    if (source.source === 'hand') {
      const hand = source.side === 'sente' ? senteHand : goteHand;
      hand[source.type] = Math.max(0, hand[source.type] - 1);
    }
  }, []);

  const setIntroDestinationBoth = useCallback((cell: BoardCell | null) => {
    introDestinationRef.current = cell;
    setIntroDestination(cell);
  }, []);

  const clearMoveSelection = useCallback(() => {
    setMoveSelectedCell(null);
    setMoveSelectedHandPiece(null);
    setIntroDestinationBoth(null);
    setPromotionChoice(null);
  }, [setIntroDestinationBoth]);

  const activateMoveMode = useCallback((mode: Exclude<MoveRegistrationMode, null>) => {
    setSelection(null);
    clearMoveSelection();
    setMoveMode((prev) => (prev === mode ? null : mode));
  }, [clearMoveSelection]);

  const clearIntroMove = useCallback(() => {
    setMoveMode(null);
    clearMoveSelection();
    void patchItem(item.id, {
      introMoveUsi: '',
      correctMoveUsi: '',
      correctMoveLabel: '',
    });
  }, [clearMoveSelection, item.id, patchItem]);

  const clearCorrectMove = useCallback(() => {
    setMoveMode(null);
    clearMoveSelection();
    void patchItem(item.id, {
      correctMoveUsi: '',
      correctMoveLabel: '',
    });
  }, [clearMoveSelection, item.id, patchItem]);

  const registerIntroMove = useCallback((usi: string, rootSfen: string) => {
    const issues = validateSfenPosition(rootSfen);
    setMoveMode(null);
    clearMoveSelection();
    void patchItem(item.id, {
      sfen: rootSfen,
      introMoveUsi: usi,
      correctMoveUsi: '',
      correctMoveLabel: '',
      status: hasBlockingPositionIssue(issues) ? 'error' : 'ready',
      issues,
    });
  }, [clearMoveSelection, item.id, patchItem]);

  const registerCorrectMove = useCallback((usi: string) => {
    const label = usiToLabel(usi, displayParsed.board, displayParsed.sideToMove);
    setMoveMode(null);
    clearMoveSelection();
    void patchItem(item.id, {
      correctMoveUsi: usi,
      correctMoveLabel: label,
    });
  }, [clearMoveSelection, displayParsed.board, displayParsed.sideToMove, item.id, patchItem]);

  const handleIntroCellClick = useCallback((row: number, col: number) => {
    const destination = introDestinationRef.current;

    if (!destination) {
      if (!displayParsed.board[row][col]) return;
      setIntroDestinationBoth({ row, col });
      return;
    }

    if (destination.row === row && destination.col === col) {
      setIntroDestinationBoth(null);
      return;
    }

    const movedPiece = displayParsed.board[destination.row][destination.col];
    if (!movedPiece) return;

    const rewoundBoard = cloneBoard(displayParsed.board);
    rewoundBoard[row][col] = { ...movedPiece };
    rewoundBoard[destination.row][destination.col] = null;
    const previousSide = displayParsed.sideToMove === 'sente' ? 'gote' : 'sente';
    const previousMoveNumber = Math.max(1, displayParsed.moveNumber - 1);
    const rootSfen = boardToSfen(
      rewoundBoard,
      previousSide,
      displayParsed.senteHand,
      displayParsed.goteHand,
      previousMoveNumber,
    );
    registerIntroMove(`${toUsiSquare(row, col)}${toUsiSquare(destination.row, destination.col)}`, rootSfen);
  }, [displayParsed, registerIntroMove, setIntroDestinationBoth]);

  const handleCorrectCellClick = useCallback((row: number, col: number) => {
    const board = displayParsed.board;
    const side = displayParsed.sideToMove;

    if (moveSelectedHandPiece) {
      const validDrops = getValidDropSquares(board, side, moveSelectedHandPiece.type);
      if (!validDrops.some((square) => square.row === row && square.col === col)) {
        const piece = board[row][col];
        if (piece && piece.side === side) {
          setMoveSelectedHandPiece(null);
          setMoveSelectedCell({ row, col });
        }
        return;
      }
      registerCorrectMove(`${moveSelectedHandPiece.type}*${toUsiSquare(row, col)}`);
      return;
    }

    if (!moveSelectedCell) {
      const piece = board[row][col];
      if (piece && piece.side === side) setMoveSelectedCell({ row, col });
      return;
    }

    if (moveSelectedCell.row === row && moveSelectedCell.col === col) {
      setMoveSelectedCell(null);
      return;
    }

    const targetPiece = board[row][col];
    if (targetPiece && targetPiece.side === side) {
      setMoveSelectedCell({ row, col });
      return;
    }

    const validMoves = getValidDestinations(board, moveSelectedCell.row, moveSelectedCell.col, side);
    if (!validMoves.some((square) => square.row === row && square.col === col)) return;

    const fromSq = toUsiSquare(moveSelectedCell.row, moveSelectedCell.col);
    const toSq = toUsiSquare(row, col);
    const piece = board[moveSelectedCell.row][moveSelectedCell.col];

    if (piece && !piece.promoted && CAN_PROMOTE[piece.type]) {
      const inPromotionZone =
        (side === 'sente' && (row <= 2 || moveSelectedCell.row <= 2)) ||
        (side === 'gote' && (row >= 6 || moveSelectedCell.row >= 6));
      if (inPromotionZone) {
        const mustPromote =
          (piece.type === 'P' && ((side === 'sente' && row === 0) || (side === 'gote' && row === 8))) ||
          (piece.type === 'L' && ((side === 'sente' && row === 0) || (side === 'gote' && row === 8))) ||
          (piece.type === 'N' && ((side === 'sente' && row <= 1) || (side === 'gote' && row >= 7)));
        if (mustPromote) {
          registerCorrectMove(`${fromSq}${toSq}+`);
        } else {
          setPromotionChoice({ fromSq, toSq, pieceType: piece.type });
          setMoveSelectedCell(null);
        }
        return;
      }
    }

    registerCorrectMove(`${fromSq}${toSq}`);
  }, [displayParsed.board, displayParsed.sideToMove, moveSelectedCell, moveSelectedHandPiece, registerCorrectMove]);

  const handleCellClick = useCallback((row: number, col: number) => {
    if (promotionChoice) return;
    if (moveMode === 'intro') {
      handleIntroCellClick(row, col);
      return;
    }
    if (moveMode === 'correct') {
      handleCorrectCellClick(row, col);
      return;
    }

    const board = cloneBoard(displayParsed.board);
    const senteHand = cloneHand(displayParsed.senteHand);
    const goteHand = cloneHand(displayParsed.goteHand);

    if (!selection) {
      const piece = board[row][col];
      if (piece) {
        setSelection({ source: 'board', row, col, piece: { ...piece } });
      }
      return;
    }

    if (selectionMatchesBoard(selection, row, col)) {
      setSelection(null);
      return;
    }

    removeSelectionFromState(selection, board, senteHand, goteHand);
    board[row][col] = { ...selection.piece };
    setSelection(null);
    commitState({ ...displayParsed, board, senteHand, goteHand }, { clearMoveRegistration: true });
  }, [commitState, displayParsed, handleCorrectCellClick, handleIntroCellClick, moveMode, promotionChoice, removeSelectionFromState, selection]);

  const handleCellDoubleClick = useCallback((row: number, col: number) => {
    if (moveMode) return;
    const board = cloneBoard(displayParsed.board);
    const piece = board[row][col];
    if (!piece) return;
    board[row][col] = rotatePieceVariant(piece);
    setSelection(null);
    commitState({ ...displayParsed, board }, { clearMoveRegistration: true });
  }, [commitState, displayParsed, moveMode]);

  const handleHandPieceClick = useCallback((side: Side, clickedType: HandPieceType) => {
    if (moveMode === 'intro') {
      const destination = introDestinationRef.current ?? introDestination;
      const previousSide = displayParsed.sideToMove === 'sente' ? 'gote' : 'sente';
      if (destination && side === previousSide) {
        const rewoundBoard = cloneBoard(displayParsed.board);
        rewoundBoard[destination.row][destination.col] = null;
        const senteHand = cloneHand(displayParsed.senteHand);
        const goteHand = cloneHand(displayParsed.goteHand);
        const previousHand = previousSide === 'sente' ? senteHand : goteHand;
        previousHand[clickedType] = Math.min(99, previousHand[clickedType] + 1);
        const rootSfen = boardToSfen(
          rewoundBoard,
          previousSide,
          senteHand,
          goteHand,
          Math.max(1, displayParsed.moveNumber - 1),
        );
        registerIntroMove(`${clickedType}*${toUsiSquare(destination.row, destination.col)}`, rootSfen);
      }
      return;
    }

    if (moveMode === 'correct') {
      const hand = side === 'sente' ? displayParsed.senteHand : displayParsed.goteHand;
      if (side !== displayParsed.sideToMove || hand[clickedType] <= 0) return;
      setMoveSelectedCell(null);
      setMoveSelectedHandPiece((prev) =>
        prev?.side === side && prev.type === clickedType ? null : { side, type: clickedType },
      );
      return;
    }

    const board = cloneBoard(displayParsed.board);
    const senteHand = cloneHand(displayParsed.senteHand);
    const goteHand = cloneHand(displayParsed.goteHand);
    const clickedHand = side === 'sente' ? senteHand : goteHand;

    if (!selection) {
      if (clickedHand[clickedType] > 0) {
        setSelection({
          source: 'hand',
          side,
          type: clickedType,
          piece: { type: clickedType, side, promoted: false },
        });
      }
      return;
    }

    if (!isHandPieceType(selection.piece.type)) return;
    if (selection.source === 'hand' && selection.side === side && selection.type === selection.piece.type) {
      setSelection(null);
      return;
    }

    removeSelectionFromState(selection, board, senteHand, goteHand);
    clickedHand[selection.piece.type] = Math.min(99, clickedHand[selection.piece.type] + 1);
    setSelection(null);
    commitState({ ...displayParsed, board, senteHand, goteHand }, { clearMoveRegistration: true });
  }, [commitState, displayParsed, introDestination, moveMode, registerIntroMove, removeSelectionFromState, selection]);

  const handlePromotionSelect = useCallback((promote: boolean) => {
    if (!promotionChoice) return;
    const usi = `${promotionChoice.fromSq}${promotionChoice.toSq}${promote ? '+' : ''}`;
    registerCorrectMove(usi);
    setPromotionChoice(null);
  }, [promotionChoice, registerCorrectMove]);

  const handlePieceBoxClick = useCallback((type: PieceType) => {
    if (moveMode) return;
    if (rulePieceBox[type] <= 0) return;
    setSelection({
      source: 'box',
      type,
      piece: { type, side: 'sente', promoted: false },
    });
  }, [moveMode, rulePieceBox]);

  const handlePieceBoxReturnClick = useCallback(() => {
    if (moveMode) return;
    if (!selection || selection.source === 'box') {
      setSelection(null);
      return;
    }
    const board = cloneBoard(displayParsed.board);
    const senteHand = cloneHand(displayParsed.senteHand);
    const goteHand = cloneHand(displayParsed.goteHand);
    removeSelectionFromState(selection, board, senteHand, goteHand);
    setSelection(null);
    commitState({ ...displayParsed, board, senteHand, goteHand }, { clearMoveRegistration: true });
  }, [commitState, displayParsed, moveMode, removeSelectionFromState, selection]);

  const copySfen = async () => {
    try {
      await navigator.clipboard.writeText(currentSfen);
      setMessage('SFENをコピーしました');
    } catch {
      setMessage('SFENのコピーに失敗しました');
    }
  };

  const handleAddWorkspace = async () => {
    const issues = validateSfenPosition(currentSfen);
    if (hasBlockingPositionIssue(issues)) {
      const ok = window.confirm('この局面にはエラーがあります。それでも下書きに追加しますか？');
      if (!ok) return;
    }

    setSavingWorkspace(true);
    setMessage('');
    try {
      const correctMove = item.correctMoveUsi
        ? {
            usi: item.correctMoveUsi,
            label: item.correctMoveLabel || usiToLabel(item.correctMoveUsi, displayParsed.board, displayParsed.sideToMove),
          }
        : undefined;
      const latestWorkspaces = await listWorkspaces();
      const nextNumber = getNextWorkspaceNumber(latestWorkspaces);
      const ws = await createWorkspace(buildAutoWorkspaceName(nextNumber));
        await saveWorkspaceDraft(ws.id, {
        kifText: '',
        rootSfen: currentSfen,
        kifMoves: [],
        introMoveUsi: item.introMoveUsi ?? '',
        choices: buildDefaultChoices(correctMove),
        readingLineInputs: { correct: '', incorrect1: '', incorrect2: '' },
        prompt: '',
        tags: [],
          // Image-origin drafts should default to joseki mode
          mode: 'joseki',
        displayNo: null,
        problemRating: 1500,
        rootEvalCp: null,
        rootEvalPercent: null,
        savedAt: new Date().toISOString(),
        imagePositionSource: {
          imageItemId: item.id,
          fileName: item.fileName,
          memo: item.memo,
          recognitionModel: item.recognitionModel ?? null,
          recognitionModelVariant: item.recognitionModelVariant ?? null,
          recognitionConfidence: item.recognitionConfidence ?? null,
          recognitionNotes: item.recognitionNotes,
          issues,
          introMoveUsi: item.introMoveUsi ?? null,
          correctMoveUsi: item.correctMoveUsi ?? null,
          correctMoveLabel: correctMove?.label ?? null,
        },
      });
      setMessage(`下書き「${ws.name}」に追加しました`);
      // Ask whether to delete the source image data
      onAskDeleteSourceImage(item.id);
    } catch (err: any) {
      setMessage(`下書き追加に失敗しました: ${err.message}`);
    } finally {
      setSavingWorkspace(false);
    }
  };

  const boardSelectedCell = moveMode === 'intro'
    ? introDestination
    : moveMode === 'correct'
      ? moveSelectedCell
      : selection?.source === 'board'
    ? { row: selection.row, col: selection.col }
    : null;
  const selectedHandPiece = moveMode === 'correct'
    ? moveSelectedHandPiece
    : selection?.source === 'hand'
    ? { side: selection.side, type: selection.type }
    : null;
  const selectedBoxType = selection?.source === 'box' ? selection.type : null;
  const introMoveLabel = item.introMoveUsi
    ? usiToLabel(item.introMoveUsi, parsed.board, parsed.sideToMove)
    : '';
  const correctMoveLabel = item.correctMoveUsi
    ? item.correctMoveLabel || usiToLabel(item.correctMoveUsi, displayParsed.board, displayParsed.sideToMove)
    : '';

  return (
    <div className="image-position-detail min-w-[1080px] max-w-[1360px] mx-auto flex flex-col gap-4">
      <div className="image-position-header flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack}>
            一覧へ戻る
          </button>
          <h2 className="text-lg font-semibold">画像局面の編集</h2>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={copySfen}>
            SFENコピー
          </button>
          <button
            type="button"
            onClick={handleAddWorkspace}
            disabled={savingWorkspace}
            className="bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700"
          >
            {savingWorkspace ? '追加中...' : '下書き一覧に追加'}
          </button>
          <button type="button" onClick={() => navigate('/workspaces')}>
            下書き一覧へ
          </button>
        </div>
      </div>

      {message && (
        <div className="text-[12px] bg-emerald-50 border border-emerald-200 text-emerald-800 rounded px-3 py-2">
          {message}
        </div>
      )}

      <div className="grid grid-cols-[minmax(420px,1fr)_minmax(640px,760px)] gap-4 items-start">
        <section className="min-w-0 flex flex-col gap-3">
          <div className="border border-gray-200 rounded-lg bg-white/85 p-3">
            <div className="text-[12px] font-semibold text-gray-600 mb-2">元画像</div>
            <img
              src={item.imageDataUrl}
              alt={item.fileName}
              className="w-full max-h-[480px] object-contain bg-gray-100 rounded border border-gray-200"
            />
          </div>
          <div className="border border-gray-200 rounded-lg bg-white/85 p-3 flex flex-col gap-2">
            <div className="text-[12px] font-semibold text-gray-600">メモ</div>
            <textarea
              rows={4}
              value={item.memo}
              onChange={(e) => void patchItem(item.id, { memo: e.target.value })}
              placeholder="この画像についてのメモ"
            />
          </div>
        </section>

        <section className="min-w-0 flex flex-col gap-3">
          <div className="border border-gray-200 rounded-lg bg-white/85 p-3 overflow-x-auto">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-[12px] font-semibold text-gray-600">手番</div>
              <div className="grid w-[184px] grid-cols-2 gap-1">
                {([
                  ['sente', '先手'],
                  ['gote', '後手'],
                ] as const).map(([side, label]) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => updateSideToMove(side)}
                    className={displayParsed.sideToMove === side
                      ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <Board
              board={displayParsed.board}
              senteHand={displayParsed.senteHand}
              goteHand={displayParsed.goteHand}
              sideToMove={displayParsed.sideToMove}
              selectedCell={boardSelectedCell}
              selectedHandPiece={selectedHandPiece}
              showAllHandPieces
              onCellClick={handleCellClick}
              onCellDoubleClick={handleCellDoubleClick}
              onHandPieceClick={handleHandPieceClick}
            />
            {promotionChoice && (
              <div className="mt-3 flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-2 py-2">
                <span className="text-[12px] font-semibold text-amber-800">成?</span>
                <button
                  type="button"
                  className="min-w-12 bg-white border-gray-300 text-slate-800 hover:bg-amber-100"
                  onClick={() => handlePromotionSelect(false)}
                >
                  {PIECE_KANJI[promotionChoice.pieceType]}
                </button>
                <button
                  type="button"
                  className="min-w-12 bg-white border-gray-300 text-rose-700 hover:bg-amber-100"
                  onClick={() => handlePromotionSelect(true)}
                >
                  {PROMOTED_KANJI[promotionChoice.pieceType] ?? PIECE_KANJI[promotionChoice.pieceType]}
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <ImageMoveRegistrationCard
              title="イントロ"
              usi={item.introMoveUsi ?? ''}
              label={introMoveLabel}
              isActive={moveMode === 'intro'}
              activeText={introDestination ? '元のマス/持ち駒を選択' : '行き先を選択'}
              onActivate={() => activateMoveMode('intro')}
              onClear={clearIntroMove}
            />
            <ImageMoveRegistrationCard
              title="正解手"
              usi={item.correctMoveUsi ?? ''}
              label={correctMoveLabel}
              isActive={moveMode === 'correct'}
              activeText="盤面で手を選択"
              onActivate={() => activateMoveMode('correct')}
              onClear={clearCorrectMove}
            />
          </div>

          <div className="border border-gray-200 rounded-lg bg-white/85 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[12px] font-semibold text-gray-600">コマ箱</div>
              <div className="text-[12px] text-gray-500">{rulePieceBoxTotal}個</div>
            </div>
            {rulePieceBoxTotal === 0 ? (
              <div
                className="text-[12px] text-gray-500 bg-gray-50 border border-dashed border-gray-200 rounded px-2 py-2"
                onClick={handlePieceBoxReturnClick}
              >
                コマ箱はありません。
              </div>
            ) : (
              <div
                className="grid grid-cols-4 sm:grid-cols-8 gap-2"
                onClick={(e) => {
                  if (e.target === e.currentTarget) handlePieceBoxReturnClick();
                }}
              >
                {PIECE_TYPES.filter((type) => rulePieceBox[type] > 0).map((type) => (
                  <div
                    key={type}
                    role="button"
                    tabIndex={0}
                    onClick={() => handlePieceBoxClick(type)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handlePieceBoxClick(type);
                      }
                    }}
                    className={`min-h-[56px] select-none rounded border p-2 text-center cursor-pointer hover:bg-amber-100 ${selectedBoxType === type ? 'bg-amber-200 border-amber-500 ring-2 ring-amber-300' : 'bg-amber-50/80 border-amber-200'}`}
                  >
                    <div className="text-[24px] font-bold leading-none text-amber-950">
                      {PIECE_KANJI[type]}
                    </div>
                    <div className="mt-1 text-[12px] font-semibold text-amber-800">
                      x{rulePieceBox[type]}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {recognitionValidationIssues.length > 0 && (
            <div className="border border-gray-200 rounded-lg bg-white/85 p-3">
              <div className="text-[12px] font-semibold text-gray-600 mb-2">認識時の指摘</div>
              <div className="flex flex-col gap-1">
                {recognitionValidationIssues.map((issue, idx) => (
                  <div
                    key={`${issue.type}-${idx}`}
                    className="text-[12px] px-2 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200"
                  >
                    {issue.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border border-gray-200 rounded-lg bg-white/85 p-3 flex flex-col gap-2">
            <div className="text-[12px] font-semibold text-gray-600">SFEN</div>
            <div
              className="font-mono text-[12px] p-2 bg-gray-50 border border-gray-200 rounded break-all cursor-pointer hover:bg-gray-100"
              onClick={copySfen}
            >
              {currentSfen}
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg bg-white/85 p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[12px] font-semibold text-gray-600">チェック結果</span>
              <span className={hasBlockingPositionIssue(item.issues) ? 'text-[12px] text-red-700' : 'text-[12px] text-emerald-700'}>
                {issueSummary(item.issues)}
              </span>
            </div>
            {item.issues.length === 0 ? (
              <div className="text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                コマ数と簡易合法性に問題は見つかりませんでした。
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {item.issues.map((issue, idx) => (
                  <div
                    key={`${issue.message}-${idx}`}
                    className={`text-[12px] px-2 py-1 rounded ${issue.severity === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}
                  >
                    {issue.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

interface ImageMoveRegistrationCardProps {
  title: string;
  usi: string;
  label: string;
  isActive: boolean;
  activeText: string;
  onActivate: () => void;
  onClear: () => void;
}

const ImageMoveRegistrationCard: React.FC<ImageMoveRegistrationCardProps> = ({
  title,
  usi,
  label,
  isActive,
  activeText,
  onActivate,
  onClear,
}) => (
  <div
    className={`rounded-lg border-2 bg-white/85 p-3 transition-colors ${
      isActive ? 'border-blue-600 bg-blue-50' : usi ? 'border-emerald-300' : 'border-gray-200'
    }`}
  >
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="text-[12px] font-semibold text-gray-700">{title}</div>
      {usi && (
        <button
          type="button"
          className="border-red-200 px-2 py-1 text-[11px] text-red-600 hover:bg-red-50"
          onClick={onClear}
        >
          クリア
        </button>
      )}
    </div>
    {usi ? (
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[22px] font-bold leading-tight text-slate-800">
            {label || usi}
          </div>
          <div className="truncate font-mono text-[10px] text-gray-400">({usi})</div>
        </div>
        <button type="button" className="px-2 py-1 text-[11px]" onClick={onActivate}>
          選択
        </button>
      </div>
    ) : (
      <button
        type="button"
        className={isActive
          ? 'w-full bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
          : 'w-full'}
        onClick={onActivate}
      >
        {isActive ? activeText : '選択'}
      </button>
    )}
  </div>
);

export default ImagePositionCreator;
