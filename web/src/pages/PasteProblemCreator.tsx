import React, { useState, useCallback, useMemo } from 'react';
import Board from '../components/Board';
import PasteChoiceCard from '../components/PasteChoiceCard';
import ReadingLineModal from '../components/ReadingLineModal';
import TagSelector from '../components/TagSelector';
import { parseSfen, toUsiSquare } from '../lib/sfen';
import { usiToLabel } from '../lib/usi-to-label';
import { cpToWinRatePercentFromRootSfen } from '../lib/eval-percent';
import { parseKifRecord, parseReadingLine } from '../lib/kif-parser';
import { saveProblem, getNextDisplayNo } from '../api/problems';
import { DEFAULT_PROMPT } from '../lib/constants';
import { getValidDestinations, getValidDropSquares } from '../lib/legal-moves';
import type { ChoiceDraft } from '../types/problem';
import type { Side, HandPieceType, PieceType } from '../types/shogi';
import { CAN_PROMOTE, pieceKanji } from '../types/shogi';

type SlotKey = 'correct' | 'incorrect1' | 'incorrect2';
const WINRATE_SCALE = 800;
const BOARD_SCALE = 0.82;

const EMPTY_CHOICE: ChoiceDraft = {
  slotLabel: '',
  usi: '',
  label: '',
  explanation: '',
  line: [],
  eval_cp: null,
  eval_percent: null,
};

const PasteProblemCreator: React.FC = () => {
  // ---- KIF state ----
  const [kifText, setKifText] = useState('');
  const [kifError, setKifError] = useState('');
  const [rootSfen, setRootSfen] = useState('');
  const [kifMoves, setKifMoves] = useState<string[]>([]);

  const parsed = useMemo(() => (rootSfen ? parseSfen(rootSfen) : null), [rootSfen]);

  // ---- Choice drafts ----
  const [choices, setChoices] = useState<Record<SlotKey, ChoiceDraft>>({
    correct: { ...EMPTY_CHOICE, slotLabel: 'correct' },
    incorrect1: { ...EMPTY_CHOICE, slotLabel: 'incorrect1' },
    incorrect2: { ...EMPTY_CHOICE, slotLabel: 'incorrect2' },
  });

  // Reading-line inputs / errors per card
  const [readingLineInputs, setReadingLineInputs] = useState<Record<SlotKey, string>>({
    correct: '',
    incorrect1: '',
    incorrect2: '',
  });
  const [readingLineErrors, setReadingLineErrors] = useState<Record<SlotKey, string>>({
    correct: '',
    incorrect1: '',
    incorrect2: '',
  });

  // ---- Form fields ----
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [tags, setTags] = useState<string[]>([]);
  const [displayNo, setDisplayNo] = useState<number | null>(null);
  const [problemRating, setProblemRating] = useState<number>(1200);
  const [rootEvalCp, setRootEvalCp] = useState<number | null>(null);
  const [rootEvalPercent, setRootEvalPercent] = useState<number | null>(null);

  // ---- UI state ----
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [replaySlot, setReplaySlot] = useState<SlotKey | null>(null);

  // ---- Board interaction state ----
  const [activeSlot, setActiveSlot] = useState<SlotKey | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [selectedHandPiece, setSelectedHandPiece] = useState<{ side: Side; type: HandPieceType } | null>(null);
  const [promotionChoice, setPromotionChoice] = useState<{
    fromSq: string;
    toSq: string;
    pieceType: PieceType;
  } | null>(null);

  // Auto-fetch next display_no
  React.useEffect(() => {
    getNextDisplayNo()
      .then(setDisplayNo)
      .catch(() => {});
  }, []);

  // ---- KIF parsing ----

  const doParseKif = useCallback((text: string) => {
    setKifError('');
    if (!text.trim()) {
      setKifError('棋譜を貼り付けてください');
      return;
    }
    const result = parseKifRecord(text);
    if (!result) {
      setKifError('棋譜を解析できませんでした。KIF形式またはSFEN文字列を確認してください。');
      return;
    }
    setRootSfen(result.sfen);
    setKifMoves(result.moves);
    setMessage(`棋譜を読み込みました（${result.moves.length}手）`);
  }, []);

  const handleParseKif = useCallback(() => doParseKif(kifText), [kifText, doParseKif]);

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

      const choiceUsi = result.moves[0];
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
          line: result.moves.slice(1, 13),
        },
      }));

      if (slot === 'correct' && result.evalCp !== null) {
        setRootEvalCp(result.evalCp);
        setRootEvalPercent(evalPercent);
      }
    },
    [rootSfen, parsed],
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

  // ---- Validation ----

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
      const problem = {
        prompt: prompt.trim() || DEFAULT_PROMPT,
        root_sfen: rootSfen,
        correct_choice_id: 1,
        intro_moves_usi: [] as string[],
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
      setMessage(`保存しました (problem_id: ${problemId})`);
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
      <div className="w-full h-[calc(100vh-84px)] overflow-hidden">
        <h2 className="text-lg font-semibold mb-2">問題作成（貼付）</h2>

        <div className="flex w-full h-[calc(100%-26px)] min-w-0 gap-3 items-start justify-start overflow-hidden">
          {/* ---- Left: Board area ---- */}
          <div className="flex-shrink-0 w-[440px] flex flex-col gap-2">
            {/* KIF paste area */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500">
                棋譜を貼り付け (KIF / SFEN)
              </label>
              <textarea
                className="text-[11px] font-mono leading-tight w-full"
                rows={rootSfen ? 3 : 6}
                placeholder={
                  '手数----指手---------消費時間--\n   1 ７六歩(77)        ( 0:00/00:00:00)\n   2 ３四歩(33)        ( 0:00/00:00:00)\n\nまたは SFEN 文字列を貼り付け'
                }
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
              <div className="flex gap-2">
                <button
                  className="text-[11px] px-2 py-0.5 bg-gray-100 border-gray-300 hover:bg-gray-200"
                  type="button"
                  onClick={handleParseKif}
                >
                  棋譜を解析
                </button>
                <button
                  className="text-[11px] px-2 py-0.5 bg-blue-100 border-blue-300 hover:bg-blue-200"
                  type="button"
                  onClick={handlePasteFromClipboard}
                >
                  📋 クリップボードから貼り付け
                </button>
              </div>
              {kifError && (
                <div className="text-[11px] text-red-600 bg-red-50 px-2 py-1 rounded">
                  {kifError}
                </div>
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
              <div className="flex gap-3 text-[13px] text-gray-500 flex-wrap items-center">
                <span>
                  手番: {parsed.sideToMove === 'sente' ? '☗先手' : '☖後手'}
                </span>
                {kifMoves.length > 0 && <span>{kifMoves.length}手目</span>}
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
              </div>
            )}
            {promotionChoice && parsed && (
              <div className="flex items-center gap-2.5 px-3 py-2 bg-amber-50 border-2 border-amber-400 rounded-md text-[13px] font-semibold">
                <span>成りますか？</span>
                <button
                  className="w-12 h-12 text-2xl font-bold flex items-center justify-center border-2 border-gray-300 rounded bg-white cursor-pointer hover:border-blue-600 hover:bg-blue-100"
                  onClick={() => handlePromotionSelect(false)}
                >
                  {pieceKanji({
                    type: promotionChoice.pieceType,
                    side: parsed.sideToMove,
                    promoted: false,
                  })}
                </button>
                <button
                  className="w-12 h-12 text-2xl font-bold flex items-center justify-center border-2 border-gray-300 rounded bg-white cursor-pointer hover:border-blue-600 hover:bg-blue-100 text-red-700"
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

          {/* ---- Middle + Right ---- */}
          <div className="flex-1 grid grid-cols-[440px_minmax(200px,280px)] gap-3 items-start min-w-0 max-w-full">
            {/* Choice cards */}
            <div className="flex flex-col gap-1.5 items-start w-[440px]">
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

            {/* Settings (narrower than ProblemCreator) */}
            <div className="min-w-[200px] max-w-[280px] flex flex-col gap-1.5">
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
                  onChange={(e) =>
                    setDisplayNo(e.target.value ? parseInt(e.target.value, 10) : null)
                  }
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
                    <option key={rating} value={rating}>
                      {rating}
                    </option>
                  ))}
                </select>
              </div>

              <TagSelector selected={tags} onChange={setTags} />

              <div className="flex gap-2 mt-1">
                <button onClick={() => setShowPreview(true)} type="button">
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
              <div
                className={`px-3 py-2 rounded text-[13px] whitespace-pre-wrap col-span-2 ${
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
                {
                  problem: {
                    prompt,
                    root_sfen: rootSfen,
                    correct_choice_id: 1,
                    intro_moves_usi: [],
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
                {saving ? '保存中...' : 'Supabaseに保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reading-line replay modal */}
      {replaySlot && choices[replaySlot].line.length > 0 && rootSfen && (
        <ReadingLineModal
          rootSfen={rootSfen}
          line={choices[replaySlot].line}
          onClose={() => setReplaySlot(null)}
        />
      )}
    </>
  );
};

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

export default PasteProblemCreator;
