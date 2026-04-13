import React, { useState, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Board from '../components/Board';
import PasteChoiceCard from '../components/PasteChoiceCard';
import ReadingLineModal from '../components/ReadingLineModal';
import TagSelector from '../components/TagSelector';
import BranchTree from '../components/BranchTree';
import { INITIAL_SFEN, parseSfen, applyUsiMove, boardToSfen, toUsiSquare } from '../lib/sfen';
import { usiToLabel, pvToJapanese } from '../lib/usi-to-label';
import { cpToWinRatePercentFromRootSfen } from '../lib/eval-percent';
import { parseKifRecord, parseReadingLine, parseKifRecordWithBranches } from '../lib/kif-parser';
import type { KifBranch, KifTreeNode } from '../lib/kif-parser';
import { saveProblem, getNextDisplayNo } from '../api/problems';
import { getWorkspace, saveWorkspaceDraft, deleteWorkspace } from '../api/workspaces';
import { generateExplanations } from '../api/engine';
import { DEFAULT_PROMPT } from '../lib/constants';
import { getValidDestinations, getValidDropSquares } from '../lib/legal-moves';
import type { ChoiceDraft } from '../types/problem';
import type { Side, HandPieceType, PieceType } from '../types/shogi';
import { CAN_PROMOTE, pieceKanji } from '../types/shogi';

type SlotKey = 'correct' | 'incorrect1' | 'incorrect2';
const WINRATE_SCALE = 800;
const BOARD_SCALE = 0.72;
const AUTOSAVE_INTERVAL_MS = 10_000;
const LOCALSTORAGE_KEY = 'paste-problem-draft';

const EMPTY_CHOICE: ChoiceDraft = {
  slotLabel: '',
  usi: '',
  label: '',
  explanation: '',
  line: [],
  eval_cp: null,
  eval_percent: null,
};

interface PasteDraft {
  kifText: string;
  rootSfen: string;
  kifMoves: string[];
  choices: Record<SlotKey, ChoiceDraft>;
  readingLineInputs: Record<SlotKey, string>;
  prompt: string;
  tags: string[];
  displayNo: number | null;
  problemRating: number;
  rootEvalCp: number | null;
  rootEvalPercent: number | null;
  savedAt: string;
}

function loadDraft(): PasteDraft | null {
  try {
    const raw = localStorage.getItem(LOCALSTORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PasteDraft;
  } catch {
    return null;
  }
}

function persistDraft(draft: PasteDraft) {
  try {
    localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(draft));
  } catch { /* ignore quota errors */ }
}

const PasteProblemCreator: React.FC = () => {
  // ---- Workspace (DB-backed draft) ----
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const workspaceId = searchParams.get('workspace');

  // ---- Restore draft from localStorage (fallback when no workspace) ----
  const saved = useMemo(() => (workspaceId ? null : loadDraft()), [workspaceId]);

  // ---- KIF state ----
  const [kifText, setKifText] = useState(saved?.kifText ?? '');
  const [kifError, setKifError] = useState('');
  const [rootSfen, setRootSfen] = useState(saved?.rootSfen ?? '');
  const [kifMoves, setKifMoves] = useState<string[]>(saved?.kifMoves ?? []);

  // ---- Branch state ----
  const [kifBranches, setKifBranches] = useState<KifBranch[]>([]);
  const [kifTree, setKifTree] = useState<KifTreeNode[]>([]);
  const [activeBranchId, setActiveBranchId] = useState(0);

  // ---- Workspace name (for display) ----
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [dbSaving, setDbSaving] = useState(false);
  const [showDeleteWsModal, setShowDeleteWsModal] = useState(false);
  const [savedProblemId, setSavedProblemId] = useState<number | null>(null);

  const parsed = useMemo(() => (rootSfen ? parseSfen(rootSfen) : null), [rootSfen]);

  // ---- Choice drafts ----
  const [choices, setChoices] = useState<Record<SlotKey, ChoiceDraft>>(
    saved?.choices ?? {
      correct: { ...EMPTY_CHOICE, slotLabel: 'correct' },
      incorrect1: { ...EMPTY_CHOICE, slotLabel: 'incorrect1' },
      incorrect2: { ...EMPTY_CHOICE, slotLabel: 'incorrect2' },
    },
  );

  // Reading-line inputs / errors per card
  const [readingLineInputs, setReadingLineInputs] = useState<Record<SlotKey, string>>(
    saved?.readingLineInputs ?? { correct: '', incorrect1: '', incorrect2: '' },
  );
  const [readingLineErrors, setReadingLineErrors] = useState<Record<SlotKey, string>>({
    correct: '',
    incorrect1: '',
    incorrect2: '',
  });

  // ---- Form fields ----
  const [prompt, setPrompt] = useState(saved?.prompt ?? DEFAULT_PROMPT);
  const [tags, setTags] = useState<string[]>(saved?.tags ?? []);
  const [displayNo, setDisplayNo] = useState<number | null>(saved?.displayNo ?? null);
  const [problemRating, setProblemRating] = useState<number>(saved?.problemRating ?? 1200);
  const [rootEvalCp, setRootEvalCp] = useState<number | null>(saved?.rootEvalCp ?? null);
  const [rootEvalPercent, setRootEvalPercent] = useState<number | null>(saved?.rootEvalPercent ?? null);

  // ---- UI state ----
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState(saved ? '途中保存データを復元しました' : '');
  const [showPreview, setShowPreview] = useState(false);
  const [replaySlot, setReplaySlot] = useState<SlotKey | null>(null);
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saved'>('idle');

  // ---- Board interaction state ----
  const [activeSlot, setActiveSlot] = useState<SlotKey | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [selectedHandPiece, setSelectedHandPiece] = useState<{ side: Side; type: HandPieceType } | null>(null);
  const [promotionChoice, setPromotionChoice] = useState<{
    fromSq: string;
    toSq: string;
    pieceType: PieceType;
  } | null>(null);

  // ---- Build draft snapshot ----
  const buildDraft = useCallback((): PasteDraft => ({
    kifText,
    rootSfen,
    kifMoves,
    choices,
    readingLineInputs,
    prompt,
    tags,
    displayNo,
    problemRating,
    rootEvalCp,
    rootEvalPercent,
    savedAt: new Date().toISOString(),
  }), [kifText, rootSfen, kifMoves, choices, readingLineInputs, prompt, tags, displayNo, problemRating, rootEvalCp, rootEvalPercent]);

  // ---- Auto-save every 10s ----
  const lastSavedRef = React.useRef<string>('');
  React.useEffect(() => {
    const id = window.setInterval(() => {
      const draft = buildDraft();
      const sig = JSON.stringify({ ...draft, savedAt: '' });
      if (sig === lastSavedRef.current) return;
      persistDraft(draft);
      lastSavedRef.current = sig;
      setAutosaveState('saved');
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [buildDraft]);

  // Manual save
  const handleSaveDraft = useCallback(() => {
    const draft = buildDraft();
    persistDraft(draft);
    lastSavedRef.current = JSON.stringify({ ...draft, savedAt: '' });
    setMessage('途中保存しました');
    setAutosaveState('saved');
  }, [buildDraft]);

  // Auto-fetch next display_no on mount (only if draft didn't have one)
  React.useEffect(() => {
    if (saved?.displayNo != null) return;
    getNextDisplayNo()
      .then(setDisplayNo)
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Load workspace draft from DB ----
  React.useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    getWorkspace(workspaceId)
      .then((ws) => {
        if (cancelled || !ws) return;
        setWorkspaceName(ws.name);
        if (ws.draft) {
          const d = ws.draft as unknown as PasteDraft;
          setKifText(d.kifText ?? '');
          setRootSfen(d.rootSfen ?? '');
          setKifMoves(d.kifMoves ?? []);

          // Rebuild branch tree from saved KIF text so branch UI is visible after restore
          if (d.kifText?.trim()) {
            const branchResult = parseKifRecordWithBranches(d.kifText);
            if (branchResult && branchResult.branches.length > 1) {
              setKifBranches(branchResult.branches);
              setKifTree(branchResult.tree);
              const matched = branchResult.branches.find((b) => b.sfen === d.rootSfen);
              setActiveBranchId(matched?.id ?? 0);
            } else {
              setKifBranches([]);
              setKifTree([]);
              setActiveBranchId(0);
            }
          } else {
            setKifBranches([]);
            setKifTree([]);
            setActiveBranchId(0);
          }

          setChoices(d.choices ?? {
            correct: { ...EMPTY_CHOICE, slotLabel: 'correct' },
            incorrect1: { ...EMPTY_CHOICE, slotLabel: 'incorrect1' },
            incorrect2: { ...EMPTY_CHOICE, slotLabel: 'incorrect2' },
          });
          setReadingLineInputs(d.readingLineInputs ?? { correct: '', incorrect1: '', incorrect2: '' });
          setPrompt(d.prompt ?? DEFAULT_PROMPT);
          setTags(d.tags ?? []);
          if (d.displayNo != null) setDisplayNo(d.displayNo);
          if (d.problemRating != null) setProblemRating(d.problemRating);
          setRootEvalCp(d.rootEvalCp ?? null);
          setRootEvalPercent(d.rootEvalPercent ?? null);
          setMessage('ワークスペースの下書きを復元しました');
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // ---- Save draft to DB (workspace) ----
  const handleSaveDraftToDb = useCallback(async () => {
    if (!workspaceId) return;
    setDbSaving(true);
    try {
      const draft = buildDraft();
      await saveWorkspaceDraft(workspaceId, draft as unknown as Record<string, unknown>);
      setMessage('ワークスペースに途中保存しました');
    } catch (e: any) {
      setMessage(`途中保存エラー: ${e.message}`);
    } finally {
      setDbSaving(false);
    }
  }, [workspaceId, buildDraft]);

  // ---- KIF parsing ----

  const doParseKif = useCallback((text: string) => {
    setKifError('');
    if (!text.trim()) {
      setKifError('棋譜を貼り付けてください');
      return;
    }

    // Try branch-aware parser first
    const branchResult = parseKifRecordWithBranches(text);
    if (branchResult && branchResult.branches.length > 0) {
      const mainBranch = branchResult.branches[0];
      setKifBranches(branchResult.branches);
      setKifTree(branchResult.tree);
      setActiveBranchId(0);
      setRootSfen(mainBranch.sfen);
      setKifMoves(mainBranch.moves);
      const branchMsg = branchResult.branches.length > 1
        ? `（${branchResult.branches.length}分岐）`
        : '';
      setMessage(`棋譜を読み込みました（${mainBranch.moves.length}手）${branchMsg}`);
      return;
    }

    // Fallback to simple parser
    const result = parseKifRecord(text);
    if (!result) {
      setKifError('棋譜を解析できませんでした。KIF形式またはSFEN文字列を確認してください。');
      return;
    }
    setKifBranches([]);
    setKifTree([]);
    setActiveBranchId(0);
    setRootSfen(result.sfen);
    setKifMoves(result.moves);
    setMessage(`棋譜を読み込みました（${result.moves.length}手）`);
  }, []);

  const handleParseKif = useCallback(() => doParseKif(kifText), [kifText, doParseKif]);

  const handleSelectBranch = useCallback((branchId: number) => {
    const branch = kifBranches.find((b) => b.id === branchId);
    if (!branch) return;
    setActiveBranchId(branchId);
    setRootSfen(branch.sfen);
    setKifMoves(branch.moves);
    setMessage(`${branch.name}に切り替えました（${branch.moves.length}手）`);
  }, [kifBranches]);

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setKifText(text);
      doParseKif(text);
    } catch {
      setKifError('クリップボードの読み取りに失敗しました');
    }
  }, [doParseKif]);

  // ---- Reading-line parsing ----

  const markerSide = useCallback((label: string): Side | null => {
    const m = label.trim().charAt(0);
    if (m === '▲' || m === '☗') return 'sente';
    if (m === '△' || m === '☖') return 'gote';
    return null;
  }, []);

  const handleParseReadingLine = useCallback(
    (slot: SlotKey, text: string) => {
      setReadingLineErrors((prev) => ({ ...prev, [slot]: '' }));
      if (!text.trim()) {
        setReadingLineErrors((prev) => ({ ...prev, [slot]: '読み筋を入力してください' }));
        return;
      }
      if (!rootSfen) {
        setReadingLineErrors((prev) => ({
          ...prev,
          [slot]: '先に棋譜を読み込んでください',
        }));
        return;
      }

      const result = parseReadingLine(text);
      if (!result || result.moves.length === 0) {
        setReadingLineErrors((prev) => ({
          ...prev,
          [slot]: '読み筋を解析できませんでした。形式を確認してください。',
        }));
        return;
      }

      const firstMoveSide = result.labels.length > 0 ? markerSide(result.labels[0]) : null;
      const rootSide = parsed?.sideToMove ?? 'sente';

      // Support two formats:
      // 1) candidate move is included at the head of PV
      // 2) PV starts from the move after candidate
      const includesChoiceMove = firstMoveSide === rootSide;
      const existingChoiceUsi = choices[slot].usi;

      const choiceUsi = includesChoiceMove ? result.moves[0] : existingChoiceUsi;
      if (!choiceUsi) {
        setReadingLineErrors((prev) => ({
          ...prev,
          [slot]: 'この形式の読み筋は先に盤面で選択肢の手を登録してください',
        }));
        return;
      }

      const continuationMoves = includesChoiceMove
        ? result.moves.slice(1, 13)
        : result.moves.slice(0, 12);

      const board = parsed?.board;
      const side = parsed?.sideToMove ?? 'sente';
      const label = board ? usiToLabel(choiceUsi, board, side) : choiceUsi;

      let evalPercent: number | null = null;
      if (result.evalCp !== null) {
        try {
          evalPercent = cpToWinRatePercentFromRootSfen({
            cp: result.evalCp,
            rootSfen,
            scale: WINRATE_SCALE,
          });
        } catch {
          /* ignore */
        }
      }

      setChoices((prev) => ({
        ...prev,
        [slot]: {
          ...prev[slot],
          usi: choiceUsi,
          label,
          eval_cp: result.evalCp,
          eval_percent: evalPercent,
          line: continuationMoves,
        },
      }));

      if (slot === 'correct' && result.evalCp !== null) {
        setRootEvalCp(result.evalCp);
        setRootEvalPercent(evalPercent);
      }
    },
    [rootSfen, parsed, markerSide, choices],
  );

  // ---- Recalculate % from cp ----

  const handleRecalculatePercent = useCallback(
    (slot: SlotKey) => {
      const cp = choices[slot].eval_cp;
      if (cp === null || !rootSfen) return;
      try {
        const percent = cpToWinRatePercentFromRootSfen({
          cp,
          rootSfen,
          scale: WINRATE_SCALE,
        });
        setChoices((prev) => ({
          ...prev,
          [slot]: { ...prev[slot], eval_percent: percent },
        }));
        if (slot === 'correct') setRootEvalPercent(percent);
      } catch {
        /* ignore */
      }
    },
    [choices, rootSfen],
  );

  // ---- Move registration via board ----

  const registerMove = useCallback(
    (usi: string) => {
      if (!activeSlot || !parsed) return;
      const label = usiToLabel(usi, parsed.board, parsed.sideToMove);
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
    },
    [activeSlot, parsed],
  );

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (!parsed || !activeSlot || promotionChoice) return;
      const { board: b, sideToMove: side } = parsed;

      if (selectedHandPiece) {
        const validDrops = getValidDropSquares(b, side, selectedHandPiece.type);
        if (!validDrops.some((s) => s.row === row && s.col === col)) {
          const piece = b[row][col];
          if (piece && piece.side === side) {
            setSelectedHandPiece(null);
            setSelectedCell({ row, col });
          }
          return;
        }
        registerMove(`${selectedHandPiece.type}*${toUsiSquare(row, col)}`);
        return;
      }

      if (!selectedCell) {
        if (b[row][col] && b[row][col]!.side === side) setSelectedCell({ row, col });
        return;
      }
      if (selectedCell.row === row && selectedCell.col === col) {
        setSelectedCell(null);
        return;
      }
      const targetPiece = b[row][col];
      if (targetPiece && targetPiece.side === side) {
        setSelectedCell({ row, col });
        return;
      }

      const validMoves = getValidDestinations(b, selectedCell.row, selectedCell.col, side);
      if (!validMoves.some((s) => s.row === row && s.col === col)) return;

      const fromSq = toUsiSquare(selectedCell.row, selectedCell.col);
      const toSq = toUsiSquare(row, col);
      const piece = b[selectedCell.row][selectedCell.col];

      if (piece && !piece.promoted && CAN_PROMOTE[piece.type]) {
        const inPromotionZone =
          (side === 'sente' && (row <= 2 || selectedCell.row <= 2)) ||
          (side === 'gote' && (row >= 6 || selectedCell.row >= 6));
        if (inPromotionZone) {
          const mustPromote =
            (piece.type === 'P' && ((side === 'sente' && row === 0) || (side === 'gote' && row === 8))) ||
            (piece.type === 'L' && ((side === 'sente' && row === 0) || (side === 'gote' && row === 8))) ||
            (piece.type === 'N' && ((side === 'sente' && row <= 1) || (side === 'gote' && row >= 7)));
          if (mustPromote) {
            registerMove(`${fromSq}${toSq}+`);
          } else {
            setPromotionChoice({ fromSq, toSq, pieceType: piece.type });
          }
          return;
        }
      }
      registerMove(`${fromSq}${toSq}`);
    },
    [parsed, activeSlot, selectedCell, selectedHandPiece, registerMove, promotionChoice],
  );

  const handlePromotionSelect = useCallback(
    (promote: boolean) => {
      if (!promotionChoice) return;
      registerMove(`${promotionChoice.fromSq}${promotionChoice.toSq}${promote ? '+' : ''}`);
      setPromotionChoice(null);
    },
    [promotionChoice, registerMove],
  );

  const handleHandPieceClick = useCallback(
    (side: Side, type: HandPieceType) => {
      if (!parsed || side !== parsed.sideToMove) return;
      setSelectedCell(null);
      setSelectedHandPiece((prev) =>
        prev?.side === side && prev?.type === type ? null : { side, type },
      );
    },
    [parsed],
  );

  // ---- Field handlers ----

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
  const handleExplanationChange = (slot: SlotKey, text: string) => {
    setChoices((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], explanation: text },
    }));
  };
  const handleClearSlot = (slot: SlotKey) => {
    setChoices((prev) => ({
      ...prev,
      [slot]: { ...EMPTY_CHOICE, slotLabel: slot },
    }));
    setReadingLineInputs((prev) => ({ ...prev, [slot]: '' }));
    setReadingLineErrors((prev) => ({ ...prev, [slot]: '' }));
  };

  // ---- Generate explanations via AI ----

  const handleGenerateExplanations = useCallback(async () => {
    if (!rootSfen || !parsed) {
      setMessage('先に棋譜を読み込んでください');
      return;
    }
    const slots: SlotKey[] = ['correct', 'incorrect1', 'incorrect2'];
    const filledSlots = slots.filter((s) => choices[s].usi);
    if (filledSlots.length === 0) {
      setMessage('選択肢を1つ以上設定してください');
      return;
    }

    const targetSlots = filledSlots.filter((s) => !choices[s].explanation.trim());
    if (targetSlots.length === 0) {
      setMessage('すべての選択肢に解説が入力済みです');
      return;
    }

    setGenerating(true);
    setMessage('');
    try {
      const choiceData = targetSlots.map((slot) => {
        const c = choices[slot];
        // Convert USI reading line to Japanese labels
        const fullPv = [c.usi, ...c.line];
        const labels = pvToJapanese(fullPv, rootSfen, fullPv.length);
        return {
          label: c.label,
          eval_cp: c.eval_cp,
          eval_percent: c.eval_percent,
          line_labels: labels.slice(1).join(' '), // exclude the choice move itself
          is_correct: slot === 'correct',
        };
      });

      const results = await generateExplanations(
        rootSfen,
        parsed.sideToMove,
        choiceData,
      );

      setChoices((prev) => {
        const next = { ...prev };
        results.forEach((r) => {
          const slot = targetSlots[r.index];
          if (slot) {
            next[slot] = { ...next[slot], explanation: r.explanation };
          }
        });
        return next;
      });
      setMessage(`解説を生成しました（${targetSlots.length}件）`);
    } catch (e: any) {
      setMessage(`解説生成エラー: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  }, [rootSfen, parsed, choices]);

  // ---- Validation ----

  const buildSaveRootAndIntro = useCallback((): {
    rootSfenForSave: string;
    introMovesUsi: string[];
  } => {
    // intro = move immediately before the choice position
    if (kifMoves.length === 0) {
      return { rootSfenForSave: rootSfen, introMovesUsi: [] };
    }

    const introMove = kifMoves[kifMoves.length - 1];
    const baseMoves = kifMoves.slice(0, -1);

    const state = parseSfen(INITIAL_SFEN);
    let { board, senteHand, goteHand, sideToMove } = state;
    for (const usi of baseMoves) {
      const result = applyUsiMove(board, senteHand, goteHand, sideToMove, usi);
      board = result.board;
      senteHand = result.senteHand;
      goteHand = result.goteHand;
      sideToMove = sideToMove === 'sente' ? 'gote' : 'sente';
    }

    return {
      rootSfenForSave: boardToSfen(board, sideToMove, senteHand, goteHand, baseMoves.length + 1),
      introMovesUsi: [introMove],
    };
  }, [kifMoves, rootSfen]);

  const validate = (): string[] => {
    const errors: string[] = [];
    if (!rootSfen) errors.push('局面が読み込まれていません');
    if (!choices.correct.usi) errors.push('正解手が未設定です');
    if (!choices.incorrect1.usi) errors.push('不正解手１が未設定です');
    if (!choices.incorrect2.usi) errors.push('不正解手２が未設定です');
    const usis = [choices.correct.usi, choices.incorrect1.usi, choices.incorrect2.usi].filter(
      Boolean,
    );
    if (new Set(usis).size !== usis.length) errors.push('候補手が重複しています');
    return errors;
  };

  // ---- Save ----

  const handleSave = async () => {
    const errors = validate();
    if (errors.length > 0) {
      setMessage(errors.join('\n'));
      return;
    }

    setSaving(true);
    setMessage('');
    try {
      const { rootSfenForSave, introMovesUsi } = buildSaveRootAndIntro();
      const problem = {
        prompt: prompt.trim() || DEFAULT_PROMPT,
        root_sfen: rootSfenForSave,
        correct_choice_id: 1,
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
      localStorage.removeItem(LOCALSTORAGE_KEY);
      lastSavedRef.current = '';
      setSavedProblemId(problemId);
      setMessage(`保存しました (problem_id: ${problemId})`);

      // Show delete-workspace modal if opened from workspace
      if (workspaceId) {
        setShowDeleteWsModal(true);
      }
    } catch (e: any) {
      setMessage(`保存エラー: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ========================================
  // Render
  // ========================================

  return (
    <>
      <div className="w-full h-[calc(100vh-84px)] overflow-auto">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-lg font-semibold">
            問題作成（貼付）
            {workspaceName && (
              <span className="text-[13px] font-normal text-blue-600 ml-2">
                📁 {workspaceName}
              </span>
            )}
          </h2>
          <span className="text-[12px] text-gray-400">
            {autosaveState === 'saved' ? '自動保存済み' : ''}
          </span>
        </div>

        <div className="flex w-full h-[calc(100%-26px)] min-w-0 gap-2 items-start justify-start overflow-auto">
          {/* ---- Left: Board + KIF paste ---- */}
          <div className="flex-shrink-0 w-[320px] md:w-[350px] flex flex-col gap-1">
            {/* KIF paste area */}
            <div className="flex flex-col gap-0.5">
              <textarea
                className="text-[10px] font-mono leading-tight w-full"
                rows={rootSfen ? 2 : 3}
                placeholder={'KIF棋譜 / SFEN を貼り付け'}
                value={kifText}
                onChange={(e) => setKifText(e.target.value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData('text/plain');
                  if (pasted) {
                    e.preventDefault();
                    setKifText(pasted);
                    doParseKif(pasted);
                  }
                }}
              />
              <div className="flex gap-1">
                <button
                  className="text-[10px] px-1.5 py-0.5 bg-gray-100 border-gray-300 hover:bg-gray-200"
                  type="button"
                  onClick={handleParseKif}
                >
                  解析
                </button>
                <button
                  className="text-[10px] px-1.5 py-0.5 bg-blue-100 border-blue-300 hover:bg-blue-200"
                  type="button"
                  onClick={handlePasteFromClipboard}
                >
                  📋 貼り付け
                </button>
              </div>
              {kifError && (
                <div className="text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                  {kifError}
                </div>
              )}

              {/* Branch tree diagram */}
              {kifBranches.length > 1 && (
                <BranchTree
                  branches={kifBranches}
                  tree={kifTree}
                  activeBranchId={activeBranchId}
                  onSelectBranch={handleSelectBranch}
                />
              )}
            </div>

            {/* Board (scaled) */}
            {parsed && (
              <div
                className="flex-shrink-0 overflow-hidden"
                style={{
                  width: Math.ceil(530 * BOARD_SCALE),
                  height: Math.ceil(400 * BOARD_SCALE),
                }}
              >
                <div style={{ transform: `scale(${BOARD_SCALE})`, transformOrigin: 'top left' }}>
                  <Board
                    board={parsed.board}
                    senteHand={parsed.senteHand}
                    goteHand={parsed.goteHand}
                    sideToMove={parsed.sideToMove}
                    selectedCell={selectedCell}
                    onCellClick={handleCellClick}
                    onHandPieceClick={handleHandPieceClick}
                  />
                </div>
              </div>
            )}

            {parsed && (
              <div className="flex gap-2 text-[11px] text-gray-500 flex-wrap items-center">
                <span>
                  {parsed.sideToMove === 'sente' ? '☗先手' : '☖後手'}
                </span>
                {kifMoves.length > 0 && <span>{kifMoves.length}手目</span>}
                {selectedHandPiece && (
                  <span className="text-blue-600 font-semibold">
                    打: {selectedHandPiece.type}
                  </span>
                )}
                {rootEvalCp !== null && (
                  <span>
                    {rootEvalCp}cp ({rootEvalPercent}%)
                  </span>
                )}
              </div>
            )}
            {promotionChoice && parsed && (
              <div className="flex items-center gap-2 px-2 py-1 bg-amber-50 border-2 border-amber-400 rounded-md text-[12px] font-semibold">
                <span>成?</span>
                <button
                  className="w-10 h-10 text-xl font-bold flex items-center justify-center border-2 border-gray-300 rounded bg-white cursor-pointer hover:border-blue-600 hover:bg-blue-100"
                  onClick={() => handlePromotionSelect(false)}
                >
                  {pieceKanji({
                    type: promotionChoice.pieceType,
                    side: parsed.sideToMove,
                    promoted: false,
                  })}
                </button>
                <button
                  className="w-10 h-10 text-xl font-bold flex items-center justify-center border-2 border-gray-300 rounded bg-white cursor-pointer hover:border-blue-600 hover:bg-blue-100 text-red-700"
                  onClick={() => handlePromotionSelect(true)}
                >
                  {pieceKanji({
                    type: promotionChoice.pieceType,
                    side: parsed.sideToMove,
                    promoted: true,
                  })}
                </button>
              </div>
            )}

            <div className="flex flex-col gap-1 mt-1">
              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] font-semibold text-gray-500">問題文</label>
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="h-7 text-[12px]"
                />
              </div>

              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] font-semibold text-gray-500">display_no</label>
                <input
                  type="number"
                  value={displayNo ?? ''}
                  onChange={(e) =>
                    setDisplayNo(e.target.value ? parseInt(e.target.value, 10) : null)
                  }
                  className="h-7 text-[12px]"
                />
              </div>

              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] font-semibold text-gray-500">レート</label>
                <select
                  value={problemRating}
                  onChange={(e) => setProblemRating(parseInt(e.target.value, 10))}
                  className="h-7 text-[12px]"
                >
                  {Array.from({ length: 19 }, (_, i) => 600 + i * 100).map((rating) => (
                    <option key={rating} value={rating}>
                      {rating}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ---- Middle + Right ---- */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(180px,240px)] gap-2 items-start min-w-0 max-w-full">
            {/* Choice cards */}
            <div className="flex flex-col gap-1.5 items-start min-w-0">
              {(['correct', 'incorrect1', 'incorrect2'] as SlotKey[]).map((slot) => (
                <PasteChoiceCard
                  key={slot}
                  slot={slot}
                  draft={choices[slot]}
                  isActive={activeSlot === slot}
                  readingLineInput={readingLineInputs[slot]}
                  readingLineError={readingLineErrors[slot]}
                  onActivate={() => {
                    const nextSlot = activeSlot === slot ? null : slot;
                    setActiveSlot(nextSlot);
                    setSelectedCell(null);
                    setSelectedHandPiece(null);
                  }}
                  onReadingLineChange={(text) =>
                    setReadingLineInputs((prev) => ({ ...prev, [slot]: text }))
                  }
                  onPasteReadingLine={(text) => handleParseReadingLine(slot, text)}
                  onEvalCpChange={(value) => handleEvalCpChange(slot, value)}
                  onEvalPercentChange={(value) => handleEvalPercentChange(slot, value)}
                  onRecalculatePercent={() => handleRecalculatePercent(slot)}
                  onExplanationChange={(text) => handleExplanationChange(slot, text)}
                  onClear={() => handleClearSlot(slot)}
                  onShowReplay={() => setReplaySlot(slot)}
                />
              ))}
            </div>

            {/* Settings (narrower) */}
            <div className="min-w-[180px] max-w-[240px] flex flex-col gap-1">
              <TagSelector selected={tags} onChange={setTags} />

              <div className="flex flex-wrap gap-1.5 mt-1">
                <button onClick={handleSaveDraft} type="button" className="text-[11px]">
                  途中保存
                </button>
                {workspaceId && (
                  <button
                    onClick={handleSaveDraftToDb}
                    disabled={dbSaving}
                    type="button"
                    className="bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700 text-[11px]"
                  >
                    {dbSaving ? '保存中...' : '💾 DBに途中保存'}
                  </button>
                )}
                <button onClick={() => setShowPreview(true)} type="button" className="text-[11px]">
                  プレビュー
                </button>
                <button
                  onClick={handleGenerateExplanations}
                  disabled={generating}
                  type="button"
                  className="bg-purple-600 text-white border-purple-600 hover:bg-purple-700 text-[11px]"
                >
                  {generating ? '生成中...' : '🤖 解説生成'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-blue-600 text-white border-blue-600 hover:bg-blue-700 text-[11px]"
                >
                  {saving ? '保存中...' : 'Supabaseに保存'}
                </button>
              </div>
            </div>

            {message && (
              <div
                className={`px-2 py-1.5 rounded text-[12px] whitespace-pre-wrap lg:col-span-2 ${
                  message.includes('エラー')
                    ? 'bg-red-50 border border-red-300 text-red-700'
                    : 'bg-emerald-50 border border-emerald-300 text-emerald-800'
                }`}
              >
                {message}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preview modal */}
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
                (() => {
                  const { rootSfenForSave, introMovesUsi } = buildSaveRootAndIntro();
                  return {
                    problem: {
                      prompt,
                      root_sfen: rootSfenForSave,
                      correct_choice_id: 1,
                      intro_moves_usi: introMovesUsi,
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
                  };
                })(),
                null,
                2,
              )}
            </pre>
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button type="button" onClick={() => setShowPreview(false)}>
                閉じる
              </button>
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

      {/* Reading-line replay modal */}
      {replaySlot && choices[replaySlot].usi && rootSfen && (
        <ReadingLineModal
          rootSfen={rootSfen}
          line={[choices[replaySlot].usi, ...choices[replaySlot].line]}
          onClose={() => setReplaySlot(null)}
        />
      )}

      {/* Post-save: delete workspace? modal */}
      {showDeleteWsModal && workspaceId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowDeleteWsModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-5 w-full max-w-[380px] mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-2">保存完了</h3>
            <p className="text-[13px] text-gray-600 mb-4">
              問題を保存しました{savedProblemId != null ? ` (problem_id: ${savedProblemId})` : ''}。
              <br />
              このワークスペースを削除しますか？
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteWsModal(false);
                  navigate('/workspaces');
                }}
                className="text-[13px]"
              >
                残す
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await deleteWorkspace(workspaceId);
                  } catch { /* ignore */ }
                  setShowDeleteWsModal(false);
                  navigate('/workspaces');
                }}
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
};

function pickChoiceFields(draft: ChoiceDraft) {
  const line = draft.line[0] === draft.usi ? draft.line.slice(1) : draft.line;
  return {
    usi: draft.usi,
    label: draft.label,
    explanation: draft.explanation,
    line,
    eval_cp: draft.eval_cp,
    eval_percent: draft.eval_percent,
  };
}

export default PasteProblemCreator;
