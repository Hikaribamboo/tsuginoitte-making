import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Board from '../components/Board';
import type { ArrowInfo } from '../components/Board';
import PasteChoiceCard from '../components/PasteChoiceCard';
import PasteIntroMoveCard from '../components/PasteIntroMoveCard';
import KeyboardModal from '../components/KeyboardModal';
import ReadingLineModal from '../components/ReadingLineModal';
import MobileExplanationEditor from '../components/MobileExplanationEditor';
import PositionEditor from '../components/PositionEditor';
import TagSelector from '../components/TagSelector';
import NewModeTagSelector from '../components/NewModeTagSelector';
import AnalysisPanel from '../components/AnalysisPanel';
import type { BestMove } from '../components/AnalysisPanel';
import Toggle from '../components/Toggle';
import { useBoardStore } from '../hooks/useBoardStore';
import { INITIAL_SFEN, parseSfen, applyUsiMove, boardToSfen, toUsiSquare } from '../lib/sfen';
import { usiToLabel, pvToJapanese } from '../lib/usi-to-label';
import { cpToWinRatePercent } from '../lib/eval-percent';
import { parseKifRecord, parseReadingLine, parseKifRecordWithBranches, extractBranchProblems } from '../lib/kif-parser';
import type { KifBranch, KifTreeNode } from '../lib/kif-parser';
import { saveProblem, getNextDisplayNo, saveMultipleProblems, saveLearningProblem } from '../api/problems';
import {
  getWorkspace,
  saveWorkspaceDraft,
  deleteWorkspace,
  hideWorkspaceFromList,
  findNewModeDraftByRootSfenAndIntro,
} from '../api/workspaces';
import {
  evaluatePosition,
  generateExplanations,
  startAnalysisStream,
  stopAnalysis,
  type AnalysisLine,
} from '../api/backend';
import { AVAILABLE_TAGS, DEFAULT_PROMPT } from '../lib/constants';
import { saveLastNewModeTags } from '../lib/new-mode-tags';
import { getValidDestinations, getValidDropSquares } from '../lib/legal-moves';
import {
  buildReplayLine,
  buildSfenAfterMoves,
  formatMoveValidationError,
  pickChoiceFields,
  validateMoveSequence,
} from '../lib/paste-problem-utils';
import type { ChoiceDraft } from '../types/problem';
import type { Side, HandPieceType, PieceType } from '../types/shogi';
import { CAN_PROMOTE, pieceKanji } from '../types/shogi';
import { useNavigationPrompt } from '../hooks/useNavigationPrompt';
import { useMobileMode } from '../components/MobileModeContext';

type SlotKey = 'correct' | 'incorrect1' | 'incorrect2';
type BoardCell = { row: number; col: number };
const CHOICE_EVAL_DEPTH = 26;
const BOARD_ANALYSIS_MIN_DISPLAY_DEPTH = 22;
const BOARD_ANALYSIS_MAX_DEPTH = 28;
const BOARD_SCALE = 0.76;
const SLOT_ORDER: SlotKey[] = ['correct', 'incorrect1', 'incorrect2'];
const SLOT_LABELS: Record<SlotKey, string> = {
  correct: '正解手',
  incorrect1: '不正解手1',
  incorrect2: '不正解手2',
};
const AI_EXPLANATION_PREFIX = '[AI解説(試験的)]';

function shuffledSlots(): SlotKey[] {
  const slots = [...SLOT_ORDER];
  for (let i = slots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

function normalizeCpToSentePerspective(cp: number, sideToMove: Side): number {
  return sideToMove === 'sente' ? cp : -cp;
}

function withAiExplanationPrefix(explanation: string): string {
  const trimmed = explanation.trim();
  return trimmed.startsWith(AI_EXPLANATION_PREFIX)
    ? trimmed
    : `${AI_EXPLANATION_PREFIX}${trimmed}`;
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

interface PasteDraft {
  kifText: string;
  rootSfen: string;
  kifMoves: string[];
  introMoveUsi: string;
  choices: Record<SlotKey, ChoiceDraft>;
  readingLineInputs: Record<SlotKey, string>;
  prompt: string;
  tags: string[];
  displayNo: number | null;
  problemRating: number;
  rootEvalCp: number | null;
  rootEvalPercent: number | null;
  savedAt: string;
  mode?: 'next_move' | 'joseki' | 'new_mode';
  imagePositionSource?: {
    imageItemId?: string;
    fileName?: string;
    memo?: string;
    recognitionModel?: string | null;
    recognitionConfidence?: number | null;
    recognitionNotes?: string[];
    issues?: unknown[];
    introMoveUsi?: string | null;
    correctMoveUsi?: string | null;
    correctMoveLabel?: string | null;
  } | null;
}

function draftSignature(draft: PasteDraft): string {
  const { savedAt: _savedAt, ...stablePart } = draft;
  return JSON.stringify(stablePart);
}

function usiDestinationToBoardCoord(usi: string): { file: number; rank: number } | null {
  const dropMatch = usi.match(/^[PLNSGBRK]\*([1-9])([a-i])$/i);
  if (dropMatch) {
    const file = parseInt(dropMatch[1], 10);
    const rank = dropMatch[2].toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0) + 1;
    return { file, rank };
  }

  const moveMatch = usi.match(/^[1-9][a-i]([1-9])([a-i])\+?$/i);
  if (moveMatch) {
    const file = parseInt(moveMatch[1], 10);
    const rank = moveMatch[2].toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0) + 1;
    return { file, rank };
  }

  return null;
}

function isSfenLikeInput(text: string): boolean {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized || normalized.includes('\n')) return false;

  const oneLine = normalized.replace(/\s+/g, ' ');
  const withoutPrefix = oneLine.replace(/^position\s+sfen\s+/i, '');
  const sfen = withoutPrefix.split(/\s+moves\s+/i)[0]?.trim() ?? '';
  const parts = sfen.split(/\s+/);
  return parts.length >= 3 && parts[0].includes('/') && /^[bw]$/i.test(parts[1]);
}

function isKifInput(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return !isSfenLikeInput(trimmed);
}

function toggleSfenSideToMove(sfen: string): string {
  const parts = sfen.trim().split(/\s+/);
  if (parts.length < 2) return sfen;
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  return parts.join(' ');
}

function extractBaseSfenFromPositionText(text: string): string | null {
  const normalized = text.replace(/\r\n?/g, '\n').trim().replace(/\s+/g, ' ');
  if (!normalized) return null;

  let source = normalized;
  const embeddedPosition = normalized.match(/position\s+sfen\s+(.+)$/i);
  if (embeddedPosition?.[1]) {
    source = embeddedPosition[1].trim();
  }
  if (/^sfen\s+/i.test(source)) {
    source = source.replace(/^sfen\s+/i, '').trim();
  }

  const baseSfen = source.split(/\s+moves\s+/i)[0]?.trim() ?? '';
  const parts = baseSfen.split(/\s+/);
  if (parts.length >= 3 && parts[0].includes('/') && /^[bw]$/i.test(parts[1])) {
    return baseSfen;
  }
  return null;
}

function extractBaseSfenFromBoardDiagramText(text: string): string | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const withoutMoves = lines.filter((line) => !/^\s*\d+\s+/.test(line)).join('\n');
  const parsed = parseKifRecord(withoutMoves);
  return parsed?.sfen ?? null;
}

function deriveSourceSfen(kifText: string): string {
  const fromPositionText = extractBaseSfenFromPositionText(kifText);
  if (fromPositionText) return fromPositionText;

  const hasBoardDiagram = kifText.includes('先手の持駒') || kifText.includes('後手の持駒');
  if (hasBoardDiagram) {
    const fromBoardDiagram = extractBaseSfenFromBoardDiagramText(kifText);
    if (fromBoardDiagram) return fromBoardDiagram;
  }

  return INITIAL_SFEN;
}

const PasteProblemCreator: React.FC = () => {
  // ---- Workspace (DB-backed draft) ----
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { mobileMode } = useMobileMode();
  const workspaceId = searchParams.get('workspace');

  // ---- KIF state ----
  const [kifText, setKifText] = useState('');
  const [kifError, setKifError] = useState('');
  const [rootSfen, setRootSfen] = useState('');
  const [kifMoves, setKifMoves] = useState<string[]>([]);
  const [introMoveUsi, setIntroMoveUsi] = useState('');
  const [introMoveActive, setIntroMoveActive] = useState(false);
  const [canFlipTurn, setCanFlipTurn] = useState(false);

  // ---- Branch state ----
  const [kifBranches, setKifBranches] = useState<KifBranch[]>([]);
  const [kifTree, setKifTree] = useState<KifTreeNode[]>([]);
  const [activeBranchId, setActiveBranchId] = useState(0);

  // ---- Workspace name (for display) ----
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(!workspaceId);
  const [showDeleteWsModal, setShowDeleteWsModal] = useState(false);
  const [showDeleteWorkspaceConfirm, setShowDeleteWorkspaceConfirm] = useState(false);
  const [savedProblemId, setSavedProblemId] = useState<number | null>(null);
  const [imagePositionSource, setImagePositionSource] = useState<PasteDraft['imagePositionSource']>(null);
  const [preferredSaveMode, setPreferredSaveMode] = useState<'next_move' | 'joseki' | 'new_mode'>('next_move');

  // ---- Choice drafts ----
  const [choices, setChoices] = useState<Record<SlotKey, ChoiceDraft>>(
    {
      correct: { ...EMPTY_CHOICE, slotLabel: 'correct' },
      incorrect1: { ...EMPTY_CHOICE, slotLabel: 'incorrect1' },
      incorrect2: { ...EMPTY_CHOICE, slotLabel: 'incorrect2' },
    },
  );

  // Reading-line inputs / errors per card
  const [readingLineInputs, setReadingLineInputs] = useState<Record<SlotKey, string>>(
    { correct: '', incorrect1: '', incorrect2: '' },
  );
  const [readingLineErrors, setReadingLineErrors] = useState<Record<SlotKey, string>>({
    correct: '',
    incorrect1: '',
    incorrect2: '',
  });

  // ---- Form fields ----
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [tags, setTags] = useState<string[]>([]);
  const [displayNo, setDisplayNo] = useState<number | null>(null);
  const [problemRating, setProblemRating] = useState<number>(1500);
  const [rootEvalCp, setRootEvalCp] = useState<number | null>(null);
  const [rootEvalPercent, setRootEvalPercent] = useState<number | null>(null);

  // ---- UI state ----
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [registeringJoseki, setRegisteringJoseki] = useState(false);
  const [savingNewMode, setSavingNewMode] = useState(false);
  const [josekiSaveWarning, setJosekiSaveWarning] = useState('');
  const [newModeSaveWarnings, setNewModeSaveWarnings] = useState<string[]>([]);
  const [savingBranches, setSavingBranches] = useState(false);
  const [message, setMessage] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [replaySlot, setReplaySlot] = useState<SlotKey | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [keyboardSlot, setKeyboardSlot] = useState<SlotKey | null>(null);
  const [keyboardDragging, setKeyboardDragging] = useState(false);
  const [evaluatingSlot, setEvaluatingSlot] = useState<SlotKey | null>(null);
  const [evalQueue, setEvalQueue] = useState<SlotKey[]>([]);
  const [mobileReplayStep, setMobileReplayStep] = useState(0);
  const [mobileExplanationMode, setMobileExplanationMode] = useState(false);
  const [isPositionEditing, setIsPositionEditing] = useState(false);

  const explanationInputRefs = React.useRef<Record<SlotKey, HTMLTextAreaElement | null>>({
    correct: null,
    incorrect1: null,
    incorrect2: null,
  });
  const mobileExplanationRef = React.useRef<HTMLTextAreaElement | null>(null);

  useNavigationPrompt(
    Boolean(workspaceId && hasUnsavedChanges),
    'DBに途中保存していない変更があります。このままページを移動しますか？',
  );

  // ---- Analysis mode (検討モード) ----
  const store = useBoardStore();
  const [analysisMode, setAnalysisMode] = useState(false);
  const [candidateMoves, setCandidateMoves] = useState<BestMove[]>([]);
  const handleCandidateMoves = useCallback((moves: BestMove[]) => {
    setCandidateMoves(moves);
  }, []);
  const arrows: ArrowInfo[] = candidateMoves.map((m, idx) => ({
    from: m.from,
    to: m.to,
    style: idx === 0 ? 'primary' : idx === 1 ? 'secondary' : ('tertiary' as const),
    showNextLabel: idx === 1,
  }));

  // ---- Board interaction state ----
  const [activeSlot, setActiveSlot] = useState<SlotKey | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [introDestination, setIntroDestination] = useState<BoardCell | null>(null);
  const introDestinationRef = useRef<BoardCell | null>(null);
  const [selectedHandPiece, setSelectedHandPiece] = useState<{ side: Side; type: HandPieceType } | null>(null);
  const [promotionChoice, setPromotionChoice] = useState<{
    fromSq: string;
    toSq: string;
    pieceType: PieceType;
  } | null>(null);

  React.useEffect(() => {
    if (!mobileMode || analysisMode || introMoveActive || activeSlot !== null) return;
    setActiveSlot('correct');
  }, [activeSlot, analysisMode, introMoveActive, mobileMode]);

  const searchSfen = rootSfen;
  const introMoveError = useMemo(() => {
    const move = introMoveUsi.trim();
    if (!rootSfen || !move) return '';
    const validation = validateMoveSequence(rootSfen, [move]);
    return validation.ok ? '' : formatMoveValidationError('イントロが非合法です', validation);
  }, [rootSfen, introMoveUsi]);

  const displaySfen = useMemo(() => {
    if (!rootSfen) return rootSfen;
    if (!introMoveUsi) return rootSfen;
    if (validateMoveSequence(rootSfen, [introMoveUsi]).ok === false) return rootSfen;
    try {
      const base = parseSfen(rootSfen);
      const res = applyUsiMove(base.board, base.senteHand, base.goteHand, base.sideToMove, introMoveUsi);
      const newSide = base.sideToMove === 'sente' ? 'gote' : 'sente';
      const newMoveNumber = base.moveNumber + 1;
      return boardToSfen(res.board, newSide, res.senteHand, res.goteHand, newMoveNumber);
    } catch (e) {
      return rootSfen;
    }
  }, [rootSfen, introMoveUsi]);
  // Initialize store when displaySfen changes (displaySfen = rootSfen with intro applied)
  React.useEffect(() => {
    if (displaySfen) store.loadFromSfen(displaySfen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySfen]);
  const displayParsed = useMemo(() => (displaySfen ? parseSfen(displaySfen) : null), [displaySfen]);
  const searchParsed = useMemo(() => (searchSfen ? parseSfen(searchSfen) : null), [searchSfen]);
  const parsed = displayParsed;
  const mobileSlot = activeSlot ?? 'correct';
  const mobileChoice = choices[mobileSlot];
  const mobileEvalCp = mobileChoice.eval_cp ?? (mobileSlot === 'correct' ? rootEvalCp : null);
  const mobileReplayMoves = useMemo(() => buildReplayLine(mobileChoice), [mobileChoice]);
  const mobileReplaySignature = mobileReplayMoves.join(' ');
  const mobileReplayPosition = useMemo(() => {
    if (!displaySfen) return null;
    const state = parseSfen(displaySfen);
    let { board, senteHand, goteHand, sideToMove, moveNumber } = state;
    for (let index = 0; index < mobileReplayStep && index < mobileReplayMoves.length; index += 1) {
      try {
        const result = applyUsiMove(board, senteHand, goteHand, sideToMove, mobileReplayMoves[index]);
        board = result.board;
        senteHand = result.senteHand;
        goteHand = result.goteHand;
        sideToMove = sideToMove === 'sente' ? 'gote' : 'sente';
        moveNumber += 1;
      } catch {
        break;
      }
    }
    return { board, senteHand, goteHand, sideToMove, moveNumber };
  }, [displaySfen, mobileReplayMoves, mobileReplayStep]);
  const mobileReplaySfen = mobileReplayPosition
    ? boardToSfen(
        mobileReplayPosition.board,
        mobileReplayPosition.sideToMove,
        mobileReplayPosition.senteHand,
        mobileReplayPosition.goteHand,
        mobileReplayPosition.moveNumber,
      )
    : displaySfen;
  const boardAnalysisTargetSfen = mobileMode
    ? mobileReplaySfen
    : analysisMode
      ? store.getSfen()
      : displaySfen;

  React.useEffect(() => {
    setMobileReplayStep(0);
  }, [mobileReplaySignature, mobileSlot, introMoveActive]);

  React.useEffect(() => {
    const textarea = mobileExplanationRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(52, textarea.scrollHeight)}px`;
  }, [mobileChoice.explanation, mobileSlot]);

  const [boardAnalysisMp, setBoardAnalysisMp] = useState(1);
  const [boardAnalyzing, setBoardAnalyzing] = useState(false);
  const [boardAnalysisDepth, setBoardAnalysisDepth] = useState(0);
  const [boardAnalysisLines, setBoardAnalysisLines] = useState<Map<number, AnalysisLine>>(new Map());
  const [boardAnalysisError, setBoardAnalysisError] = useState('');
  const boardAnalysisEventSourceRef = useRef<EventSource | null>(null);
  const boardAnalysisStoppingRef = useRef(false);

  const stopBoardAnalysis = useCallback(async (clearResults = false) => {
    boardAnalysisStoppingRef.current = true;
    boardAnalysisEventSourceRef.current?.close();
    boardAnalysisEventSourceRef.current = null;
    setBoardAnalyzing(false);
    if (clearResults) {
      setBoardAnalysisDepth(0);
      setBoardAnalysisLines(new Map());
      setBoardAnalysisError('');
    }
    try {
      await stopAnalysis();
    } catch {
      /* ignore */
    } finally {
      boardAnalysisStoppingRef.current = false;
    }
  }, []);

  const startBoardAnalysis = useCallback(() => {
    if (!boardAnalysisTargetSfen) {
      setBoardAnalysisError('局面がありません');
      return;
    }

    boardAnalysisStoppingRef.current = false;
    boardAnalysisEventSourceRef.current?.close();
    setBoardAnalysisError('');
    setBoardAnalysisDepth(0);
    setBoardAnalysisLines(new Map());

    const es = startAnalysisStream(
      boardAnalysisTargetSfen,
      boardAnalysisMp,
      (info) => {
        setBoardAnalysisDepth((prev) => Math.max(prev, info.depth));
        if (info.depth >= BOARD_ANALYSIS_MIN_DISPLAY_DEPTH) {
          setBoardAnalysisLines((prev) => {
            const next = new Map(prev);
            next.set(info.multipv, info);
            return next;
          });
        }
        if (info.depth >= BOARD_ANALYSIS_MAX_DEPTH && !boardAnalysisStoppingRef.current) {
          void stopBoardAnalysis(false);
        }
      },
      (err) => {
        setBoardAnalysisError(err);
        void stopBoardAnalysis(false);
      },
    );
    boardAnalysisEventSourceRef.current = es;
    setBoardAnalyzing(true);
  }, [boardAnalysisMp, boardAnalysisTargetSfen, stopBoardAnalysis]);

  const toggleBoardAnalysis = useCallback(() => {
    if (boardAnalyzing) {
      void stopBoardAnalysis(false);
    } else {
      startBoardAnalysis();
    }
  }, [boardAnalyzing, startBoardAnalysis, stopBoardAnalysis]);

  React.useEffect(() => {
    return () => {
      boardAnalysisEventSourceRef.current?.close();
      void stopAnalysis();
    };
  }, []);

  React.useEffect(() => {
    if (boardAnalyzing) {
      void stopBoardAnalysis(true);
    }
  }, [boardAnalysisTargetSfen]);

  const sortedBoardAnalysisLines = useMemo(
    () => Array.from(boardAnalysisLines.values()).sort((a, b) => a.multipv - b.multipv),
    [boardAnalysisLines],
  );
  const boardAnalysisSenteSign = useMemo(() => {
    if (!boardAnalysisTargetSfen) return 1;
    return parseSfen(boardAnalysisTargetSfen).sideToMove === 'sente' ? 1 : -1;
  }, [boardAnalysisTargetSfen]);

  const setIntroDestinationBoth = useCallback((cell: BoardCell | null) => {
    introDestinationRef.current = cell;
    setIntroDestination(cell);
  }, []);

  // ---- Build draft snapshot ----
  const buildDraft = useCallback((): PasteDraft => ({
    kifText,
    rootSfen,
    kifMoves,
    introMoveUsi,
    choices,
    readingLineInputs,
    prompt,
    tags,
    displayNo,
    problemRating,
    rootEvalCp,
    rootEvalPercent,
    mode: preferredSaveMode,
    imagePositionSource,
    savedAt: new Date().toISOString(),
  }), [kifText, rootSfen, kifMoves, introMoveUsi, choices, readingLineInputs, prompt, tags, displayNo, problemRating, rootEvalCp, rootEvalPercent, preferredSaveMode, imagePositionSource]);

  const lastSavedRef = React.useRef<string>('');

  // Auto-fetch next display_no on mount
  React.useEffect(() => {
    getNextDisplayNo()
      .then(setDisplayNo)
      .catch(() => {});
  }, []);

  // ---- Load workspace draft from DB ----
  React.useEffect(() => {
    if (!workspaceId) {
      setWorkspaceLoaded(true);
      return;
    }

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
          setIntroMoveUsi(d.introMoveUsi ?? '');
          setCanFlipTurn(isKifInput(d.kifText ?? ''));

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
          setImagePositionSource(d.imagePositionSource ?? null);
          // If this draft was created from an image, prefer joseki mode by default
          if (d.mode === 'new_mode' || d.mode === 'joseki' || d.mode === 'next_move') {
            setPreferredSaveMode(d.mode);
          } else if (d.imagePositionSource) {
            setPreferredSaveMode('joseki');
          }
          const sig = draftSignature({
            ...d,
            choices: d.choices ?? {
              correct: { ...EMPTY_CHOICE, slotLabel: 'correct' },
              incorrect1: { ...EMPTY_CHOICE, slotLabel: 'incorrect1' },
              incorrect2: { ...EMPTY_CHOICE, slotLabel: 'incorrect2' },
            },
            readingLineInputs: d.readingLineInputs ?? { correct: '', incorrect1: '', incorrect2: '' },
            prompt: d.prompt ?? DEFAULT_PROMPT,
            tags: d.tags ?? [],
            displayNo: d.displayNo ?? null,
            problemRating: d.problemRating ?? 1500,
            rootEvalCp: d.rootEvalCp ?? null,
            rootEvalPercent: d.rootEvalPercent ?? null,
            mode: d.mode ?? (d.imagePositionSource ? 'joseki' : 'next_move'),
            imagePositionSource: d.imagePositionSource ?? null,
            savedAt: d.savedAt ?? new Date().toISOString(),
            kifText: d.kifText ?? '',
            rootSfen: d.rootSfen ?? '',
            kifMoves: d.kifMoves ?? [],
            introMoveUsi: d.introMoveUsi ?? '',
          });
          lastSavedRef.current = sig;
          setHasUnsavedChanges(false);
          setMessage('下書きの下書きを復元しました');
        } else {
          setImagePositionSource(null);
          setPreferredSaveMode('next_move');
          const sig = draftSignature({ ...buildDraft(), imagePositionSource: null });
          lastSavedRef.current = sig;
          setHasUnsavedChanges(false);
        }
        setWorkspaceLoaded(true);
      })
      .catch(() => {
        setWorkspaceLoaded(true);
      });
    return () => { cancelled = true; };
  }, [workspaceId]);

  React.useEffect(() => {
    if (!workspaceId || !workspaceLoaded) return;
    const currentSignature = draftSignature(buildDraft());
    setHasUnsavedChanges(currentSignature !== lastSavedRef.current);
  }, [workspaceId, workspaceLoaded, buildDraft]);

  React.useEffect(() => {
    if (!workspaceId || !hasUnsavedChanges) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [workspaceId, hasUnsavedChanges]);

  const persistWorkspaceDraft = useCallback(async () => {
    if (!workspaceId) {
      setMessage('下書きを開いたときだけ途中保存できます');
      return false;
    }
    setDraftSaving(true);
    try {
      const draft = buildDraft();
      await saveWorkspaceDraft(workspaceId, draft as unknown as Record<string, unknown>);
      if (draft.mode === 'new_mode') {
        saveLastNewModeTags(draft.tags);
      }
      const sig = draftSignature(draft);
      lastSavedRef.current = sig;
      setHasUnsavedChanges(false);
      return true;
    } catch (e: any) {
      setMessage(`途中保存エラー: ${e.message}`);
      return false;
    } finally {
      setDraftSaving(false);
    }
  }, [workspaceId, buildDraft]);

  const handleSaveDraftToDb = useCallback(async () => {
    const saved = await persistWorkspaceDraft();
    if (saved) {
      setMessage('下書きを途中保存しました（DB）');
    }
  }, [persistWorkspaceDraft]);

  const handleKeepWorkspaceAfterSave = useCallback(async () => {
    const saved = await persistWorkspaceDraft();
    if (!saved) return;
    setShowDeleteWsModal(false);
    navigate('/workspaces');
  }, [navigate, persistWorkspaceDraft]);

  const handleDeleteCurrentWorkspace = useCallback(async () => {
    if (!workspaceId) return;
    try {
      await deleteWorkspace(workspaceId);
      setShowDeleteWorkspaceConfirm(false);
      setMessage('下書きを削除しました');
      navigate('/workspaces');
    } catch (e: any) {
      setMessage(`下書き削除エラー: ${e.message}`);
    }
  }, [navigate, workspaceId]);

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
      setCanFlipTurn(isKifInput(text));
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
    setCanFlipTurn(isKifInput(text));
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

  const copyTextToClipboard = useCallback(async (text: string, label: string) => {
    if (!text) {
      setMessage(`${label}がありません`);
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('clipboard api unavailable');
      }
      setMessage(`${label}をコピーしました`);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      setMessage(ok ? `${label}をコピーしました` : `${label}のコピーに失敗しました`);
    }
  }, []);

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

      const registeredUsi = choices[slot].usi;
      const currentIntroMoveUsi = introMoveUsi.trim();
      const initialPrevDest = registeredUsi
        ? usiDestinationToBoardCoord(registeredUsi) ?? undefined
        : (currentIntroMoveUsi ? usiDestinationToBoardCoord(currentIntroMoveUsi) ?? undefined : undefined);
      const result = parseReadingLine(text, {
        initialPrevDest,
      });
      if (!result || result.moves.length === 0) {
        setReadingLineErrors((prev) => ({
          ...prev,
          [slot]: '読み筋を解析できませんでした。形式を確認してください。',
        }));
        return;
      }

      const firstMoveSide = result.labels.length > 0 ? markerSide(result.labels[0]) : null;
      const rootSide = parsed?.sideToMove ?? 'sente';

      // Support three formats:
      // 1) candidate move is included at the head of PV
      // 2) PV starts from the move after candidate (選択肢usiが既に登録されている場合)
      // 3) PV starts from the move after candidate かつ 選択肢usi未設定の場合 → 先頭手を自動採用
      //
      // 判定方針: 選択肢が登録済みなら先頭手がそのUSIと一致する場合のみ省く。
      // 未登録の場合は hand side の向きで判定（従来通り）。
      const includesChoiceMove = registeredUsi
        ? result.moves[0] === registeredUsi
        : firstMoveSide === rootSide;
      let choiceUsi = includesChoiceMove ? result.moves[0] : registeredUsi;
      let continuationMoves: string[];
      if (includesChoiceMove) {
        continuationMoves = result.moves.slice(1, 13);
      } else if (choiceUsi) {
        continuationMoves = result.moves.slice(0, 12);
      } else if (result.moves.length > 0) {
        // 自動で先頭手を選択肢usiに採用
        choiceUsi = result.moves[0];
        continuationMoves = result.moves.slice(1, 13);
      } else {
        setReadingLineErrors((prev) => ({
          ...prev,
          [slot]: 'この形式の読み筋は先に盤面で選択肢の手を登録してください',
        }));
        return;
      }
      const validationMoves = [
        ...(currentIntroMoveUsi ? [currentIntroMoveUsi] : []),
        choiceUsi,
        ...continuationMoves,
      ];
      const validation = validateMoveSequence(rootSfen, validationMoves);
      if (!validation.ok) {
        setReadingLineErrors((prev) => ({
          ...prev,
          [slot]: formatMoveValidationError('読み筋が非合法です', validation),
        }));
        return;
      }

      const board = parsed?.board;
      const side = parsed?.sideToMove ?? 'sente';
      const label = board ? usiToLabel(choiceUsi, board, side) : choiceUsi;

      let evalPercent: number | null = null;
      if (result.evalCp !== null) {
        try {
          evalPercent = cpToWinRatePercent({
            cp: result.evalCp,
            userColor: parsed?.sideToMove ?? 'sente',
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

      const lineLen = continuationMoves.length;
      const evalStr = result.evalCp !== null ? ` 評価値${result.evalCp}cp` : '';
      setMessage(`読み筋を登録しました（${lineLen}手${evalStr}）`);
    },
    [rootSfen, parsed, markerSide, choices, introMoveUsi],
  );


  // ---- Recalculate % from cp ----

  const handleRecalculatePercent = useCallback(
    (slot: SlotKey) => {
      const cp = choices[slot].eval_cp ?? (slot === 'correct' ? rootEvalCp : null);
      if (cp === null) return;
      try {
        const percent = cpToWinRatePercent({
          cp,
          userColor: parsed?.sideToMove ?? 'sente',
        });
        setChoices((prev) => ({
          ...prev,
          [slot]: { ...prev[slot], eval_percent: percent },
        }));
        if (slot === 'correct') setRootEvalPercent(percent);
        setMessage(`評価値 ${cp} を勝率 ${percent}% に変換しました`);
      } catch {
        setMessage('勝率への変換に失敗しました');
      }
    },
    [choices, parsed, rootEvalCp],
  );

  const performEvaluateChoice = useCallback(
    async (slot: SlotKey) => {
      if (!rootSfen) {
        setMessage('先に棋譜を読み込んでください');
        return;
      }

      const choice = choices[slot];
      if (!choice.usi) {
        setMessage('先に選択肢の手を登録してください');
        return;
      }

      const introMoves = introMoveUsi.trim() ? [introMoveUsi.trim()] : [];
      const validation = validateMoveSequence(rootSfen, [...introMoves, choice.usi]);
      if (!validation.ok) {
        setReadingLineErrors((prev) => ({
          ...prev,
          [slot]: formatMoveValidationError('検討する手が非合法です', validation),
        }));
        return;
      }

      setEvaluatingSlot(slot);
      setReadingLineErrors((prev) => ({ ...prev, [slot]: '' }));
      setMessage('');

      try {
        const choiceMoves = [...introMoves, choice.usi];
        const afterChoiceSfen = buildSfenAfterMoves(rootSfen, choiceMoves);
        const afterChoiceSide = parseSfen(afterChoiceSfen).sideToMove;
        const evaluatePayload = {
          sfen: rootSfen,
          moves: choiceMoves,
          options: {
            depth: CHOICE_EVAL_DEPTH,
            multipv: 1,
            usiOptions: {
              NumaPolicy: 'auto',
              Stochastic_Ponder: false,
              DepthLimit: 0,
              NodesLimit: 0,
              USI_AnalyseMode: true,
              USI_OwnBook: false,
            },
          },
        };
        console.log('[choice-eval] request', {
          slot,
          choiceUsi: choice.usi,
          positionCommand: `position sfen ${rootSfen} moves ${choiceMoves.join(' ')}`,
          afterChoiceSfen,
          ...evaluatePayload,
        });

        const result = await evaluatePosition(rootSfen, choiceMoves, {
          ...evaluatePayload.options,
        });
        console.log('[choice-eval] response', {
          slot,
          evalCpRawFromEngine: result.eval_cp,
          bestmove: result.bestmove,
          pv: result.pv,
          lines: result.lines,
          rawLines: result.rawLines,
        });

        const rawCp = normalizeCpToSentePerspective(
          result.eval_cp,
          afterChoiceSide,
        );
        const percent = cpToWinRatePercent({
          cp: rawCp,
          userColor: parsed?.sideToMove ?? 'sente',
        });
        const line = result.pv.slice(0, 13);
        const labels = pvToJapanese(line, afterChoiceSfen, line.length);
        const readingText = `*検討 depth ${CHOICE_EVAL_DEPTH} 評価値 ${rawCp} 読み筋 ${labels.join(' ')}`;
        console.log('[choice-eval] formatted', {
          slot,
          evalCpSente: rawCp,
          evalPercent: percent,
          displaySfen,
          afterChoiceSfen,
          rootSfen,
          introMoves,
          choiceMoves,
          choiceUsi: choice.usi,
          enginePv: result.pv,
          storedLine: line,
          labels,
          readingText,
        });

        setChoices((prev) => ({
          ...prev,
          [slot]: {
            ...prev[slot],
            eval_cp: rawCp,
            eval_percent: percent,
            line,
          },
        }));
        setReadingLineInputs((prev) => ({ ...prev, [slot]: readingText }));

        if (slot === 'correct') {
          setRootEvalCp(rawCp);
          setRootEvalPercent(percent);
        }

        setMessage(`${choice.label || choice.usi}をdepth${CHOICE_EVAL_DEPTH}で検討しました`);
      } catch (e: any) {
        setMessage(`検討エラー: ${e.message}`);
      } finally {
        setEvaluatingSlot(null);
      }
    },
    [choices, displaySfen, introMoveUsi, parsed, rootSfen],
  );

  const enqueueEvaluateChoice = useCallback((slot: SlotKey) => {
    if (!choices[slot].usi) {
      setMessage('先に選択肢の手を登録してください');
      return;
    }

    if (evaluatingSlot === slot) return;
    setEvalQueue((current) => (current.includes(slot) ? current : [...current, slot]));
  }, [choices, evaluatingSlot]);

  React.useEffect(() => {
    if (evaluatingSlot || evalQueue.length === 0) return;

    const [nextSlot] = evalQueue;
    if (!nextSlot) return;

    setEvalQueue((current) => current.slice(1));
    void performEvaluateChoice(nextSlot);
  }, [evalQueue, evaluatingSlot, performEvaluateChoice]);

  // ---- Move registration via board ----

  const clearBoardSelection = useCallback(() => {
    setSelectedCell(null);
    setIntroDestinationBoth(null);
    setSelectedHandPiece(null);
    setPromotionChoice(null);
  }, [setIntroDestinationBoth]);

  const handleRootSfenChange = useCallback((nextRootSfen: string) => {
    setRootSfen(nextRootSfen);
    // A manually edited position can no longer be reconstructed from the source KIF.
    setKifMoves([]);
  }, []);

  const handleActivateChoiceSlot = useCallback((slot: SlotKey) => {
    setActiveSlot((prev) => (prev === slot ? null : slot));
    setIntroMoveActive(false);
    clearBoardSelection();
  }, [clearBoardSelection]);

  const handleActivateIntroMove = useCallback(() => {
    setActiveSlot(null);
    setIntroMoveActive(true);
    setIntroDestinationBoth(null);
    clearBoardSelection();
  }, [clearBoardSelection, setIntroDestinationBoth]);

  const handleClearIntroMove = useCallback(() => {
    setIntroMoveUsi('');
    setIntroMoveActive(false);
    setIntroDestinationBoth(null);
    clearBoardSelection();
  }, [clearBoardSelection, setIntroDestinationBoth]);

  const registerIntroMove = useCallback((usi: string, newRootSfen?: string) => {
    setIntroMoveUsi(usi);
    if (newRootSfen) {
      setRootSfen(newRootSfen);
    }
    setIntroMoveActive(false);
    setIntroDestinationBoth(null);
    clearBoardSelection();
  }, [clearBoardSelection, setIntroDestinationBoth]);

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
      setIntroMoveActive(false);
      clearBoardSelection();
    },
    [activeSlot, parsed, clearBoardSelection],
  );

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (promotionChoice) return;

      if (introMoveActive) {
        const currentIntroDestination = introDestinationRef.current;
        if (!displayParsed || !searchParsed) return;

        const clickedSquareUsi = toUsiSquare(row, col);
        const clickedDisplayPiece = displayParsed.board[row][col];

        if (!currentIntroDestination) {
          if (!clickedDisplayPiece) {
            return;
          }
          setIntroDestinationBoth({ row, col });
          return;
        }

        if (currentIntroDestination.row === row && currentIntroDestination.col === col) {
          setIntroDestinationBoth(null);
          return;
        }

        const destination = currentIntroDestination;
        const destinationUsi = toUsiSquare(destination.row, destination.col);
        const sourceUsi = clickedSquareUsi;
        const destinationPieceDisplay = displayParsed.board[destination.row][destination.col];
        const destinationPieceSearch = searchParsed.board[destination.row][destination.col];
        const candidateIntroUsi = `${sourceUsi}${destinationUsi}`;

        const destinationPiece = destinationPieceSearch ?? destinationPieceDisplay;
        if (!destinationPiece) {
          return;
        }

        const beforeRoot = displayParsed;
        const beforeTurn = beforeRoot.sideToMove;
        const beforeMoveNumber = beforeRoot.moveNumber;
        const afterTurn = beforeTurn === 'sente' ? 'gote' : 'sente';
        const afterMoveNumber = Math.max(1, beforeMoveNumber - 1);

        const rewoundBoard = beforeRoot.board.map((line) => [...line]);
        const movedPiece = rewoundBoard[destination.row][destination.col];
        if (!movedPiece) {
          return;
        }

        rewoundBoard[row][col] = movedPiece;
        rewoundBoard[destination.row][destination.col] = null;

        const rewoundRootSfen = boardToSfen(
          rewoundBoard,
          afterTurn,
          beforeRoot.senteHand,
          beforeRoot.goteHand,
          afterMoveNumber,
        );

        registerIntroMove(candidateIntroUsi, rewoundRootSfen);
        return;
      }

      if (analysisMode) {
        // --- Analysis mode: move pieces on the store board ---
        const storeBoard = store.board;
        const storeSide = store.sideToMove;

        if (selectedHandPiece) {
          const validDrops = getValidDropSquares(storeBoard, storeSide, selectedHandPiece.type);
          if (!validDrops.some((s) => s.row === row && s.col === col)) {
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
        if (selectedCell.row === row && selectedCell.col === col) {
          setSelectedCell(null);
          return;
        }
        const targetPiece = storeBoard[row][col];
        if (targetPiece && targetPiece.side === storeSide) {
          setSelectedCell({ row, col });
          return;
        }

        const validMoves = getValidDestinations(storeBoard, selectedCell.row, selectedCell.col, storeSide);
        if (!validMoves.some((s) => s.row === row && s.col === col)) return;

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
            if (mustPromote) {
              store.applyMove(`${fromSq}${toSq}+`);
            } else {
              setPromotionChoice({ fromSq, toSq, pieceType: piece.type });
            }
            return;
          }
        }
        store.applyMove(`${fromSq}${toSq}`);
        return;
      }

      // --- Registration mode ---
      if (!parsed || !activeSlot) return;
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
    [analysisMode, store, parsed, activeSlot, selectedCell, selectedHandPiece, registerMove, promotionChoice, introMoveActive, registerIntroMove],
  );

  const handlePromotionSelect = useCallback(
    (promote: boolean) => {
      if (!promotionChoice) return;
      const usi = `${promotionChoice.fromSq}${promotionChoice.toSq}${promote ? '+' : ''}`;
      if (analysisMode) {
        store.applyMove(usi);
      } else if (introMoveActive) {
        registerIntroMove(usi);
      } else {
        registerMove(usi);
      }
      setPromotionChoice(null);
    },
    [promotionChoice, analysisMode, store, registerMove, introMoveActive, registerIntroMove],
  );

  const handleHandPieceClick = useCallback(
    (side: Side, type: HandPieceType) => {
      if (introMoveActive) {
        const destination = introDestinationRef.current ?? introDestination;
        if (!destination || !displayParsed) return;

        const previousSide = displayParsed.sideToMove === 'sente' ? 'gote' : 'sente';
        if (side !== previousSide) return;

        const rewoundBoard = displayParsed.board.map((line) => [...line]);
        rewoundBoard[destination.row][destination.col] = null;
        const senteHand = { ...displayParsed.senteHand };
        const goteHand = { ...displayParsed.goteHand };
        const previousHand = previousSide === 'sente' ? senteHand : goteHand;
        previousHand[type] = Math.min(99, previousHand[type] + 1);
        const rewoundRootSfen = boardToSfen(
          rewoundBoard,
          previousSide,
          senteHand,
          goteHand,
          Math.max(1, displayParsed.moveNumber - 1),
        );
        registerIntroMove(`${type}*${toUsiSquare(destination.row, destination.col)}`, rewoundRootSfen);
        return;
      }

      const currentSide = analysisMode ? store.sideToMove : parsed?.sideToMove;
      if (!currentSide || side !== currentSide) return;

      setSelectedCell(null);
      setSelectedHandPiece((prev) =>
        prev?.side === side && prev?.type === type ? null : { side, type },
      );
    },
    [analysisMode, store, parsed, introMoveActive, introDestination, displayParsed, registerIntroMove],
  );

  // ---- Field handlers ----

  const handleEvalCpChange = (slot: SlotKey, value: number | null) => {
    setChoices((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], eval_cp: value },
    }));
    if (slot === 'correct') setRootEvalCp(value);
  };
  const handleEvalPercentChange = (slot: SlotKey, value: number | null) => {
    setChoices((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], eval_percent: value },
    }));
    if (slot === 'correct') setRootEvalPercent(value);
  };
  const handleExplanationChange = (slot: SlotKey, text: string) => {
    setChoices((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], explanation: text },
    }));
  };
  const handleExplanationFocus = (slot: SlotKey) => {
    setKeyboardSlot(slot);
  };
  const handleExplanationBlur = (slot: SlotKey) => {
    void slot;
    window.requestAnimationFrame(() => {
      const focusedSlot = (Object.entries(explanationInputRefs.current) as Array<[SlotKey, HTMLTextAreaElement | null]>)
        .find(([, textarea]) => textarea === document.activeElement)?.[0] ?? null;
      // If user is dragging the keyboard, don't close it even if focus briefly leaves the textarea.
      if (focusedSlot !== null) {
        setKeyboardSlot(focusedSlot);
        return;
      }
      if (keyboardDragging) return;
      setKeyboardSlot(null);
    });
  };
  const handleKeyboardInsert = useCallback((text: string) => {
    if (!keyboardSlot) return;

    const textarea = explanationInputRefs.current[keyboardSlot];
    if (!textarea) return;

    const currentValue = choices[keyboardSlot].explanation;
    const start = textarea.selectionStart ?? currentValue.length;
    const end = textarea.selectionEnd ?? currentValue.length;
    const nextValue = `${currentValue.slice(0, start)}${text}${currentValue.slice(end)}`;

    handleExplanationChange(keyboardSlot, nextValue);

    window.requestAnimationFrame(() => {
      textarea.focus();
      const nextCaret = start + text.length;
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  }, [choices, keyboardSlot]);
  const handleKeyboardDelete = useCallback(() => {
    if (!keyboardSlot) return;

    const textarea = explanationInputRefs.current[keyboardSlot];
    if (!textarea) return;

    const currentValue = choices[keyboardSlot].explanation;
    const start = textarea.selectionStart ?? currentValue.length;
    const end = textarea.selectionEnd ?? currentValue.length;

    let nextValue = currentValue;
    let nextCaret = start;

    if (start !== end) {
      nextValue = `${currentValue.slice(0, start)}${currentValue.slice(end)}`;
      nextCaret = start;
    } else if (start > 0) {
      nextValue = `${currentValue.slice(0, start - 1)}${currentValue.slice(end)}`;
      nextCaret = start - 1;
    }

    handleExplanationChange(keyboardSlot, nextValue);

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  }, [choices, keyboardSlot]);
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
    if (!displaySfen || !parsed) {
      setMessage('先に棋譜または局面を読み込んでください');
      return;
    }

    const filledSlots = SLOT_ORDER.filter((slot) => choices[slot].usi);
    if (filledSlots.length === 0) {
      setMessage('選択肢を1つ以上設定してください');
      return;
    }

    const targetSlots = filledSlots.filter((slot) => !choices[slot].explanation.trim());
    if (targetSlots.length === 0) {
      setMessage('すべての選択肢に解説が入力済みです');
      return;
    }

    setGenerating(true);
    setMessage('');
    try {
      if (workspaceId) {
        const saved = await persistWorkspaceDraft();
        if (!saved) return;
      }

      const choiceData = targetSlots.map((slot) => {
        const choice = choices[slot];
        const fullPv = [choice.usi, ...choice.line].filter(Boolean);
        const labels = pvToJapanese(fullPv, displaySfen, fullPv.length);
        return {
          label: choice.label || labels[0] || choice.usi,
          eval_cp: choice.eval_cp,
          eval_percent: choice.eval_percent,
          line_labels: labels.slice(1).join(' '),
          is_correct: slot === 'correct',
        };
      });

      const results = await generateExplanations(displaySfen, parsed.sideToMove, choiceData);

      setChoices((prev) => {
        const next = { ...prev };
        results.forEach((result) => {
          const slot = targetSlots[result.index];
          if (!slot) return;
          next[slot] = {
            ...next[slot],
            explanation: withAiExplanationPrefix(result.explanation),
          };
        });
        return next;
      });
      setMessage(`解説を生成しました（${targetSlots.length}件）`);
    } catch (e: any) {
      setMessage(`解説生成エラー: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  }, [choices, displaySfen, parsed, persistWorkspaceDraft, workspaceId]);

  // ---- Validation ----

  const buildSaveRootAndIntro = useCallback((): {
    rootSfenForSave: string;
    introMovesUsi: string[];
    introMovesLabels: string[];
  } => {
    const effectiveIntroMove = introMoveUsi.trim() || (kifMoves.length > 0 ? kifMoves[kifMoves.length - 1] : '');

    if (introMoveUsi.trim()) {
      const introMoveLabel = parsed ? usiToLabel(introMoveUsi, parsed.board, parsed.sideToMove) : introMoveUsi;
      return {
        rootSfenForSave: rootSfen,
        introMovesUsi: [introMoveUsi],
        introMovesLabels: [introMoveLabel],
      };
    }

    if (kifMoves.length === 0) {
      if (!effectiveIntroMove) {
        return { rootSfenForSave: rootSfen, introMovesUsi: [], introMovesLabels: [] };
      }

      const introMoveLabel = parsed ? usiToLabel(effectiveIntroMove, parsed.board, parsed.sideToMove) : effectiveIntroMove;
      return {
        rootSfenForSave: rootSfen,
        introMovesUsi: [effectiveIntroMove],
        introMovesLabels: [introMoveLabel],
      };
    }

    const introMove = effectiveIntroMove;
    const baseMoves = kifMoves.slice(0, -1);

    const sourceSfen = deriveSourceSfen(kifText);
    const state = parseSfen(sourceSfen);
    let { board, senteHand, goteHand, sideToMove } = state;
    for (const usi of baseMoves) {
      const result = applyUsiMove(board, senteHand, goteHand, sideToMove, usi);
      board = result.board;
      senteHand = result.senteHand;
      goteHand = result.goteHand;
      sideToMove = sideToMove === 'sente' ? 'gote' : 'sente';
    }

    const introMoveLabel = usiToLabel(introMove, board, sideToMove);

    return {
      rootSfenForSave: boardToSfen(
        board,
        sideToMove,
        senteHand,
        goteHand,
        state.moveNumber + baseMoves.length,
      ),
      introMovesUsi: introMove ? [introMove] : [],
      introMovesLabels: introMove ? [introMoveLabel] : [],
    };
  }, [kifText, kifMoves, rootSfen, introMoveUsi, parsed]);

  const saveRootAndIntro = useMemo(() => buildSaveRootAndIntro(), [buildSaveRootAndIntro]);
  const introMovesUsiText = useMemo(
    () => JSON.stringify(saveRootAndIntro.introMovesUsi),
    [saveRootAndIntro.introMovesUsi],
  );
  const introMovesLabelText = useMemo(
    () => JSON.stringify(saveRootAndIntro.introMovesLabels),
    [saveRootAndIntro.introMovesLabels],
  );
  const selectedVisibleTagCount = useMemo(
    () => AVAILABLE_TAGS.filter((tag) => tags.includes(tag.value)).length,
    [tags],
  );
  const saveButtonLabel = useMemo(() => {
    const base = '思考モードで保存';
    return selectedVisibleTagCount === 0 ? `${base}(タグなし)` : base;
  }, [selectedVisibleTagCount]);

  const validate = ({ requireIncorrectChoices = true } = {}): string[] => {
    const errors: string[] = [];
    if (!rootSfen) errors.push('局面が読み込まれていません');
    if (!choices.correct.usi) errors.push('正解手が未設定です');
    if (requireIncorrectChoices && !choices.incorrect1.usi) errors.push('不正解手１が未設定です');
    if (requireIncorrectChoices && !choices.incorrect2.usi) errors.push('不正解手２が未設定です');
    const usis = [choices.correct.usi, choices.incorrect1.usi, choices.incorrect2.usi].filter(
      Boolean,
    );
    if (new Set(usis).size !== usis.length) errors.push('候補手が重複しています');
    return errors;
  };

  // ---- Save Branches ----

  const handleSaveBranches = async () => {
    // Validate that KIF has been parsed with branches
    if (kifBranches.length < 2) {
      setMessage('分岐がありません。KIF棋譜を貼り付けて解析してください。');
      return;
    }

    setSavingBranches(true);
    setMessage('');
    try {
      // Parse branches and extract problem data
      const branchResult = parseKifRecordWithBranches(kifText);
      if (!branchResult || branchResult.branches.length < 2) {
        setMessage('分岐の解析に失敗しました。');
        setSavingBranches(false);
        return;
      }

      const branchProblems = extractBranchProblems(branchResult);
      if (branchProblems.length === 0) {
        setMessage('問題として作成可能な分岐がありません（各分岐は2手以上必要です）。');
        setSavingBranches(false);
        return;
      }

      // Convert to save format with incorrect moves generated from legal moves
      const problemsToSave = branchProblems.map((bp) => {
        const rootParsed = parseSfen(bp.rootSfen);
        let incorrectMove1 = '';
        let incorrectMove1Label = '';
        let incorrectMove2 = '';
        let incorrectMove2Label = '';

        // Collect legal moves (excluding the correct move)
        const incorrectMoves: Array<{ usi: string; label: string }> = [];
        
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            const piece = rootParsed.board[r][c];
            if (piece && piece.side === rootParsed.sideToMove) {
              const validDests = getValidDestinations(rootParsed.board, r, c, rootParsed.sideToMove);
              for (const dest of validDests) {
                const usi = `${toUsiSquare(r, c)}${toUsiSquare(dest.row, dest.col)}`;
                if (usi !== bp.correctMove) {
                  const label = usiToLabel(usi, rootParsed.board, rootParsed.sideToMove);
                  incorrectMoves.push({ usi, label });
                }
              }
            }
          }
        }

        // Select up to 2 incorrect moves
        if (incorrectMoves.length > 0) {
          incorrectMove1 = incorrectMoves[0].usi;
          incorrectMove1Label = incorrectMoves[0].label;
        }
        if (incorrectMoves.length > 1) {
          incorrectMove2 = incorrectMoves[1].usi;
          incorrectMove2Label = incorrectMoves[1].label;
        }

        return {
          prompt: prompt.trim() || DEFAULT_PROMPT,
          rootSfen: bp.rootSfen,
          correctMove: bp.correctMove,
          correctMoveLabel: bp.correctMoveLabel,
          introMovesUsi: bp.introMovesUsi,
          problemRating: problemRating,
          tags: tags.length > 0 ? tags : null,
          incorrectMove1,
          incorrectMove1Label,
          incorrectMove2,
          incorrectMove2Label,
        };
      });

      // Save all problems
      const results = await saveMultipleProblems(problemsToSave);
      setMessage(`${results.length}個の問題を保存しました（分岐: ${branchProblems.length}個）`);

      // Show delete-workspace modal if opened from workspace
      if (workspaceId) {
        setShowDeleteWsModal(true);
      }
    } catch (e: any) {
      setMessage(`分岐の一括保存エラー: ${e.message}`);
    } finally {
      setSavingBranches(false);
    }
  };

  // ---- Save ----

  const handleSave = async () => {
    const errors = validate();
    if (errors.length > 0) {
      setMessage(errors.join('\n'));
      return;
    }

    // Ensure UI reflects that user chose next-move save
    setPreferredSaveMode('next_move');

    setSaving(true);
    setMessage('');
    try {
      const randomizedOrder = shuffledSlots();
      const choiceIdBySlot: Record<SlotKey, number> = {
        correct: randomizedOrder.indexOf('correct') + 1,
        incorrect1: randomizedOrder.indexOf('incorrect1') + 1,
        incorrect2: randomizedOrder.indexOf('incorrect2') + 1,
      };

      const { rootSfenForSave, introMovesUsi } = buildSaveRootAndIntro();
      // Always use correct choice's eval for root_eval_cp/percent
      const correctEvalCp = choices.correct.eval_cp;
      const correctEvalPercent = choices.correct.eval_percent;
      const problem = {
        prompt: prompt.trim() || DEFAULT_PROMPT,
        root_sfen: rootSfenForSave,
        correct_choice_id: choiceIdBySlot.correct,
        intro_moves_usi: introMovesUsi,
        source_run_id: null,
        root_eval_cp: correctEvalCp,
        root_eval_percent: correctEvalPercent,
        problem_rating: problemRating,
        problem_rating_games: 0,
        // Let the server allocate a unique display_no to avoid conflicts
        display_no: null,
        tags: tags.length > 0 ? tags : null,
      };

      const choiceData = [
        {
          choice_id: choiceIdBySlot.correct,
          ...pickChoiceFields(choices.correct),
        },
        {
          choice_id: choiceIdBySlot.incorrect1,
          ...pickChoiceFields(choices.incorrect1),
        },
        {
          choice_id: choiceIdBySlot.incorrect2,
          ...pickChoiceFields(choices.incorrect2),
        },
      ];

      const { problemId } = await saveProblem(problem, choiceData);
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

  const handleRegisterJoseki = async () => {
    // Register only to problems table as joseki
    // Reuse same save data construction as handleSave
    // Ensure UI reflects that user chose joseki save
    setPreferredSaveMode('joseki');
    setJosekiSaveWarning('');
    setRegisteringJoseki(true);
    setMessage('');
    try {
      const randomizedOrder = shuffledSlots();
      const choiceIdBySlot: Record<SlotKey, number> = {
        correct: randomizedOrder.indexOf('correct') + 1,
        incorrect1: randomizedOrder.indexOf('incorrect1') + 1,
        incorrect2: randomizedOrder.indexOf('incorrect2') + 1,
      };

      const { rootSfenForSave, introMovesUsi } = buildSaveRootAndIntro();
      if (introMovesUsi.length === 0) {
        setJosekiSaveWarning('定跡モードでは初手を1手以上入れてください');
        return;
      }
      const correctEvalCp = choices.correct.eval_cp;
      const correctEvalPercent = choices.correct.eval_percent;

      const problem = {
        prompt: prompt.trim() || DEFAULT_PROMPT,
        root_sfen: rootSfenForSave,
        correct_choice_id: choiceIdBySlot.correct,
        intro_moves_usi: introMovesUsi,
        source_run_id: null,
        root_eval_cp: correctEvalCp,
        root_eval_percent: correctEvalPercent,
        problem_rating: problemRating,
        problem_rating_games: 0,
        display_no: null,
        tags: tags.length > 0 ? tags : null,
        mode: 'joseki' as const,
      };

      const choiceData = [
        {
          choice_id: choiceIdBySlot.correct,
          ...pickChoiceFields(choices.correct),
        },
        {
          choice_id: choiceIdBySlot.incorrect1,
          ...pickChoiceFields(choices.incorrect1),
        },
        {
          choice_id: choiceIdBySlot.incorrect2,
          ...pickChoiceFields(choices.incorrect2),
        },
      ];

      const { problemId } = await saveLearningProblem(problem as any, choiceData as any);
      setSavedProblemId(problemId);
      setMessage(`定跡として登録しました (problem_id: ${problemId})`);

      // Show delete-workspace modal if opened from workspace
      if (workspaceId) setShowDeleteWsModal(true);
    } catch (e: any) {
      setMessage(`定跡登録エラー: ${e.message}`);
    } finally {
      setRegisteringJoseki(false);
    }
  };

  const handleSaveNewModeDraft = async () => {
    if (!workspaceId) {
      setMessage('下書きを開いたときだけ新モードで保存できます');
      return;
    }

    const errors = validate({ requireIncorrectChoices: false });
    if (errors.length > 0) {
      setMessage(errors.join('\n'));
      return;
    }

    const { rootSfenForSave, introMovesUsi } = buildSaveRootAndIntro();
    const warnings: string[] = [];
    if (introMovesUsi.length === 0) {
      warnings.push('intro が未入力です。新モードで保存するには初手を1手以上入れてください。');
    }

    try {
      const duplicate = await findNewModeDraftByRootSfenAndIntro(rootSfenForSave, introMovesUsi, workspaceId);
      if (duplicate) {
        const displayNo = duplicate.displayNo == null ? '-' : String(duplicate.displayNo);
        warnings.push(
          `同じ root_sfen と intro の新モード問題がすでにあります（ID: ${duplicate.id}, No: ${displayNo}）。`,
        );
      }
    } catch (e: any) {
      setMessage(`新モード保存前チェックエラー: ${e.message}`);
      return;
    }

    if (warnings.length > 0) {
      setNewModeSaveWarnings(warnings);
      return;
    }

    setPreferredSaveMode('new_mode');
    setSavingNewMode(true);
    setMessage('');

    try {
      const correctEvalCp = choices.correct.eval_cp;
      const correctEvalPercent = choices.correct.eval_percent;
      const draft: PasteDraft = {
        ...buildDraft(),
        rootSfen: rootSfenForSave,
        introMoveUsi: introMovesUsi[introMovesUsi.length - 1] ?? '',
        kifMoves: [],
        prompt: prompt.trim() || DEFAULT_PROMPT,
        rootEvalCp: correctEvalCp,
        rootEvalPercent: correctEvalPercent,
        mode: 'new_mode',
        savedAt: new Date().toISOString(),
      };

      await saveWorkspaceDraft(workspaceId, draft as unknown as Record<string, unknown>);
      saveLastNewModeTags(draft.tags);
      lastSavedRef.current = draftSignature(draft);
      setHasUnsavedChanges(false);
      setSavedProblemId(null);
      setMessage('新モードとして下書きDBに保存しました');
      setShowDeleteWsModal(true);
    } catch (e: any) {
      setMessage(`新モード保存エラー: ${e.message}`);
    } finally {
      setSavingNewMode(false);
    }
  };

  // ========================================
  // Render
  // ========================================

  const imagePositionMemo = imagePositionSource?.memo?.trim() ?? '';
  const imagePositionFileName = imagePositionSource?.fileName?.trim() ?? '';
  const choiceLineErrors = SLOT_ORDER.reduce<Record<SlotKey, string>>((acc, slot) => {
    const draft = choices[slot];
    const introMoves = introMoveUsi.trim() ? [introMoveUsi.trim()] : [];
    if (!rootSfen || !draft.usi) {
      acc[slot] = '';
      return acc;
    }
    const moves = [...introMoves, ...buildReplayLine(draft)];
    const validation = validateMoveSequence(rootSfen, moves);
    acc[slot] = validation.ok ? '' : formatMoveValidationError('読み筋が非合法です', validation);
    return acc;
  }, { correct: '', incorrect1: '', incorrect2: '' });
  const mobileAnalysisLine = sortedBoardAnalysisLines[0] ?? null;
  const mobileAnalysisLabels = mobileAnalysisLine && boardAnalysisTargetSfen
    ? pvToJapanese(mobileAnalysisLine.pv, boardAnalysisTargetSfen, 4)
    : [];
  const mobileAnalysisValue = mobileAnalysisLine
    ? mobileAnalysisLine.mate !== null
      ? `詰${mobileAnalysisLine.mate * boardAnalysisSenteSign}`
      : `${mobileAnalysisLine.eval_cp * boardAnalysisSenteSign > 0 ? '+' : ''}${mobileAnalysisLine.eval_cp * boardAnalysisSenteSign}`
    : null;

  return (
    <>
      {mobileMode && mobileExplanationMode && mobileReplayPosition && (
        <MobileExplanationEditor
          board={mobileReplayPosition.board}
          senteHand={mobileReplayPosition.senteHand}
          goteHand={mobileReplayPosition.goteHand}
          sideToMove={mobileReplayPosition.sideToMove}
          title={`${SLOT_LABELS[mobileSlot]} ${mobileChoice.label || ''}`.trim()}
          value={mobileChoice.explanation}
          onChange={(value) => handleExplanationChange(mobileSlot, value)}
          onDone={() => setMobileExplanationMode(false)}
        />
      )}

      {mobileMode && !mobileExplanationMode && (
        <div className="mobile-draft-editor">
          <div className="mobile-problem-heading">
            <div className="mobile-prompt-row">
              <span>問題 {displayNo != null ? String(displayNo).padStart(2, '0') : '--'}</span>
              <input
                type="text"
                aria-label="問題文"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={DEFAULT_PROMPT}
                className="mobile-prompt-input"
              />
              <label className="mobile-header-rating">
                <span>レート</span>
                <select
                  aria-label="問題レート"
                  value={problemRating}
                  onChange={(event) => setProblemRating(Number(event.target.value))}
                >
                  {Array.from({ length: 11 }, (_, index) => 1000 + index * 100).map((rating) => (
                    <option key={rating} value={rating}>{rating}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mobile-status-row">
              <span>{workspaceName ?? '新規問題'}</span>
              <span className={hasUnsavedChanges ? 'is-unsaved' : 'is-saved'}>
                {hasUnsavedChanges ? '未保存' : '保存済み'}
              </span>
              <span>
                {introMoveActive
                  ? '初手を登録中'
                  : mobileReplayStep > 0
                    ? `読み筋 ${mobileReplayStep}/${mobileReplayMoves.length}`
                    : `${SLOT_LABELS[mobileSlot]}を編集中`}
              </span>
            </div>
          </div>

          <div className="mobile-choice-focus">
            <div>
              <span>{SLOT_LABELS[mobileSlot]}</span>
              <strong>{mobileChoice.label || '盤面で候補手を選択'}</strong>
              {mobileEvalCp !== null && <small>評価値 {mobileEvalCp}</small>}
            </div>
          </div>

          <section className="mobile-board-section">
            {mobileReplayPosition ? (
              <Board
                mobile
                board={mobileReplayPosition.board}
                senteHand={mobileReplayPosition.senteHand}
                goteHand={mobileReplayPosition.goteHand}
                sideToMove={mobileReplayPosition.sideToMove}
                selectedCell={mobileReplayStep === 0 ? (introMoveActive ? introDestination : selectedCell) : null}
                selectedHandPiece={mobileReplayStep === 0 ? selectedHandPiece : null}
                arrows={mobileReplayStep === 0 ? arrows : []}
                showAllHandPieces={introMoveActive && !!introDestination}
                onCellClick={mobileReplayStep === 0 ? handleCellClick : undefined}
                onHandPieceClick={mobileReplayStep === 0 ? handleHandPieceClick : undefined}
                mobileBottomControls={
                  <>
                    <button
                      type="button"
                      onClick={() => setMobileReplayStep(0)}
                      disabled={mobileReplayStep === 0}
                      aria-label="読み筋の先頭へ"
                    >
                      |◀
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobileReplayStep((current) => Math.max(0, current - 1))}
                      disabled={mobileReplayStep === 0}
                      aria-label="読み筋を一手戻る"
                    >
                      ◀
                    </button>
                    <span className="mobile-replay-position">
                      {mobileReplayStep} / {mobileReplayMoves.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setMobileReplayStep((current) => Math.min(mobileReplayMoves.length, current + 1))}
                      disabled={mobileReplayStep >= mobileReplayMoves.length}
                      aria-label="読み筋を一手進む"
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobileReplayStep(mobileReplayMoves.length)}
                      disabled={mobileReplayStep >= mobileReplayMoves.length}
                      aria-label="読み筋の最後へ"
                    >
                      ▶|
                    </button>
                  </>
                }
              />
            ) : (
              <div className="mobile-empty-board">局面がありません</div>
            )}

            {promotionChoice && parsed && (
              <div className="mobile-promotion-row">
                <span>成りますか？</span>
                <button type="button" onClick={() => handlePromotionSelect(false)}>
                  {pieceKanji({ type: promotionChoice.pieceType, side: parsed.sideToMove, promoted: false })}
                </button>
                <button type="button" className="text-rose-700" onClick={() => handlePromotionSelect(true)}>
                  {pieceKanji({ type: promotionChoice.pieceType, side: parsed.sideToMove, promoted: true })}
                </button>
              </div>
            )}

          </section>

          <section className="mobile-choice-editor">
            <textarea
              ref={mobileExplanationRef}
              readOnly
              value={mobileChoice.explanation}
              onClick={() => setMobileExplanationMode(true)}
              placeholder="タップして解説・メモを入力"
              rows={2}
            />
            <div className="mobile-choice-tabs">
              {SLOT_ORDER.map((slot, index) => (
                <button
                  key={slot}
                  type="button"
                  className={activeSlot === slot ? 'is-active' : ''}
                  onClick={() => {
                    if (activeSlot !== slot) handleActivateChoiceSlot(slot);
                  }}
                >
                  <span>{index + 1}</span>
                  {slot === 'correct' && <small>✓</small>}
                </button>
              ))}
            </div>
          </section>

          <section className="mobile-position-fields">
            <div className={`mobile-intro-field ${introMoveActive ? 'is-active' : ''}`}>
              <button type="button" onClick={handleActivateIntroMove}>
                <span>初手</span>
                <strong>
                  {introMoveUsi && searchParsed
                    ? usiToLabel(introMoveUsi, searchParsed.board, searchParsed.sideToMove)
                    : '登録'}
                </strong>
              </button>
              {introMoveUsi && (
                <button type="button" className="mobile-intro-clear" onClick={handleClearIntroMove} aria-label="初手をクリア">
                  ×
                </button>
              )}
            </div>
            <label>
              <span>評価値</span>
              <input
                type="number"
                value={mobileEvalCp ?? ''}
                onChange={(event) => handleEvalCpChange(
                  mobileSlot,
                  event.target.value === '' ? null : Number(event.target.value),
                )}
              />
            </label>
            <label className="mobile-win-rate-field">
              <span>勝率</span>
              <input
                type="number"
                min={0}
                max={100}
                value={mobileChoice.eval_percent ?? ''}
                onChange={(event) => handleEvalPercentChange(
                  mobileSlot,
                  event.target.value === '' ? null : Number(event.target.value),
                )}
              />
              <button
                type="button"
                onClick={() => handleRecalculatePercent(mobileSlot)}
                disabled={mobileEvalCp === null}
                aria-label="評価値から勝率を再計算"
              >
                %
              </button>
            </label>
          </section>

          <section className="mobile-analysis-row">
            <button
              type="button"
              onClick={toggleBoardAnalysis}
              className={boardAnalyzing ? 'is-stopping' : ''}
              disabled={!parsed}
            >
              {boardAnalyzing ? '検討停止' : '検討'}
            </button>
            <div className="mobile-analysis-result">
              {boardAnalysisError ? (
                <span className="text-rose-700">{boardAnalysisError}</span>
              ) : mobileAnalysisLine ? (
                <>
                  <strong>評価値 {mobileAnalysisValue}</strong>
                  <span>最善手 {mobileAnalysisLabels[0] ?? '-'}</span>
                  <span>depth {boardAnalysisDepth}</span>
                </>
              ) : (
                <span>{boardAnalyzing ? `検討中 depth ${boardAnalysisDepth}` : '未検討'}</span>
              )}
            </div>
          </section>

          <details className="mobile-detail-settings" open>
            <summary>問題情報・詳細設定</summary>
            <div className="mobile-detail-settings-body">
              <label>
                問題番号
                <input
                  type="number"
                  value={displayNo ?? ''}
                  onChange={(event) => setDisplayNo(event.target.value ? Number(event.target.value) : null)}
                />
              </label>
              {introMoveError && <div className="text-[11px] text-rose-700">{introMoveError}</div>}
              <label>
                root_sfen
                <textarea
                  value={rootSfen}
                  onChange={(event) => handleRootSfenChange(event.target.value)}
                  className="font-mono"
                  rows={3}
                />
              </label>
              <button
                type="button"
                onClick={() => setIsPositionEditing((current) => !current)}
                disabled={!rootSfen}
              >
                {isPositionEditing ? '局面編集を閉じる' : '局面を編集'}
              </button>
              {isPositionEditing && (
                <PositionEditor rootSfen={rootSfen} onChange={handleRootSfenChange} />
              )}
              {preferredSaveMode === 'new_mode' ? (
                <NewModeTagSelector selected={tags} onChange={setTags} />
              ) : (
                <TagSelector selected={tags} onChange={setTags} defaultExpanded />
              )}
            </div>
          </details>

          {message && (
            <div className={`mobile-message ${message.includes('エラー') ? 'is-error' : ''}`}>
              {message}
            </div>
          )}

          <div className="mobile-save-bar">
            <button
              type="button"
              className="is-delete"
              onClick={() => setShowDeleteWorkspaceConfirm(true)}
              disabled={!workspaceId}
            >
              削除
            </button>
            <button type="button" className="is-joseki" onClick={handleRegisterJoseki} disabled={registeringJoseki}>
              {registeringJoseki ? '保存中...' : '定跡保存'}
            </button>
            <button type="button" className="is-thinking" onClick={handleSaveNewModeDraft} disabled={!workspaceId || savingNewMode}>
              {savingNewMode ? '保存中...' : '新モード'}
            </button>
            <button type="button" className="is-thinking" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '思考保存'}
            </button>
            <button type="button" className="is-draft" onClick={handleSaveDraftToDb} disabled={!workspaceId || draftSaving}>
              {draftSaving ? '保存中...' : '途中'}
            </button>
          </div>
        </div>
      )}

      {!mobileMode && (
      <div className="flex h-[calc(100vh-106px)] min-h-[680px] w-full flex-col overflow-auto rounded-xl border border-sky-200/80 bg-gradient-to-br from-sky-50 via-blue-50 to-cyan-50 shadow-sm xl:overflow-hidden">
        <div className="shrink-0 border-b border-sky-200/75 bg-white/70 px-4 py-3 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900">
                問題作成（貼付）
                {workspaceName && (
                  <span className="ml-2 text-[13px] font-normal text-sky-700">
                    {workspaceName}
                  </span>
                )}
              </h2>
            </div>
            {message && (
              <div
                className={`max-w-[720px] rounded-lg border px-3 py-2 text-[12px] shadow-sm ${
                  message.includes('エラー')
                    ? 'border-rose-200 bg-rose-50 text-rose-700'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                }`}
              >
                {message}
              </div>
            )}
          </div>
        </div>

        {imagePositionMemo && (
          <div className="mx-4 mt-3 shrink-0 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-800">
              <span>画像メモ</span>
              {imagePositionFileName && (
                <span className="min-w-0 truncate text-[10px] font-normal text-amber-700">
                  {imagePositionFileName}
                </span>
              )}
            </div>
            <div className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-700">
              {imagePositionMemo}
            </div>
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-4 xl:grid-cols-[minmax(390px,430px)_minmax(460px,1fr)_minmax(270px,320px)] xl:grid-rows-[auto_minmax(0,1fr)]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-sky-200/80 bg-white/75 p-3 shadow-sm backdrop-blur-sm xl:row-span-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">盤面</div>
              <div className="flex flex-wrap items-center justify-end gap-1.5 text-[11px] text-slate-500">
                {parsed && (
                  <>
                    <span className="rounded-full bg-sky-50 px-2 py-[2px] text-sky-700 ring-1 ring-sky-200">
                      {parsed.sideToMove === 'sente' ? '☗先手' : '☖後手'}
                    </span>
                    {rootEvalCp !== null && (
                      <span className="rounded-full bg-white/80 px-2 py-[2px] ring-1 ring-sky-100">
                        {rootEvalCp}cp ({rootEvalPercent}%)
                      </span>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className={`h-7 rounded-lg px-2.5 text-[11px] font-semibold ${
                    isPositionEditing
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'border-sky-200 bg-white text-sky-700 hover:bg-sky-50'
                  }`}
                  onClick={() => {
                    clearBoardSelection();
                    setIntroMoveActive(false);
                    setActiveSlot(null);
                    setAnalysisMode(false);
                    setIsPositionEditing((current) => !current);
                  }}
                  disabled={!rootSfen}
                >
                  {isPositionEditing ? '編集を終了' : '局面を編集'}
                </button>
              </div>
            </div>
            <div className="min-h-0 overflow-y-auto pr-1">
              {isPositionEditing ? (
                <PositionEditor rootSfen={rootSfen} onChange={handleRootSfenChange} />
              ) : parsed ? (
                <div className="flex justify-center rounded-lg border border-sky-100 bg-sky-50/50 py-3">
                  <div
                    className="shrink-0 overflow-hidden"
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
                        selectedCell={introMoveActive ? introDestination : selectedCell}
                        showAllHandPieces={introMoveActive && !!introDestination}
                        onCellClick={handleCellClick}
                        onHandPieceClick={handleHandPieceClick}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-sky-100 bg-white/80 px-3 py-2 text-[12px] text-slate-400">
                  局面がありません
                </div>
              )}

              {parsed && !isPositionEditing && (
                <div className="mt-2 rounded-lg border border-sky-100 bg-white/85 px-2.5 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleBoardAnalysis}
                      className={`h-8 rounded-lg px-3 text-[12px] font-semibold ${
                        boardAnalyzing
                          ? 'border-rose-500 bg-rose-600 text-white hover:bg-rose-700'
                          : 'border-teal-600 bg-teal-600 text-white hover:bg-teal-700'
                      }`}
                    >
                      {boardAnalyzing ? '検討停止' : '検討'}
                    </button>
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                      MP
                      <select
                        value={boardAnalysisMp}
                        onChange={(e) => setBoardAnalysisMp(Number(e.target.value))}
                        disabled={boardAnalyzing}
                        className="h-8 rounded-lg border-sky-200 bg-white px-2 text-[12px] font-semibold text-slate-800"
                      >
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                      </select>
                    </label>
                    {(boardAnalyzing || boardAnalysisDepth > 0) && (
                      <span className="text-[11px] text-slate-500">
                        depth {Math.min(boardAnalysisDepth, BOARD_ANALYSIS_MAX_DEPTH)} / {BOARD_ANALYSIS_MAX_DEPTH}
                      </span>
                    )}
                  </div>

                  {boardAnalysisError && (
                    <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
                      {boardAnalysisError}
                    </div>
                  )}

                  {boardAnalyzing && boardAnalysisDepth < BOARD_ANALYSIS_MIN_DISPLAY_DEPTH && !boardAnalysisError && (
                    <div className="mt-2 text-[12px] text-slate-500">
                      検討中です
                    </div>
                  )}

                  {sortedBoardAnalysisLines.length > 0 && displaySfen && (
                    <div className="mt-2 max-h-40 overflow-y-auto">
                      <table className="w-full table-fixed border-collapse text-[11px]">
                        <thead>
                          <tr className="text-slate-500">
                            <th className="w-16 border-b border-sky-100 px-1.5 py-1 text-left font-semibold">評価値</th>
                            <th className="w-20 border-b border-sky-100 px-1.5 py-1 text-left font-semibold">ラベル</th>
                            <th className="border-b border-sky-100 px-1.5 py-1 text-left font-semibold">読み筋label</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedBoardAnalysisLines.map((line) => {
                            const labels = pvToJapanese(line.pv, displaySfen, 10);
                            const displayCp = line.eval_cp * boardAnalysisSenteSign;
                            const displayMate = line.mate !== null ? line.mate * boardAnalysisSenteSign : null;
                            return (
                              <tr key={line.multipv} className={line.multipv === 1 ? 'bg-amber-50/70' : ''}>
                                <td className="border-b border-sky-50 px-1.5 py-1 align-top font-mono">
                                  {displayMate !== null
                                    ? `詰${displayMate > 0 ? '+' : ''}${displayMate}`
                                    : String(displayCp)}
                                </td>
                                <td className="border-b border-sky-50 px-1.5 py-1 align-top font-semibold text-slate-800">
                                  {labels[0] ?? '-'}
                                </td>
                                <td className="max-w-0 border-b border-sky-50 px-1.5 py-1 align-top">
                                  <div className="overflow-x-auto whitespace-nowrap">
                                    {labels.join(' ')}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {parsed && !isPositionEditing && (selectedHandPiece || promotionChoice) && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  {selectedHandPiece && (
                    <span className="rounded-full bg-sky-100 px-2 py-1 font-semibold text-sky-700">
                      打: {selectedHandPiece.type}
                    </span>
                  )}
                  {promotionChoice && (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[12px] font-semibold text-amber-900">
                      <span>成?</span>
                      <button
                        className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-slate-300 bg-white text-xl font-bold hover:border-sky-500 hover:bg-sky-50"
                        onClick={() => handlePromotionSelect(false)}
                      >
                        {pieceKanji({
                          type: promotionChoice.pieceType,
                          side: parsed.sideToMove,
                          promoted: false,
                        })}
                      </button>
                      <button
                        className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-slate-300 bg-white text-xl font-bold text-rose-700 hover:border-sky-500 hover:bg-sky-50"
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
                </div>
              )}

              <div className="mt-3 grid gap-2">
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-slate-500">
                  問題文
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="h-9 rounded-lg border-sky-200 bg-white/90 text-[13px] normal-case text-slate-900"
                  />
                </label>

                <div className="grid gap-1">
                  <div className="text-[11px] font-semibold uppercase text-slate-500">レート</div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {Array.from({ length: 8 }, (_, i) => 1200 + i * 100).map((rating) => {
                      const selected = problemRating === rating;
                      return (
                        <button
                          key={rating}
                          type="button"
                          onClick={() => setProblemRating(rating)}
                          className={`h-6 rounded-lg px-1 text-[10px] font-semibold ${
                            selected
                              ? 'border-sky-500 bg-sky-500 text-white shadow-sm'
                              : 'border-sky-200 bg-white/90 text-slate-700 hover:bg-sky-50'
                          }`}
                        >
                          {rating}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </section>
            <div className="rounded-xl border border-sky-200/80 bg-white/75 px-3 py-2 shadow-sm backdrop-blur-sm xl:col-span-2">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 font-semibold uppercase text-slate-500">
                      root_sfen
                    </span>

                    <button
                      type="button"
                      className="h-7 shrink-0 rounded-lg border border-sky-200 bg-sky-50 px-3 text-[11px] font-semibold text-sky-700 hover:bg-sky-100"
                      onClick={() => copyTextToClipboard(rootSfen, 'root_sfen')}
                    >
                      コピー
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="shrink-0 font-semibold uppercase text-slate-500">
                      intro_moves
                    </span>

                    <button
                      type="button"
                      className="h-7 shrink-0 rounded-lg border border-sky-200 bg-sky-50 px-3 text-[11px] font-semibold text-sky-700 hover:bg-sky-100"
                      onClick={() => copyTextToClipboard(introMovesLabelText, 'intro_moves_usi')}
                    >
                      コピー
                    </button>
                  </div>
                </div>

                <div className="min-w-[360px] max-w-[430px] flex-1 xl:ml-auto">
                  <PasteIntroMoveCard
                    draftUsi={introMoveUsi}
                    draftLabel={
                      introMoveUsi && searchParsed
                        ? usiToLabel(introMoveUsi, searchParsed.board, searchParsed.sideToMove)
                        : ''
                    }
                    isActive={introMoveActive}
                    compact
                    error={introMoveError}
                    onActivate={handleActivateIntroMove}
                    onClear={handleClearIntroMove}
                  />
                </div>
              </div>
            </div>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-sky-200/80 bg-white/75 p-3 shadow-sm backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">選択肢</div>
              {(evaluatingSlot || evalQueue.length > 0) && (
                <div className="min-w-0 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] text-teal-900">
                  <span className="font-semibold">検討</span>
                  {evaluatingSlot && <span className="ml-1">実行中: {SLOT_LABELS[evaluatingSlot]}</span>}
                  {evalQueue.length > 0 && <span className="ml-1">待機: {evalQueue.length}</span>}
                </div>
              )}
            </div>
            <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
              {(['correct', 'incorrect1', 'incorrect2'] as SlotKey[]).map((slot) => (
                <PasteChoiceCard
                  key={slot}
                  slot={slot}
                  draft={choices[slot]}
                  isActive={activeSlot === slot}
                  readingLineInput={readingLineInputs[slot]}
                  readingLineError={readingLineErrors[slot] || choiceLineErrors[slot]}
                  onActivate={() => handleActivateChoiceSlot(slot)}
                  onReadingLineChange={(text) =>
                    setReadingLineInputs((prev) => ({ ...prev, [slot]: text }))
                  }
                  onPasteReadingLine={(text) => handleParseReadingLine(slot, text)}
                  onEvaluate={() => enqueueEvaluateChoice(slot)}
                  evalLoading={evaluatingSlot === slot}
                  evalQueued={evalQueue.includes(slot)}
                  onEvalCpChange={(value) => handleEvalCpChange(slot, value)}
                  onEvalPercentChange={(value) => handleEvalPercentChange(slot, value)}
                  onRecalculatePercent={() => handleRecalculatePercent(slot)}
                  onExplanationChange={(text) => handleExplanationChange(slot, text)}
                  onExplanationFocus={() => handleExplanationFocus(slot)}
                  onExplanationBlur={() => handleExplanationBlur(slot)}
                  explanationRef={(element) => {
                    explanationInputRefs.current[slot] = element;
                  }}
                  onClear={() => handleClearSlot(slot)}
                  onShowReplay={() => setReplaySlot(slot)}
                  replayDisabled={Boolean(choiceLineErrors[slot])}
                />
              ))}
            </div>
          </section>

          <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-sky-200/80 bg-white/75 p-3 shadow-sm backdrop-blur-sm">
            <div className="min-h-0 overflow-y-auto pr-1">
              {preferredSaveMode === 'new_mode' ? (
                <NewModeTagSelector selected={tags} onChange={setTags} />
              ) : (
                <TagSelector selected={tags} onChange={setTags} />
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                {workspaceId && (
                  <button
                    onClick={handleSaveDraftToDb}
                    disabled={draftSaving}
                    type="button"
                    className="h-10 rounded-lg border-emerald-500 bg-emerald-500 px-3 text-[13px] font-semibold text-white hover:bg-emerald-600"
                  >
                    {draftSaving ? '保存中...' : 'DBに途中保存'}
                  </button>
                )}
                {workspaceId && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteWorkspaceConfirm(true)}
                    className="h-10 rounded-lg border-rose-300 bg-rose-50 px-3 text-[13px] font-semibold text-rose-700 hover:bg-rose-100"
                  >
                    下書き削除
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="col-span-2 h-10 rounded-lg border-sky-500 bg-sky-500 px-3 text-[13px] font-semibold text-white hover:bg-sky-600"
                >
                  {saving ? '保存中...' : saveButtonLabel}
                </button>
                <button
                  onClick={handleRegisterJoseki}
                  disabled={registeringJoseki}
                  className="col-span-2 h-10 rounded-lg border-amber-500 bg-amber-500 px-3 text-[13px] font-semibold text-white hover:bg-amber-600"
                >
                  {registeringJoseki ? '登録中...' : (selectedVisibleTagCount === 0 ? '定跡モードで保存(タグなし)' : '定跡モードで保存')}
                </button>
                <button
                  onClick={handleSaveNewModeDraft}
                  disabled={!workspaceId || savingNewMode}
                  className="col-span-2 h-10 rounded-lg border-fuchsia-500 bg-fuchsia-500 px-3 text-[13px] font-semibold text-white hover:bg-fuchsia-600 disabled:opacity-60"
                >
                  {savingNewMode ? '保存中...' : (selectedVisibleTagCount === 0 ? '新モードで保存(タグなし)' : '新モードで保存')}
                </button>
                {josekiSaveWarning ? (
                  <div className="col-span-2 -mt-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-800">
                    {josekiSaveWarning}
                  </div>
                ) : null}
                <button
                  onClick={() => setShowPreview(true)}
                  type="button"
                  className="h-10 rounded-lg border-sky-200 bg-white/90 px-3 text-[13px] font-semibold text-slate-700 hover:bg-sky-50"
                >
                  プレビュー
                </button>
                <button
                  onClick={handleGenerateExplanations}
                  disabled={generating}
                  type="button"
                  className="h-10 rounded-lg border-violet-500 bg-violet-500 px-3 text-[13px] font-semibold text-white hover:bg-violet-600"
                >
                  {generating ? '生成中...' : 'AI解説'}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
      )}

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
                {saving ? '保存中...' : saveButtonLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual: delete current workspace? modal */}
      {showDeleteWorkspaceConfirm && workspaceId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowDeleteWorkspaceConfirm(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-5 w-full max-w-[380px] mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-2">下書きを削除</h3>
            <p className="text-[13px] text-gray-600 mb-4">
              「{workspaceName ?? 'この下書き'}」を削除しますか？
              <br />
              削除すると途中保存データも消えます。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteWorkspaceConfirm(false)}
                className="text-[13px]"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleDeleteCurrentWorkspace();
                }}
                className="bg-red-600 text-white border-red-600 hover:bg-red-700 text-[13px] px-4 py-1.5 rounded"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Explanation keyboard modal */}
      <KeyboardModal
        open={keyboardSlot !== null}
        title="解説入力キーボード"
        onClose={() => setKeyboardSlot(null)}
        onInsert={handleKeyboardInsert}
        onDelete={handleKeyboardDelete}
        onDragStateChange={(isDragging) => setKeyboardDragging(isDragging)}
      />

      {/* Reading-line replay modal */}
      {replaySlot && choices[replaySlot].usi && rootSfen && (
        <ReadingLineModal
          rootSfen={rootSfen}
          line={buildReplayLine(choices[replaySlot], introMoveUsi)}
          onClose={() => setReplaySlot(null)}
        />
      )}

      {/* New-mode save warning modal */}
      {newModeSaveWarnings.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setNewModeSaveWarnings([])}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-5 w-full max-w-[420px] mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-base font-semibold">保存できません</h3>
            <div className="mb-4 space-y-2 text-[13px] text-gray-600">
              {newModeSaveWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setNewModeSaveWarnings([])}
                className="rounded bg-slate-900 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-slate-800"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
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
              {savedProblemId != null
                ? `問題を保存しました (problem_id: ${savedProblemId})。`
                : '新モードとして下書きDBに保存しました。'}
              <br />
              {savedProblemId != null
                ? 'この下書きを削除しますか？'
                : '下書き一覧から削除しますか？新モード一覧には残ります。'}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  void handleKeepWorkspaceAfterSave();
                }}
                className="text-[13px]"
              >
                残す
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    if (savedProblemId == null) {
                      await hideWorkspaceFromList(workspaceId);
                    } else {
                      await deleteWorkspace(workspaceId);
                    }
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

export default PasteProblemCreator;
