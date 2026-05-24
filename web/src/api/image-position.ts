import type {
  RecognitionPieceBoxItem,
  RecognitionSquare,
  RecognitionValidationIssue,
} from '../lib/image-position-store';

export interface RecognizeShogiPositionResponse {
  sfen: string;
  confidence?: number;
  notes?: string[];
  model?: string;
  squares?: RecognitionSquare[];
  pieceBox?: RecognitionPieceBoxItem[];
  validationIssues?: RecognitionValidationIssue[];
  raw?: unknown;
}

export async function recognizeShogiPosition(
  imageDataUrl: string,
): Promise<RecognizeShogiPositionResponse> {
  const res = await fetch('/api/recognize-shogi-position', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageDataUrl }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error ?? '画像認識に失敗しました');
  }
  return data;
}
