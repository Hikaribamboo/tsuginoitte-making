import React, { useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Board from '../components/Board';
import type { ArrowInfo } from '../components/Board';
import ChoiceCard from '../components/ChoiceCard';
import TagSelector from '../components/TagSelector';
import AnalysisPanel from '../components/AnalysisPanel';
import type { BestMove } from '../components/AnalysisPanel';
import Toggle from '../components/Toggle';
import { useBoardStore } from '../hooks/useBoardStore';
import { parseSfen, toUsiSquare } from '../lib/sfen';
import { usiToLabel } from '../lib/usi-to-label';
import { cpToWinRatePercentFromRootSfen } from '../lib/eval-percent';
import { evaluatePosition } from '../api/engine';
import { saveProblem, getNextDisplayNo } from '../api/problems';
import {
  deleteFavorite,
  fetchProblemDraftForFavorite,
  saveProblemDraftForFavorite,
  clearProblemDraftForFavorite,
} from '../api/favorites';
import { DEFAULT_PROMPT } from '../lib/constants';
import { getValidDestinations, getValidDropSquares } from '../lib/legal-moves';
import type { ChoiceDraft } from '../types/problem';
import type { ProblemCreatorDraft } from '../lib/problem-draft';
import type { Board as BoardType, HandPieces, Side, HandPieceType, PieceType } from '../types/shogi';
import { CAN_PROMOTE, pieceKanji } from '../types/shogi';

type SlotKey = 'correct' | 'incorrect1' | 'incorrect2';
const WINRATE_SCALE = 800;
const CHOICE_EVAL_DEPTH = 18;
const SLOT_ORDER: SlotKey[] = ['correct', 'incorrect1', 'incorrect2'];
const AUTOSAVE_DEBOUNCE_MS = 3000;
const AUTOSYNC_INTERVAL_MS = 3000;

function draftSignature(draft: ProblemCreatorDraft): string {
  const { savedAt: _ignoredSavedAt, ...stablePart } = draft;
  return JSON.stringify(stablePart);
}

function pickString(local: string, remote: string): string {
  if (local.trim()) return local;
  return remote;
}

function pickNullableNumber(local: number | null, remote: number | null): number | null {
  if (local !== null) return local;
  return remote;
}

function pickArray<T>(local: T[], remote: T[]): T[] {
  if (local.length > 0) return local;
  return remote;
}

function mergeChoicePreferLocal(local: ChoiceDraft, remote: ChoiceDraft): ChoiceDraft {
  return {
    slotLabel: local.slotLabel,
    usi: pickString(local.usi, remote.usi),
    label: pickString(local.label, remote.label),
    explanation: pickString(local.explanation, remote.explanation),
    line: pickArray(local.line, remote.line),
    eval_cp: pickNullableNumber(local.eval_cp, remote.eval_cp),
    eval_percent: pickNullableNumber(local.eval_percent, remote.eval_percent),
  };
}

function mergeDraftPreferLocal(local: ProblemCreatorDraft, remote: ProblemCreatorDraft): ProblemCreatorDraft {
  return {
    version: 1,
    favoriteId: local.favoriteId,
    rootSfen: local.rootSfen,
    prompt: pickString(local.prompt, remote.prompt),
    tags: pickArray(local.tags, remote.tags),
    displayNo: pickNullableNumber(local.displayNo, remote.displayNo),
    introMoves: pickString(local.introMoves, remote.introMoves),
    problemRating: local.problemRating,
    rootEvalCp: pickNullableNumber(local.rootEvalCp, remote.rootEvalCp),
    rootEvalPercent: pickNullableNumber(local.rootEvalPercent, remote.rootEvalPercent),
    activeSlot: local.activeSlot ?? remote.activeSlot,
    choices: {
      correct: mergeChoicePreferLocal(local.choices.correct, remote.choices.correct),
      incorrect1: mergeChoicePreferLocal(local.choices.incorrect1, remote.choices.incorrect1),
      incorrect2: mergeChoicePreferLocal(local.choices.incorrect2, remote.choices.incorrect2),
    },
    savedAt: new Date().toISOString(),
  };
}

const EMPTY_CHOICE: ChoiceDraft = {
  slotLabel: '',
  usi: '',
  label: '',
  explanation: '',
  line: [],
  eval_cp: null,
  eval_percent: null,
};

const ProblemCreator: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as {
    favorite_id?: number;
    root_sfen?: string;
    name?: string;
    tags?: string[] | null;
    last_move?: string | null;
  } | null;

  const favoriteId = state?.favorite_id ?? null;
  const rootSfen = state?.root_sfen ?? '';
  const parsed = rootSfen ? parseSfen(rootSfen) : null;

  // Board store (used in analysis mode for interactive board)
  const store = useBoardStore();

  // Fixed board state for registration mode (always rootSfen position)
  const [board] = useState<BoardType>(parsed?.board ?? []);
  const [senteHand] = useState<HandPieces>(parsed?.senteHand ?? { R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 });
  const [goteHand] = useState<HandPieces>(parsed?.goteHand ?? { R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 });
  const [sideToMove] = useState<Side>(parsed?.sideToMove ?? 'sente');

  // Initialize store with rootSfen on mount
  React.useEffect(() => {
    if (rootSfen) store.loadFromSfen(rootSfen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move selection state
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [selectedHandPiece, setSelectedHandPiece] = useState<{ side: Side; type: HandPieceType } | null>(null);

  // Active slot for move registration (null = no slot active)
  const [activeSlot, setActiveSlot] = useState<SlotKey | null>(null);

  const [candidateMoves, setCandidateMoves] = useState<BestMove[]>([]);
  const [autoEvalTried, setAutoEvalTried] = useState<Record<SlotKey, string>>({
    correct: '',
    incorrect1: '',
    incorrect2: '',
  });

  const handleCandidateMoves = useCallback((moves: BestMove[]) => {
    setCandidateMoves(moves.slice(0, 3));
  }, []);

  const arrows: ArrowInfo[] = candidateMoves
    .slice(0, 3)
    .map((m, idx) => ({
      from: m.from,
      to: m.to,
      style: idx === 0 ? 'primary' : idx === 1 ? 'secondary' : 'tertiary',
      showNextLabel: idx === 1,
    }));

  // Choice drafts
  const [choices, setChoices] = useState<Record<SlotKey, ChoiceDraft>>({
    correct: { ...EMPTY_CHOICE, slotLabel: 'correct' },
    incorrect1: { ...EMPTY_CHOICE, slotLabel: 'incorrect1' },
    incorrect2: { ...EMPTY_CHOICE, slotLabel: 'incorrect2' },
  });

  // Form fields
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [tags, setTags] = useState<string[]>(state?.tags ?? []);
  const [displayNo, setDisplayNo] = useState<number | null>(null);
  const [introMoves, setIntroMoves] = useState(state?.last_move ?? '');
  const [problemRating, setProblemRating] = useState<number>(1200);
  const [rootEvalCp, setRootEvalCp] = useState<number | null>(null);
  const [rootEvalPercent, setRootEvalPercent] = useState<number | null>(null);

  // UI state
  const [evaluatingSlot, setEvaluatingSlot] = useState<SlotKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [analysisMode, setAnalysisMode] = useState(true);
  const [promotionChoice, setPromotionChoice] = useState<{
    fromSq: string;
    toSq: string;
    pieceType: PieceType;
  } | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const lastSyncedSignatureRef = React.useRef<string>('');
  const lastSyncedAtRef = React.useRef<string>('');

  const buildDraft = useCallback((): ProblemCreatorDraft => ({
    version: 1,
    favoriteId: favoriteId ?? 0,
    rootSfen,
    prompt,
    tags,
    displayNo,
    introMoves,
    problemRating,
    rootEvalCp,
    rootEvalPercent,
    activeSlot,
    choices,
    savedAt: new Date().toISOString(),
  }), [favoriteId, rootSfen, prompt, tags, displayNo, introMoves, problemRating, rootEvalCp, rootEvalPercent, activeSlot, choices]);

  const applyDraft = useCallback((draft: ProblemCreatorDraft) => {
    setPrompt(draft.prompt);
    setTags(draft.tags);
    setDisplayNo(draft.displayNo);
    setIntroMoves(draft.introMoves);
    setProblemRating(draft.problemRating);
    setRootEvalCp(draft.rootEvalCp);
    setRootEvalPercent(draft.rootEvalPercent);
    setActiveSlot(draft.activeSlot);
    setChoices(draft.choices);
  }, []);

  // Auto-fetch next display_no on mount
  React.useEffect(() => {
    getNextDisplayNo().then(setDisplayNo).catch(() => {});
  }, []);

  React.useEffect(() => {
    if (draftRestored) return;
    setDraftRestored(true);
    if (!favoriteId || !rootSfen) return;

    void (async () => {
      try {
        const snapshot = await fetchProblemDraftForFavorite(favoriteId);
        if (!snapshot) {
          const initialSignature = draftSignature(buildDraft());
          lastSyncedSignatureRef.current = initialSignature;
          lastSyncedAtRef.current = '';
          return;
        }

        const draft = snapshot.draft;
        if (draft.favoriteId !== favoriteId) return;
        if (draft.rootSfen !== rootSfen) return;

        applyDraft(draft);
        lastSyncedSignatureRef.current = draftSignature(draft);
        lastSyncedAtRef.current = snapshot.updatedAt;
        setMessage('途中保存データを読み込みました');
      } catch {
        // Continue without draft if retrieval fails.
      }
    })();
  }, [favoriteId, rootSfen, draftRestored, applyDraft, buildDraft]);

  React.useEffect(() => {
    if (!favoriteId || !rootSfen || !draftRestored) return;
    const draft = buildDraft();
    const nextSignature = draftSignature(draft);
    if (nextSignature === lastSyncedSignatureRef.current) return;

    const timerId = window.setTimeout(() => {
      void (async () => {
        try {
          setAutosaveState('saving');
          let draftToSave = draft;
          const snapshot = await fetchProblemDraftForFavorite(favoriteId);
          if (snapshot) {
            const remoteDraft = snapshot.draft;
            if (remoteDraft.favoriteId === favoriteId && remoteDraft.rootSfen === rootSfen) {
              draftToSave = mergeDraftPreferLocal(draft, remoteDraft);
            }
          }

          await saveProblemDraftForFavorite(favoriteId, draftToSave);
          applyDraft(draftToSave);
          lastSyncedSignatureRef.current = draftSignature(draftToSave);
          lastSyncedAtRef.current = draftToSave.savedAt;
          setAutosaveState('saved');
        } catch {
          setAutosaveState('error');
        }
      })();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [favoriteId, rootSfen, draftRestored, buildDraft, applyDraft]);

  React.useEffect(() => {
    if (!favoriteId || !rootSfen || !draftRestored) return;

    const intervalId = window.setInterval(() => {
      void (async () => {
        const localDraft = buildDraft();
        const localSignature = draftSignature(localDraft);
        const localIsDirty = localSignature !== lastSyncedSignatureRef.current;

        try {
          const snapshot = await fetchProblemDraftForFavorite(favoriteId);
          if (!snapshot) return;
          if (!snapshot.updatedAt || snapshot.updatedAt <= lastSyncedAtRef.current) return;

          const remoteDraft = snapshot.draft;
          if (remoteDraft.favoriteId !== favoriteId || remoteDraft.rootSfen !== rootSfen) return;

          if (localIsDirty) {
            const mergedDraft = mergeDraftPreferLocal(localDraft, remoteDraft);
            await saveProblemDraftForFavorite(favoriteId, mergedDraft);
            applyDraft(mergedDraft);
            lastSyncedSignatureRef.current = draftSignature(mergedDraft);
            lastSyncedAtRef.current = mergedDraft.savedAt;
            setAutosaveState('saved');
            setMessage('途中保存データを同期してマージしました');
            return;
          }

          const remoteSignature = draftSignature(remoteDraft);
          if (remoteSignature === lastSyncedSignatureRef.current) {
            lastSyncedAtRef.current = snapshot.updatedAt;
            return;
          }

          applyDraft(remoteDraft);
          lastSyncedSignatureRef.current = remoteSignature;
          lastSyncedAtRef.current = snapshot.updatedAt;
          setMessage('途中保存データを同期しました');
        } catch {
          // ignore periodic sync failures
        }
      })();
    }, AUTOSYNC_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [favoriteId, rootSfen, draftRestored, applyDraft, buildDraft]);

  // ---- Move handling ----

  const registerMove = useCallback(
    (usi: string) => {
      if (!activeSlot) return; // No slot active, ignore
      const label = usiToLabel(usi, board, sideToMove);
      setChoices((prev) => ({
        ...prev,
        [activeSlot]: {
          ...prev[activeSlot],
          usi,
          label,
          eval_cp: null,
          eval_percent: null,
          line: [],
        },
      }));
      setSelectedCell(null);
      setSelectedHandPiece(null);
      // Stay on current slot (no auto-advance)
    },
    [activeSlot, board, sideToMove],
  );

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (promotionChoice) return;

      if (analysisMode) {
        // --- Analysis mode: move pieces on the store board ---
        const storeBoard = store.board;
        const storeSide = store.sideToMove;

        if (selectedHandPiece) {
          const validDrops = getValidDropSquares(storeBoard, storeSide, selectedHandPiece.type);
          if (!validDrops.some(s => s.row === row && s.col === col)) {
            const piece = storeBoard[row][col];
            if (piece && piece.side === storeSide) {
              setSelectedHandPiece(null);
              setSelectedCell({ row, col });
            }
            return;
          }
          const usi = `${selectedHandPiece.type}*${toUsiSquare(row, col)}`;
          store.applyMove(usi);
          setSelectedHandPiece(null);
          setSelectedCell(null);
          return;
        }

        if (!selectedCell) {
          const piece = storeBoard[row][col];
          if (piece && piece.side === storeSide) setSelectedCell({ row, col });
          return;
        }
        if (selectedCell.row === row && selectedCell.col === col) { setSelectedCell(null); return; }
        const targetPiece = storeBoard[row][col];
        if (targetPiece && targetPiece.side === storeSide) { setSelectedCell({ row, col }); return; }

        const validMoves = getValidDestinations(storeBoard, selectedCell.row, selectedCell.col, storeSide);
        if (!validMoves.some(s => s.row === row && s.col === col)) return;

        const fromSq = toUsiSquare(selectedCell.row, selectedCell.col);
        const toSq = toUsiSquare(row, col);
        const piece = storeBoard[selectedCell.row][selectedCell.col];
        setSelectedCell(null);

        if (piece && !piece.promoted && CAN_PROMOTE[piece.type]) {
          const inPromotionZone =
            (storeSide === 'sente' && (row <= 2 || selectedCell.row <= 2)) ||
            (storeSide === 'gote' && (row >= 6 || selectedCell.row >= 6));
          if (inPromotionZone) {
            const mustPromote =
              (piece.type === 'P' && ((storeSide === 'sente' && row === 0) || (storeSide === 'gote' && row === 8))) ||
              (piece.type === 'L' && ((storeSide === 'sente' && row === 0) || (storeSide === 'gote' && row === 8))) ||
              (piece.type === 'N' && ((storeSide === 'sente' && row <= 1) || (storeSide === 'gote' && row >= 7)));
            if (mustPromote) { store.applyMove(`${fromSq}${toSq}+`); }
            else { setPromotionChoice({ fromSq, toSq, pieceType: piece.type }); }
            return;
          }
        }
        store.applyMove(`${fromSq}${toSq}`);
        return;
      }

      // --- Registration mode: select a move to register as a choice ---
      if (selectedHandPiece) {
        const validDrops = getValidDropSquares(board, sideToMove, selectedHandPiece.type);
        if (!validDrops.some(s => s.row === row && s.col === col)) {
          const piece = board[row][col];
          if (piece && piece.side === sideToMove) {
            setSelectedHandPiece(null);
            setSelectedCell({ row, col });
          }
          return;
        }
        const usi = `${selectedHandPiece.type}*${toUsiSquare(row, col)}`;
        registerMove(usi);
        return;
      }

      if (!selectedCell) {
        if (board[row][col] && board[row][col]!.side === sideToMove) setSelectedCell({ row, col });
        return;
      }
      if (selectedCell.row === row && selectedCell.col === col) { setSelectedCell(null); return; }
      const targetPiece = board[row][col];
      if (targetPiece && targetPiece.side === sideToMove) { setSelectedCell({ row, col }); return; }

      const validMoves = getValidDestinations(board, selectedCell.row, selectedCell.col, sideToMove);
      if (!validMoves.some(s => s.row === row && s.col === col)) return;

      const fromSq = toUsiSquare(selectedCell.row, selectedCell.col);
      const toSq = toUsiSquare(row, col);
      const piece = board[selectedCell.row][selectedCell.col];

      if (piece && !piece.promoted && CAN_PROMOTE[piece.type]) {
        const inPromotionZone =
          (sideToMove === 'sente' && (row <= 2 || selectedCell.row <= 2)) ||
          (sideToMove === 'gote' && (row >= 6 || selectedCell.row >= 6));
        if (inPromotionZone) {
          const mustPromote =
            (piece.type === 'P' && ((sideToMove === 'sente' && row === 0) || (sideToMove === 'gote' && row === 8))) ||
            (piece.type === 'L' && ((sideToMove === 'sente' && row === 0) || (sideToMove === 'gote' && row === 8))) ||
            (piece.type === 'N' && ((sideToMove === 'sente' && row <= 1) || (sideToMove === 'gote' && row >= 7)));
          if (mustPromote) { registerMove(`${fromSq}${toSq}+`); }
          else { setPromotionChoice({ fromSq, toSq, pieceType: piece.type }); }
          return;
        }
      }
      registerMove(`${fromSq}${toSq}`);
    },
    [analysisMode, store, board, sideToMove, selectedCell, selectedHandPiece, registerMove, promotionChoice],
  );

  const handlePromotionSelect = useCallback(
    (promote: boolean) => {
      if (!promotionChoice) return;
      const usi = `${promotionChoice.fromSq}${promotionChoice.toSq}${promote ? '+' : ''}`;
      if (analysisMode) { store.applyMove(usi); }
      else { registerMove(usi); }
      setPromotionChoice(null);
    },
    [promotionChoice, analysisMode, store, registerMove],
  );

  const handleHandPieceClick = useCallback(
    (side: Side, type: HandPieceType) => {
      const currentSide = analysisMode ? store.sideToMove : sideToMove;
      if (side !== currentSide) return;
      setSelectedCell(null);
      setSelectedHandPiece((prev) =>
        prev?.side === side && prev?.type === type ? null : { side, type },
      );
    },
    [analysisMode, store, sideToMove],
  );

  // ---- Evaluation ----

  const handleEvaluateChoice = useCallback(async (slot: SlotKey, silent = false) => {
    if (!rootSfen) return;
    const choice = choices[slot];
    if (!choice.usi) return;

    setEvaluatingSlot(slot);
    setMessage('');

    try {
      const result = await evaluatePosition(rootSfen, [choice.usi], CHOICE_EVAL_DEPTH);

      // Keep cp as raw engine output.
      const rawCp = result.eval_cp;

      // Win-rate conversion handles perspective internally from root side-to-move.
      const choicePct = cpToWinRatePercentFromRootSfen({
        cp: rawCp,
        rootSfen,
        scale: WINRATE_SCALE,
      });

      setChoices((prev) => {
        const updated = {
          ...prev,
          [slot]: {
            ...prev[slot],
            eval_cp: rawCp,
            eval_percent: choicePct,
            line: result.pv.slice(0, Math.min(result.pv.length, 14)),
          },
        };

        if (slot === 'correct') {
          setRootEvalCp(rawCp);
          setRootEvalPercent(choicePct);
        }

        return updated;
      });

      if (!silent && slot === 'correct') {
        setMessage('正解手とrootの評価値を計算しました');
      } else if (!silent) {
        setMessage('候補手の評価値を計算しました');
      }
    } catch (e: any) {
      if (!silent) {
        setMessage(`評価エラー: ${e.message}`);
      }
    } finally {
      setEvaluatingSlot(null);
    }
  }, [choices, rootSfen]);

  React.useEffect(() => {
    if (!rootSfen || evaluatingSlot) return;
    const nextSlot = SLOT_ORDER.find((slot) => {
      const usi = choices[slot].usi;
      return Boolean(usi) && choices[slot].eval_cp === null && autoEvalTried[slot] !== usi;
    });
    if (!nextSlot) return;

    const usi = choices[nextSlot].usi;
    if (!usi) return;
    setAutoEvalTried((prev) => ({ ...prev, [nextSlot]: usi }));
    void handleEvaluateChoice(nextSlot, true);
  }, [choices, autoEvalTried, evaluatingSlot, rootSfen, handleEvaluateChoice]);

  React.useEffect(() => {
    setRootEvalCp(choices.correct.eval_cp);
    setRootEvalPercent(choices.correct.eval_percent);
  }, [choices.correct.eval_cp, choices.correct.eval_percent]);

  // ---- Validation ----

  const validate = (): string[] => {
    const errors: string[] = [];
    if (!favoriteId) errors.push('お気に入り一覧から問題作成を開始してください');
    if (!rootSfen) errors.push('局面（root_sfen）が未設定です');
    if (!choices.correct.usi) errors.push('正解手が未設定です');
    if (!choices.incorrect1.usi) errors.push('不正解手１が未設定です');
    if (!choices.incorrect2.usi) errors.push('不正解手２が未設定です');

    const usis = [choices.correct.usi, choices.incorrect1.usi, choices.incorrect2.usi].filter(Boolean);
    if (new Set(usis).size !== usis.length) errors.push('候補手が重複しています');

    return errors;
  };

  const warnings = (): string[] => {
    const w: string[] = [];
    if (choices.correct.usi && !choices.correct.explanation) w.push('正解手の解説が未入力です');
    if (choices.incorrect1.usi && !choices.incorrect1.explanation) w.push('不正解手１の解説が未入力です');
    if (choices.incorrect2.usi && !choices.incorrect2.explanation) w.push('不正解手２の解説が未入力です');
    return w;
  };

  const handleSaveDraft = async () => {
    if (!favoriteId) {
      setMessage('お気に入り一覧から開始した局面のみ途中保存できます');
      return;
    }

    const draft: ProblemCreatorDraft = {
      version: 1,
      favoriteId,
      rootSfen,
      prompt,
      tags,
      displayNo,
      introMoves,
      problemRating,
      rootEvalCp,
      rootEvalPercent,
      activeSlot,
      choices,
      savedAt: new Date().toISOString(),
    };

    try {
      await saveProblemDraftForFavorite(favoriteId, draft);
      lastSyncedSignatureRef.current = draftSignature(draft);
      lastSyncedAtRef.current = draft.savedAt;
      setMessage('途中保存しました（DB）');
    } catch (e: any) {
      setMessage(`途中保存エラー: ${e.message}`);
    }
  };

  // ---- Save ----

  const handleSave = async () => {
    const errors = validate();
    if (errors.length > 0) {
      setMessage(errors.join('\n'));
      return;
    }

    const warns = warnings();
    if (warns.length > 0) {
      if (!window.confirm(`以下の警告があります:\n${warns.join('\n')}\n\n保存しますか？`)) return;
    }

    setSaving(true);
    setMessage('');

    try {
      // Assign choice_ids: correct=1, incorrect1=2, incorrect2=3
      // Actually the correct_choice_id should match the choice_id of the correct choice
      // Let's say correct gets choice_id based on slot order but correct_choice_id points to it
      const correctChoiceId = 1;

      const introMovesUsi = introMoves.trim()
        ? introMoves.trim().split(/\s+/)
        : [];

      const problem = {
        prompt: prompt.trim() || DEFAULT_PROMPT,
        root_sfen: rootSfen,
        correct_choice_id: correctChoiceId,
        intro_moves_usi: introMovesUsi,
        source_run_id: null,
        root_eval_cp: rootEvalCp,
        root_eval_percent: rootEvalPercent,
        problem_rating: problemRating,
        problem_rating_games: 0,
        display_no: displayNo,
        tags: tags.length > 0 ? tags : null,
      };

      const choiceData = [
        { choice_id: 1, ...pickChoiceFields(choices.correct) },
        { choice_id: 2, ...pickChoiceFields(choices.incorrect1) },
        { choice_id: 3, ...pickChoiceFields(choices.incorrect2) },
      ];

      const { problemId } = await saveProblem(problem, choiceData);

      if (favoriteId) {
        await clearProblemDraftForFavorite(favoriteId);
        lastSyncedSignatureRef.current = '';
        lastSyncedAtRef.current = '';
      }

      if (!favoriteId) {
        setMessage(`保存しました (problem_id: ${problemId})`);
        return;
      }

      const shouldDeleteFavorite = window.confirm('問題を保存しました。お気に入りから削除しますか？');
      if (!shouldDeleteFavorite) {
        setMessage(`保存しました (problem_id: ${problemId})\nお気に入りは削除していません`);
        return;
      }

      try {
        await deleteFavorite(favoriteId);
        setMessage(`保存しました (problem_id: ${problemId})\nお気に入りから削除しました`);
        navigate('/favorites');
      } catch (deleteError: any) {
        setMessage(`保存しました (problem_id: ${problemId})\nお気に入り削除エラー: ${deleteError.message}`);
      }
    } catch (e: any) {
      setMessage(`保存エラー: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClearSlot = (slot: SlotKey) => {
    setChoices((prev) => ({
      ...prev,
      [slot]: { ...EMPTY_CHOICE, slotLabel: slot },
    }));
    setAutoEvalTried((prev) => ({ ...prev, [slot]: '' }));
  };

  const handleExplanationChange = (slot: SlotKey, text: string) => {
    setChoices((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], explanation: text },
    }));
  };

  const handleEvalCpChange = (slot: SlotKey, value: number | null) => {
    setChoices((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], eval_cp: value },
    }));
  };

  const handleEvalPercentChange = (slot: SlotKey, value: number | null) => {
    setChoices((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], eval_percent: value },
    }));
  };

  if (!rootSfen) {
    return (
      <div className="w-full h-[calc(100vh-84px)] overflow-hidden">
        <div className="bg-red-50 border border-red-300 text-red-700 p-3 rounded mb-3">
          局面が選択されていません。お気に入り一覧から問題作成を選んでください。
        </div>
        <button onClick={() => navigate('/favorites')}>お気に入り一覧へ</button>
      </div>
    );
  }

  return (
    <>
    <div className="w-full h-[calc(100vh-84px)] overflow-hidden">
      <h2 className="text-lg font-semibold mb-2">問題作成</h2>

      <div className="flex w-full h-[calc(100%-26px)] min-w-0 gap-3 items-start justify-start overflow-hidden">
        <div className="flex-shrink-0">
          <Board
            board={analysisMode ? store.board : board}
            senteHand={analysisMode ? store.senteHand : senteHand}
            goteHand={analysisMode ? store.goteHand : goteHand}
            sideToMove={analysisMode ? store.sideToMove : sideToMove}
            selectedCell={selectedCell}
            arrows={arrows}
            onCellClick={handleCellClick}
            onHandPieceClick={handleHandPieceClick}
          />
          <div className="flex gap-3 mt-1.5 text-[13px] text-gray-500 flex-wrap items-center">
            <span>手番: {(analysisMode ? store.sideToMove : sideToMove) === 'sente' ? '☗先手' : '☖後手'}</span>
            {favoriteId && (
              <span>
                自動保存: {autosaveState === 'saving' ? '保存中...' : autosaveState === 'saved' ? '保存済み' : autosaveState === 'error' ? '失敗' : '待機中'}
              </span>
            )}
            {selectedHandPiece && (
              <span className="text-blue-600 font-semibold">打: {selectedHandPiece.type}</span>
            )}
            {rootEvalCp !== null && (
              <span>root評価値: {rootEvalCp}cp ({rootEvalPercent}%)</span>
            )}
            {analysisMode && store.moveHistory.length > 0 && (
              <button
                className="text-xs px-2 py-0.5"
                onClick={() => { store.loadFromSfen(rootSfen); setSelectedCell(null); setSelectedHandPiece(null); }}
              >
                ↩ rootに戻す
              </button>
            )}
          </div>
          {promotionChoice && (
            <div className="flex items-center gap-2.5 px-3 py-2 bg-amber-50 border-2 border-amber-400 rounded-md text-[13px] font-semibold">
              <span>成りますか？</span>
              <button
                className="w-12 h-12 text-2xl font-bold flex items-center justify-center border-2 border-gray-300 rounded bg-white cursor-pointer hover:border-blue-600 hover:bg-blue-100"
                onClick={() => handlePromotionSelect(false)}
              >
                {pieceKanji({ type: promotionChoice.pieceType, side: analysisMode ? store.sideToMove : sideToMove, promoted: false })}
              </button>
              <button
                className="w-12 h-12 text-2xl font-bold flex items-center justify-center border-2 border-gray-300 rounded bg-white cursor-pointer hover:border-blue-600 hover:bg-blue-100 text-red-700"
                onClick={() => handlePromotionSelect(true)}
              >
                {pieceKanji({ type: promotionChoice.pieceType, side: analysisMode ? store.sideToMove : sideToMove, promoted: true })}
              </button>
            </div>
          )}

          <AnalysisPanel
            sfen={analysisMode ? store.getSfen() : rootSfen}
            onCandidateMoves={handleCandidateMoves}
            headerExtra={
              <Toggle
                checked={analysisMode}
                label="検討モード"
                onChange={(v) => {
                  setAnalysisMode(v);
                  setSelectedCell(null);
                  setSelectedHandPiece(null);
                  if (v) {
                    setActiveSlot(null);
                  } else {
                    store.loadFromSfen(rootSfen);
                  }
                }}
              />
            }
          />
        </div>

        <div className="flex-1 grid grid-cols-[272px_minmax(320px,420px)] gap-3 items-start min-w-0 max-w-full">
          <div className="flex flex-col gap-1.5 items-start w-[272px]">
            {(['correct', 'incorrect1', 'incorrect2'] as SlotKey[]).map((slot) => (
              <ChoiceCard
                key={slot}
                slot={slot}
                draft={choices[slot]}
                isActive={activeSlot === slot}
                onActivate={() => {
                  const nextSlot = activeSlot === slot ? null : slot;
                  setActiveSlot(nextSlot);
                  if (nextSlot !== null) {
                    setAnalysisMode(false);
                    store.loadFromSfen(rootSfen);
                  }
                  setSelectedCell(null);
                  setSelectedHandPiece(null);
                }}
                onEvaluate={() => handleEvaluateChoice(slot)}
                evalLoading={evaluatingSlot === slot}
                onEvalCpChange={(value) => handleEvalCpChange(slot, value)}
                onEvalPercentChange={(value) => handleEvalPercentChange(slot, value)}
                onExplanationChange={(text) => handleExplanationChange(slot, text)}
                onClear={() => handleClearSlot(slot)}
              />
            ))}
          </div>

          <div className="min-w-[320px] max-w-[420px] flex flex-col gap-1.5">
            <div className="flex flex-col gap-0.5">
              <label className="text-xs font-semibold text-gray-500">問題文 (prompt)</label>
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="h-8"
              />
            </div>

            <div className="flex flex-col gap-0.5">
              <label className="text-xs font-semibold text-gray-500">display_no</label>
              <input
                type="number"
                value={displayNo ?? ''}
                onChange={(e) => setDisplayNo(e.target.value ? parseInt(e.target.value, 10) : null)}
                className="h-8"
              />
            </div>

            <div className="flex flex-col gap-0.5">
              <label className="text-xs font-semibold text-gray-500">問題レート</label>
              <select
                value={problemRating}
                onChange={(e) => setProblemRating(parseInt(e.target.value, 10))}
                className="h-8"
              >
                {Array.from({ length: 19 }, (_, i) => 600 + i * 100).map((rating) => (
                  <option key={rating} value={rating}>{rating}</option>
                ))}
              </select>
            </div>

            <TagSelector selected={tags} onChange={setTags} />

            <div className="flex gap-2 mt-1">
              <button
                onClick={handleSaveDraft}
                type="button"
              >
                途中保存
              </button>
              <button
                onClick={() => setShowPreview(true)}
                type="button"
              >
                プレビュー
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
              >
                {saving ? '保存中...' : 'Supabaseに保存'}
              </button>
            </div>
          </div>

          {message && (
            <div className={`px-3 py-2 rounded text-[13px] whitespace-pre-wrap ${message.includes('エラー') ? 'bg-red-50 border border-red-300 text-red-700' : 'bg-emerald-50 border border-emerald-300 text-emerald-800'}`}>
              {message}
            </div>
          )}
        </div>
      </div>
    </div>

    {showPreview && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={() => setShowPreview(false)}
      >
        <div
          className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-[700px] max-h-[80vh] flex flex-col mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold">保存プレビュー</h3>
            <button
              type="button"
              className="text-gray-400 hover:text-gray-600 border-0 bg-transparent text-xl leading-none px-2 py-0.5"
              onClick={() => setShowPreview(false)}
            >
              ✕
            </button>
          </div>
          <pre className="font-mono text-[11px] bg-gray-50 p-3 rounded overflow-auto flex-1 mb-4">
            {JSON.stringify(
              {
                problem: {
                  prompt,
                  root_sfen: rootSfen,
                  correct_choice_id: 1,
                  intro_moves_usi: introMoves.trim() ? introMoves.trim().split(/\s+/) : [],
                  root_eval_cp: rootEvalCp,
                  root_eval_percent: rootEvalPercent,
                  problem_rating: problemRating,
                  problem_rating_games: 0,
                  display_no: displayNo,
                  tags,
                },
                choices: [
                  { choice_id: 1, ...pickChoiceFields(choices.correct) },
                  { choice_id: 2, ...pickChoiceFields(choices.incorrect1) },
                  { choice_id: 3, ...pickChoiceFields(choices.incorrect2) },
                ],
              },
              null,
              2,
            )}
          </pre>
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <button type="button" onClick={() => setShowPreview(false)}>閉じる</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-blue-600 text-white border-blue-600 hover:bg-blue-700 px-4"
            >
              {saving ? '保存中...' : 'Supabaseに保存'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

// Helper to extract fields for saving
function pickChoiceFields(draft: ChoiceDraft) {
  return {
    usi: draft.usi,
    label: draft.label,
    explanation: draft.explanation,
    line: draft.line,
    eval_cp: draft.eval_cp,
    eval_percent: draft.eval_percent,
  };
}

export default ProblemCreator;
