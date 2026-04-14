import React, { useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Board from "../components/Board";
import type { ArrowInfo } from "../components/Board";
import ChoiceCard from "../components/ChoiceCard";
import TagSelector from "../components/TagSelector";
import AnalysisPanel from "../components/AnalysisPanel";
import type { BestMove } from "../components/AnalysisPanel";
import Toggle from "../components/Toggle";
import { useBoardStore } from "../hooks/useBoardStore";
import { parseSfen, toUsiSquare } from "../lib/sfen";
import { usiToLabel, pvToJapanese } from "../lib/usi-to-label";
import { cpToWinRatePercentFromRootSfen } from "../lib/eval-percent";
import { evaluatePosition, generateExplanations } from "../api/engine";
import { saveProblem, getNextDisplayNo } from "../api/problems";
import {
  deleteFavorite,
  fetchProblemDraftForFavorite,
  saveProblemDraftForFavorite,
  clearProblemDraftForFavorite,
} from "../api/favorites";
import { DEFAULT_PROMPT } from "../lib/constants";
import { getValidDestinations, getValidDropSquares } from "../lib/legal-moves";
import type { ChoiceDraft } from "../types/problem";
import type { ProblemCreatorDraft } from "../lib/problem-draft";
import type {
  Board as BoardType,
  HandPieces,
  Side,
  HandPieceType,
  PieceType,
} from "../types/shogi";
import { CAN_PROMOTE, pieceKanji } from "../types/shogi";
import { useNavigationPrompt } from "../hooks/useNavigationPrompt";

type SlotKey = "correct" | "incorrect1" | "incorrect2";
const WINRATE_SCALE = 800;
const CHOICE_EVAL_DEPTH = 24;
const SLOT_ORDER: SlotKey[] = ["correct", "incorrect1", "incorrect2"];

function draftSignature(draft: ProblemCreatorDraft): string {
  const { savedAt: _ignoredSavedAt, ...stablePart } = draft;
  return JSON.stringify(stablePart);
}

const EMPTY_CHOICE: ChoiceDraft = {
  slotLabel: "",
  usi: "",
  label: "",
  explanation: "",
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
  const rootSfen = state?.root_sfen ?? "";
  const parsed = rootSfen ? parseSfen(rootSfen) : null;

  // Board store (used in analysis mode for interactive board)
  const store = useBoardStore();

  // Fixed board state for registration mode (always rootSfen position)
  const [board] = useState<BoardType>(parsed?.board ?? []);
  const [senteHand] = useState<HandPieces>(
    parsed?.senteHand ?? { R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 },
  );
  const [goteHand] = useState<HandPieces>(
    parsed?.goteHand ?? { R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 },
  );
  const [sideToMove] = useState<Side>(parsed?.sideToMove ?? "sente");

  // Initialize store with rootSfen on mount
  React.useEffect(() => {
    if (rootSfen) store.loadFromSfen(rootSfen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move selection state
  const [selectedCell, setSelectedCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [selectedHandPiece, setSelectedHandPiece] = useState<{
    side: Side;
    type: HandPieceType;
  } | null>(null);

  // Active slot for move registration (null = no slot active)
  const [activeSlot, setActiveSlot] = useState<SlotKey | null>(null);

  const [candidateMoves, setCandidateMoves] = useState<BestMove[]>([]);
  const [autoEvalTried, setAutoEvalTried] = useState<Record<SlotKey, string>>({
    correct: "",
    incorrect1: "",
    incorrect2: "",
  });

  const handleCandidateMoves = useCallback((moves: BestMove[]) => {
    setCandidateMoves(moves);
  }, []);

  const arrows: ArrowInfo[] = candidateMoves.map((m, idx) => ({
    from: m.from,
    to: m.to,
    style:
      idx === 0 ? "primary" : idx === 1 ? "secondary" : ("tertiary" as const),
    showNextLabel: idx === 1,
  }));

  // Choice drafts
  const [choices, setChoices] = useState<Record<SlotKey, ChoiceDraft>>({
    correct: { ...EMPTY_CHOICE, slotLabel: "correct" },
    incorrect1: { ...EMPTY_CHOICE, slotLabel: "incorrect1" },
    incorrect2: { ...EMPTY_CHOICE, slotLabel: "incorrect2" },
  });

  // Form fields
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [tags, setTags] = useState<string[]>(state?.tags ?? []);
  const [displayNo, setDisplayNo] = useState<number | null>(null);
  const [introMoves, setIntroMoves] = useState(state?.last_move ?? "");
  const [problemRating, setProblemRating] = useState<number>(1200);
  const [rootEvalCp, setRootEvalCp] = useState<number | null>(null);
  const [rootEvalPercent, setRootEvalPercent] = useState<number | null>(null);

  // UI state
  const [evaluatingSlot, setEvaluatingSlot] = useState<SlotKey | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [analysisMode, setAnalysisMode] = useState(true);
  const [promotionChoice, setPromotionChoice] = useState<{
    fromSq: string;
    toSq: string;
    pieceType: PieceType;
  } | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const lastSyncedSignatureRef = React.useRef<string>("");
  const lastSyncedAtRef = React.useRef<string>("");
  const [editingSlot, setEditingSlot] = useState<SlotKey | null>(null);
  const [remoteEditingSlot, setRemoteEditingSlot] = useState<SlotKey | null>(
    null,
  );

  useNavigationPrompt(
    Boolean(favoriteId && hasUnsavedChanges),
    "DBに途中保存していない変更があります。このままページを移動しますか？",
  );

  const buildDraft = useCallback(
    (): ProblemCreatorDraft => ({
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
      editingSlot: editingSlot ?? null,
      editingAt: editingSlot ? new Date().toISOString() : null,
    }),
    [
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
      editingSlot,
    ],
  );

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
    getNextDisplayNo()
      .then(setDisplayNo)
      .catch(() => {});
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
          lastSyncedAtRef.current = "";
          return;
        }

        const draft = snapshot.draft;
        if (draft.favoriteId !== favoriteId) return;
        if (draft.rootSfen !== rootSfen) return;

        applyDraft(draft);
        lastSyncedSignatureRef.current = draftSignature(draft);
        lastSyncedAtRef.current = snapshot.updatedAt;
        setMessage("途中保存データを読み込みました");
      } catch {
        // Continue without draft if retrieval fails.
      }
    })();
  }, [favoriteId, rootSfen, draftRestored, applyDraft, buildDraft]);

  React.useEffect(() => {
    if (!favoriteId || !rootSfen || !draftRestored) return;
    const currentSignature = draftSignature(buildDraft());
    setHasUnsavedChanges(currentSignature !== lastSyncedSignatureRef.current);
  }, [favoriteId, rootSfen, draftRestored, buildDraft]);

  React.useEffect(() => {
    if (!favoriteId || !hasUnsavedChanges) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [favoriteId, hasUnsavedChanges]);

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
          const validDrops = getValidDropSquares(
            storeBoard,
            storeSide,
            selectedHandPiece.type,
          );
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

        const validMoves = getValidDestinations(
          storeBoard,
          selectedCell.row,
          selectedCell.col,
          storeSide,
        );
        if (!validMoves.some((s) => s.row === row && s.col === col)) return;

        const fromSq = toUsiSquare(selectedCell.row, selectedCell.col);
        const toSq = toUsiSquare(row, col);
        const piece = storeBoard[selectedCell.row][selectedCell.col];
        setSelectedCell(null);

        if (piece && !piece.promoted && CAN_PROMOTE[piece.type]) {
          const inPromotionZone =
            (storeSide === "sente" && (row <= 2 || selectedCell.row <= 2)) ||
            (storeSide === "gote" && (row >= 6 || selectedCell.row >= 6));
          if (inPromotionZone) {
            const mustPromote =
              (piece.type === "P" &&
                ((storeSide === "sente" && row === 0) ||
                  (storeSide === "gote" && row === 8))) ||
              (piece.type === "L" &&
                ((storeSide === "sente" && row === 0) ||
                  (storeSide === "gote" && row === 8))) ||
              (piece.type === "N" &&
                ((storeSide === "sente" && row <= 1) ||
                  (storeSide === "gote" && row >= 7)));
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

      // --- Registration mode: select a move to register as a choice ---
      if (selectedHandPiece) {
        const validDrops = getValidDropSquares(
          board,
          sideToMove,
          selectedHandPiece.type,
        );
        if (!validDrops.some((s) => s.row === row && s.col === col)) {
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
        if (board[row][col] && board[row][col]!.side === sideToMove)
          setSelectedCell({ row, col });
        return;
      }
      if (selectedCell.row === row && selectedCell.col === col) {
        setSelectedCell(null);
        return;
      }
      const targetPiece = board[row][col];
      if (targetPiece && targetPiece.side === sideToMove) {
        setSelectedCell({ row, col });
        return;
      }

      const validMoves = getValidDestinations(
        board,
        selectedCell.row,
        selectedCell.col,
        sideToMove,
      );
      if (!validMoves.some((s) => s.row === row && s.col === col)) return;

      const fromSq = toUsiSquare(selectedCell.row, selectedCell.col);
      const toSq = toUsiSquare(row, col);
      const piece = board[selectedCell.row][selectedCell.col];

      if (piece && !piece.promoted && CAN_PROMOTE[piece.type]) {
        const inPromotionZone =
          (sideToMove === "sente" && (row <= 2 || selectedCell.row <= 2)) ||
          (sideToMove === "gote" && (row >= 6 || selectedCell.row >= 6));
        if (inPromotionZone) {
          const mustPromote =
            (piece.type === "P" &&
              ((sideToMove === "sente" && row === 0) ||
                (sideToMove === "gote" && row === 8))) ||
            (piece.type === "L" &&
              ((sideToMove === "sente" && row === 0) ||
                (sideToMove === "gote" && row === 8))) ||
            (piece.type === "N" &&
              ((sideToMove === "sente" && row <= 1) ||
                (sideToMove === "gote" && row >= 7)));
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
    [
      analysisMode,
      store,
      board,
      sideToMove,
      selectedCell,
      selectedHandPiece,
      registerMove,
      promotionChoice,
    ],
  );

  const handlePromotionSelect = useCallback(
    (promote: boolean) => {
      if (!promotionChoice) return;
      const usi = `${promotionChoice.fromSq}${promotionChoice.toSq}${promote ? "+" : ""}`;
      if (analysisMode) {
        store.applyMove(usi);
      } else {
        registerMove(usi);
      }
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

  const handleEvaluateChoice = useCallback(
    async (slot: SlotKey, silent = false) => {
      if (!rootSfen) return;
      const choice = choices[slot];
      if (!choice.usi) return;

      setEvaluatingSlot(slot);
      setMessage("");

      try {
        const result = await evaluatePosition(rootSfen, [], {
          depth: CHOICE_EVAL_DEPTH,
          searchMoves: [choice.usi],
          stable: true,
        });

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

          if (slot === "correct") {
            setRootEvalCp(rawCp);
            setRootEvalPercent(choicePct);
          }

          return updated;
        });

        if (!silent && slot === "correct") {
          setMessage("正解手とrootの評価値を計算しました");
        } else if (!silent) {
          setMessage("候補手の評価値を計算しました");
        }
      } catch (e: any) {
        if (!silent) {
          setMessage(`評価エラー: ${e.message}`);
        }
      } finally {
        setEvaluatingSlot(null);
      }
    },
    [choices, rootSfen],
  );

  React.useEffect(() => {
    if (!rootSfen || evaluatingSlot) return;
    const nextSlot = SLOT_ORDER.find((slot) => {
      const usi = choices[slot].usi;
      return (
        Boolean(usi) &&
        choices[slot].eval_cp === null &&
        autoEvalTried[slot] !== usi
      );
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

  const handleGenerateExplanations = useCallback(async () => {
    if (!rootSfen) {
      setMessage("局面（root_sfen）が未設定です");
      return;
    }

    const slots: SlotKey[] = ["correct", "incorrect1", "incorrect2"];
    const filledSlots = slots.filter((s) => choices[s].usi);
    if (filledSlots.length === 0) {
      setMessage("選択肢を1つ以上設定してください");
      return;
    }

    const targetSlots = filledSlots.filter((s) => !choices[s].explanation.trim());
    if (targetSlots.length === 0) {
      setMessage("すべての選択肢に解説が入力済みです");
      return;
    }

    setGenerating(true);
    setMessage("");
    try {
      const choiceData = targetSlots.map((slot) => {
        const c = choices[slot];
        const fullPv = [c.usi, ...c.line];
        const labels = pvToJapanese(fullPv, rootSfen, fullPv.length);
        return {
          label: c.label,
          eval_cp: c.eval_cp,
          eval_percent: c.eval_percent,
          line_labels: labels.slice(1).join(" "),
          is_correct: slot === "correct",
        };
      });

      const results = await generateExplanations(rootSfen, sideToMove, choiceData);

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
  }, [rootSfen, sideToMove, choices]);

  // ---- Validation ----

  const validate = (): string[] => {
    const errors: string[] = [];
    if (!favoriteId)
      errors.push("お気に入り一覧から問題作成を開始してください");
    if (!rootSfen) errors.push("局面（root_sfen）が未設定です");
    if (!choices.correct.usi) errors.push("正解手が未設定です");
    if (!choices.incorrect1.usi) errors.push("不正解手１が未設定です");
    if (!choices.incorrect2.usi) errors.push("不正解手２が未設定です");

    const usis = [
      choices.correct.usi,
      choices.incorrect1.usi,
      choices.incorrect2.usi,
    ].filter(Boolean);
    if (new Set(usis).size !== usis.length)
      errors.push("候補手が重複しています");

    return errors;
  };

  const warnings = (): string[] => {
    const w: string[] = [];
    if (choices.correct.usi && !choices.correct.explanation)
      w.push("正解手の解説が未入力です");
    if (choices.incorrect1.usi && !choices.incorrect1.explanation)
      w.push("不正解手１の解説が未入力です");
    if (choices.incorrect2.usi && !choices.incorrect2.explanation)
      w.push("不正解手２の解説が未入力です");
    return w;
  };

  const handleSaveDraft = async () => {
    if (!favoriteId) {
      setMessage("お気に入り一覧から開始した局面のみ途中保存できます");
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
      setHasUnsavedChanges(false);
      setMessage("途中保存しました（DB）");
    } catch (e: any) {
      setMessage(`途中保存エラー: ${e.message}`);
    }
  };

  // ---- Save ----

  const handleSave = async () => {
    const errors = validate();
    if (errors.length > 0) {
      setMessage(errors.join("\n"));
      return;
    }

    const warns = warnings();
    if (warns.length > 0) {
      if (
        !window.confirm(
          `以下の警告があります:\n${warns.join("\n")}\n\n保存しますか？`,
        )
      )
        return;
    }

    setSaving(true);
    setMessage("");

    try {
      // Assign choice_ids: correct=1, incorrect1=2, incorrect2=3
      const correctChoiceId = 1;

      // intro_moves_usi must be exactly one move: the move immediately before choices.
      const introTokens = introMoves.trim()
        ? introMoves.trim().split(/\s+/)
        : [];
      const introMoveUsi = introTokens.length > 0
        ? introTokens[introTokens.length - 1]
        : null;
      const introMovesUsi = introMoveUsi ? [introMoveUsi] : [];

      // Always use correct choice's eval for root_eval_cp/percent
      const correctEvalCp = choices.correct.eval_cp;
      const correctEvalPercent = choices.correct.eval_percent;
      const problem = {
        prompt: prompt.trim() || DEFAULT_PROMPT,
        root_sfen: rootSfen,
        correct_choice_id: correctChoiceId,
        intro_moves_usi: introMovesUsi,
        source_run_id: null,
        root_eval_cp: correctEvalCp,
        root_eval_percent: correctEvalPercent,
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
        lastSyncedSignatureRef.current = "";
        lastSyncedAtRef.current = "";
      }

      if (!favoriteId) {
        setMessage(`保存しました (problem_id: ${problemId})`);
        return;
      }

      const shouldDeleteFavorite = window.confirm(
        "問題を保存しました。お気に入りから削除しますか？",
      );
      if (!shouldDeleteFavorite) {
        setMessage(
          `保存しました (problem_id: ${problemId})\nお気に入りは削除していません`,
        );
        return;
      }

      try {
        await deleteFavorite(favoriteId);
        setMessage(
          `保存しました (problem_id: ${problemId})\nお気に入りから削除しました`,
        );
        navigate("/favorites");
      } catch (deleteError: any) {
        setMessage(
          `保存しました (problem_id: ${problemId})\nお気に入り削除エラー: ${deleteError.message}`,
        );
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
    setAutoEvalTried((prev) => ({ ...prev, [slot]: "" }));
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
        <button onClick={() => navigate("/favorites")}>お気に入り一覧へ</button>
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
              <span>
                手番:{" "}
                {(analysisMode ? store.sideToMove : sideToMove) === "sente"
                  ? "☗先手"
                  : "☖後手"}
              </span>
              {favoriteId && (
                <span>
                    途中保存: {hasUnsavedChanges ? "未保存" : "保存済み"}
                </span>
              )}
              {selectedHandPiece && (
                <span className="text-blue-600 font-semibold">
                  打: {selectedHandPiece.type}
                </span>
              )}
              {rootEvalCp !== null && (
                <span>
                  root評価値: {rootEvalCp}cp ({rootEvalPercent}%)
                </span>
              )}
              {analysisMode && store.moveHistory.length > 0 && (
                <button
                  className="text-xs px-2 py-0.5"
                  onClick={() => {
                    store.loadFromSfen(rootSfen);
                    setSelectedCell(null);
                    setSelectedHandPiece(null);
                  }}
                >
                  ↩ rootに戻す
                </button>
              )}
            </div>
            <div className="flex gap-2 mt-1.5">
              <button
                onClick={() => {
                  store.undoMove();
                  setSelectedCell(null);
                  setSelectedHandPiece(null);
                }}
                disabled={!analysisMode || store.moveHistory.length === 0}
              >
                ↩ 一手戻す
              </button>
              <button
                onClick={() => {
                  store.redoMove();
                  setSelectedCell(null);
                  setSelectedHandPiece(null);
                }}
                disabled={!analysisMode || !store.canRedo()}
              >
                ↪ 一手進める
              </button>
            </div>
            {promotionChoice && (
              <div className="flex items-center gap-2.5 px-3 py-2 bg-amber-50 border-2 border-amber-400 rounded-md text-[13px] font-semibold">
                <span>成りますか？</span>
                <button
                  className="w-12 h-12 text-2xl font-bold flex items-center justify-center border-2 border-gray-300 rounded bg-white cursor-pointer hover:border-blue-600 hover:bg-blue-100"
                  onClick={() => handlePromotionSelect(false)}
                >
                  {pieceKanji({
                    type: promotionChoice.pieceType,
                    side: analysisMode ? store.sideToMove : sideToMove,
                    promoted: false,
                  })}
                </button>
                <button
                  className="w-12 h-12 text-2xl font-bold flex items-center justify-center border-2 border-gray-300 rounded bg-white cursor-pointer hover:border-blue-600 hover:bg-blue-100 text-red-700"
                  onClick={() => handlePromotionSelect(true)}
                >
                  {pieceKanji({
                    type: promotionChoice.pieceType,
                    side: analysisMode ? store.sideToMove : sideToMove,
                    promoted: true,
                  })}
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
              {(["correct", "incorrect1", "incorrect2"] as SlotKey[]).map(
                (slot) => (
                  <ChoiceCard
                    key={slot}
                    slot={slot}
                    draft={choices[slot]}
                    isActive={activeSlot === slot}
                    isEditing={editingSlot === slot}
                    remoteEditing={
                      remoteEditingSlot === slot && editingSlot !== slot
                    }
                    onActivate={() => {
                      const nextSlot = activeSlot === slot ? null : slot;
                      setActiveSlot(nextSlot);
                      // Only switch to registration mode when user needs to pick a move.
                      // If the slot already has a move, stay in analysis mode.
                      if (nextSlot !== null && !choices[nextSlot].usi) {
                        setAnalysisMode(false);
                        store.loadFromSfen(rootSfen);
                      }
                      setSelectedCell(null);
                      setSelectedHandPiece(null);
                    }}
                    onEvaluate={() => handleEvaluateChoice(slot)}
                    evalLoading={evaluatingSlot === slot}
                    onEvalCpChange={(value) => handleEvalCpChange(slot, value)}
                    onEvalPercentChange={(value) =>
                      handleEvalPercentChange(slot, value)
                    }
                    onExplanationChange={(text) =>
                      handleExplanationChange(slot, text)
                    }
                    onExplanationFocus={() => setEditingSlot(slot)}
                    onExplanationBlur={() => {
                      if (editingSlot === slot) setEditingSlot(null);
                    }}
                    onClear={() => handleClearSlot(slot)}
                  />
                ),
              )}
            </div>

            <div className="min-w-[320px] max-w-[420px] flex flex-col gap-1.5">
              <div className="flex flex-col gap-0.5">
                <label className="text-xs font-semibold text-gray-500">
                  問題文 (prompt)
                </label>
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="h-8"
                />
              </div>

              <div className="flex flex-col gap-0.5">
                <label className="text-xs font-semibold text-gray-500">
                  display_no
                </label>
                <input
                  type="number"
                  value={displayNo ?? ""}
                  onChange={(e) =>
                    setDisplayNo(
                      e.target.value ? parseInt(e.target.value, 10) : null,
                    )
                  }
                  className="h-8"
                />
              </div>

              <div className="flex flex-col gap-0.5">
                <label className="text-xs font-semibold text-gray-500">
                  問題レート
                </label>
                <select
                  value={problemRating}
                  onChange={(e) =>
                    setProblemRating(parseInt(e.target.value, 10))
                  }
                  className="h-8"
                >
                  {Array.from({ length: 19 }, (_, i) => 600 + i * 100).map(
                    (rating) => (
                      <option key={rating} value={rating}>
                        {rating}
                      </option>
                    ),
                  )}
                </select>
              </div>

              <TagSelector selected={tags} onChange={setTags} />

              <div className="flex gap-2 mt-1">
                <button onClick={handleSaveDraft} type="button">
                  途中保存
                </button>
                <button onClick={() => setShowPreview(true)} type="button">
                  プレビュー
                </button>
                <button
                  onClick={handleGenerateExplanations}
                  disabled={generating}
                  type="button"
                  className="bg-purple-600 text-white border-purple-600 hover:bg-purple-700"
                >
                  {generating ? "生成中..." : "解説生成"}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
                >
                  {saving ? "保存中..." : "Supabaseに保存"}
                </button>
              </div>
            </div>

            {message && (
              <div
                className={`px-3 py-2 rounded text-[13px] whitespace-pre-wrap ${message.includes("エラー") ? "bg-red-50 border border-red-300 text-red-700" : "bg-emerald-50 border border-emerald-300 text-emerald-800"}`}
              >
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
                    intro_moves_usi: (() => {
                      const introTokens = introMoves.trim()
                        ? introMoves.trim().split(/\s+/)
                        : [];
                      const introMoveUsi = introTokens.length > 0
                        ? introTokens[introTokens.length - 1]
                        : null;
                      return introMoveUsi ? [introMoveUsi] : [];
                    })(),
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
              <button type="button" onClick={() => setShowPreview(false)}>
                閉じる
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-blue-600 text-white border-blue-600 hover:bg-blue-700 px-4"
              >
                {saving ? "保存中..." : "Supabaseに保存"}
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

export default ProblemCreator;
