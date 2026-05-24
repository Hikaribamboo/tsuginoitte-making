import type { PositionIssue } from './position-validation';

export type ImagePositionStatus = 'idle' | 'recognizing' | 'ready' | 'error';

export type RecognitionSquareStatus = 'confirmed' | 'uncertain' | 'moved_to_box' | 'empty';

export interface RecognitionSquareCandidate {
  piece: string;
  confidence: number;
}

export interface RecognitionSquare {
  file: number;
  rank: number;
  piece: string;
  confidence: number;
  topCandidates: RecognitionSquareCandidate[];
  status: RecognitionSquareStatus;
}

export interface RecognitionPieceBoxItem {
  id: string;
  piece: string;
  reason: string;
  source: {
    type: string;
    file: number;
    rank: number;
  };
  confidence: number;
  topCandidates: RecognitionSquareCandidate[];
}

export interface RecognitionValidationIssue {
  type: string;
  message: string;
  file?: number;
  rank?: number;
  piece?: string;
}

export interface ImagePositionItem {
  id: string;
  fileName: string;
  imageDataUrl: string;
  memo: string;
  sfen: string | null;
  introMoveUsi?: string;
  correctMoveUsi?: string;
  correctMoveLabel?: string;
  status: ImagePositionStatus;
  issues: PositionIssue[];
  recognitionNotes: string[];
  recognitionSquares?: RecognitionSquare[];
  recognitionPieceBox?: RecognitionPieceBoxItem[];
  recognitionValidationIssues?: RecognitionValidationIssue[];
  recognitionModel?: string;
  recognitionConfidence?: number;
  createdAt: string;
  updatedAt: string;
  recognizedAt?: string;
}

const DB_NAME = 'tsuginoitte-image-positions';
const DB_VERSION = 1;
const STORE_NAME = 'items';

function openImagePositionDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function listImagePositionItems(): Promise<ImagePositionItem[]> {
  const db = await openImagePositionDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const items = await requestToPromise<ImagePositionItem[]>(
      tx.objectStore(STORE_NAME).getAll(),
    );
    return items.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  } finally {
    db.close();
  }
}

export async function putImagePositionItem(item: ImagePositionItem): Promise<void> {
  const db = await openImagePositionDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await requestToPromise(tx.objectStore(STORE_NAME).put(item));
  } finally {
    db.close();
  }
}

export async function deleteImagePositionItem(id: string): Promise<void> {
  const db = await openImagePositionDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await requestToPromise(tx.objectStore(STORE_NAME).delete(id));
  } finally {
    db.close();
  }
}
