export type ExistingExplanationProblem = {
  problem_id: number;
  display_no: number | null;
  root_sfen: string;
  intro_moves_usi: string[];
  correct_choice_id: number;
  root_eval_cp: number | null;
  root_eval_percent: number | null;
  problem_rating: number | null;
  tags: string[];
  choices: ExistingExplanationChoice[];
};

export type ExistingExplanationChoice = {
  choice_id: number;
  is_correct: boolean;
  usi: string;
  label: string;
  eval_cp: number | null;
  eval_percent: number | null;
  line: string[];
  explanation: string;
  correct_eval_cp: number | null;
  correct_eval_percent: number | null;
  gap_from_correct_cp: number | null;
  abs_gap_from_correct_cp: number | null;
  gap_from_correct_percent: number | null;
  abs_gap_from_correct_percent: number | null;
  explanation_length?: number | null;
};

export type ExplanationTextLabels = {
  mentionedMoves: string[];

  mentionsAttack: boolean;
  mentionsDefense: boolean;
  mentionsKingSafety: boolean;
  mentionsMaterial: boolean;
  mentionsLineControl: boolean;

  saysIntentWorks: boolean;
  saysIntentFails: boolean;
  saysOpponentCanEscape: boolean;
  saysOpponentCanBlock: boolean;
  saysOpponentCanDefend: boolean;

  saysTooSlow: boolean;
  saysNoThreat: boolean;
  saysOneMovePass: boolean;

  saysMaterialGain: boolean;
  saysMaterialLoss: boolean;
  saysGivesPieces: boolean;

  saysGoodMove: boolean;
  saysBadMove: boolean;
  saysQuestionable: boolean;
  saysNaturalBut: boolean;

  hasAiPrefix: boolean;
};

export type ParsedUsiMove = {
  raw: string;
  isDrop: boolean;
  isPromotion: boolean;
  from: string | null;
  to: string | null;
  dropPiece: string | null;
};

export type LineFacts = {
  firstResponse: string | null;
  firstSixMoves: string[];
  moveCount: number;

  hasDrop: boolean;
  hasPromotion: boolean;

  dropPieces: string[];
  promotedMoves: string[];

  hasPawnDrop: boolean;
  hasSilverDrop: boolean;
  hasGoldDrop: boolean;
  hasBishopDrop: boolean;
  hasRookDrop: boolean;
  hasKnightDrop: boolean;
  hasLanceDrop: boolean;

  destinationSquares: string[];
};

export type ChoiceComparisonFacts = {
  correctChoiceId: number;
  comparedChoiceId: number;

  absGapCp: number | null;
  absGapPercent: number | null;

  correctFirstMoves: string[];
  comparedFirstMoves: string[];

  sameFirstResponseAsCorrect: boolean;
  sharesAnyLineMoveWithCorrect: boolean;
  sharedLineMoves: string[];

  correctHasPromotion: boolean;
  comparedHasPromotion: boolean;
  correctHasDrop: boolean;
  comparedHasDrop: boolean;

  comparedFirstResponseMayNeutralize: boolean;
};

export type SuspectedExplanationPattern =
  | 'attack_continues'
  | 'attack_disappears'
  | 'opponent_escapes'
  | 'opponent_blocks_line'
  | 'too_slow'
  | 'material_gain'
  | 'material_loss'
  | 'gives_pieces'
  | 'king_safety_risk'
  | 'defense_works'
  | 'double_threat'
  | 'single_threat_only'
  | 'natural_but_worse'
  | 'no_threat'
  | 'bad_move_short'
  | 'unknown';

export type ExistingChoiceAnalysis = {
  problemId: number;
  displayNo: number | null;
  choiceId: number;
  isCorrect: boolean;
  label: string;
  usi: string;
  explanation: string;

  eval: {
    evalCp: number | null;
    evalPercent: number | null;
    absGapCp: number | null;
    absGapPercent: number | null;
  };

  textLabels: ExplanationTextLabels;
  lineFacts: LineFacts;
  comparisonToCorrect: ChoiceComparisonFacts | null;
  suspectedPatterns: SuspectedExplanationPattern[];
};

export type ExistingProblemAnalysis = {
  problemId: number;
  displayNo: number | null;
  correctChoiceId: number;
  rootSfen: string;
  tags: string[];
  choices: ExistingChoiceAnalysis[];
};

export type ExplanationPlanTone =
  | 'positive'
  | 'mild_positive'
  | 'neutral'
  | 'mild_negative'
  | 'clear_negative'
  | 'severe_negative';

export type ExplanationPlanPrimaryReason =
  | 'correct_attack_continues'
  | 'correct_defense_works'
  | 'correct_material_gain'
  | 'correct_forcing_sequence'
  | 'correct_tactical_gain'
  | 'wrong_attack_disappears'
  | 'wrong_opponent_escapes'
  | 'wrong_opponent_blocks_line'
  | 'wrong_no_threat'
  | 'wrong_too_slow'
  | 'wrong_material_loss'
  | 'wrong_gives_pieces'
  | 'wrong_king_safety_risk'
  | 'wrong_bad_move_short'
  | 'wrong_natural_but_worse'
  | 'unknown';

export type ExplanationPlan = {
  problemId: number;
  displayNo: number | null;
  choiceId: number;
  isCorrect: boolean;
  label: string;
  usi: string;

  primaryReason: ExplanationPlanPrimaryReason;
  secondaryReasons: ExplanationPlanPrimaryReason[];

  reasonDetail: string;
  tone: ExplanationPlanTone;

  confidence: 'high' | 'medium' | 'low';

  suggestedStructure: string[];
  allowedPhrases: string[];
  avoidPhrases: string[];

  sourceSignals: {
    suspectedPatterns: SuspectedExplanationPattern[];
    textLabelsSummary: string[];
    lineFactsSummary: string[];
    absGapCp: number | null;
    absGapPercent: number | null;
    firstResponse: string | null;
    sharedLineMoves: string[];
  };
};

export type AnalysisSummary = {
  problemCount: number;
  choiceCount: number;
  correctChoiceCount: number;
  wrongChoiceCount: number;
  aiPrefixChoiceCount: number;
  unknownChoiceCount: number;
  unknownChoiceRate: number;
  planUnknownPrimaryReasonCount: number;
  planUnknownPrimaryReasonRate: number;
  unknownCorrectChoiceCount: number;
  unknownWrongChoiceCount: number;
  averageExplanationLengthCorrect: number | null;
  averageExplanationLengthWrong: number | null;
  medianExplanationLengthCorrect: number | null;
  medianExplanationLengthWrong: number | null;
  patternCountsCorrect: Record<string, number>;
  patternCountsWrong: Record<string, number>;
  textLabelCountsCorrect: Record<string, number>;
  textLabelCountsWrong: Record<string, number>;
  averageAbsGapPercentByPattern: Record<string, number | null>;
  averageAbsGapCpByPattern: Record<string, number | null>;
  patternCooccurrenceCountsAll: Record<string, number>;
  patternCooccurrenceCountsCorrect: Record<string, number>;
  patternCooccurrenceCountsWrong: Record<string, number>;
  planPrimaryReasonCountsAll: Record<string, number>;
  planPrimaryReasonCountsCorrect: Record<string, number>;
  planPrimaryReasonCountsWrong: Record<string, number>;
  planToneCounts: Record<string, number>;
  planConfidenceCounts: Record<string, number>;
};
