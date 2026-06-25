export type DraftProblem = {
  id: number;
  root_sfen: string;
  intro_moves_usi: string[];
  correct_choice_id: number;
};

export type DraftProblemChoice = {
  id?: number;
  draft_problem_id: number;
  choice_id: number;
  usi: string;
  label: string;
  eval_cp: number | null;
  eval_percent: number | null;
  line: string[];
  explanation?: string | null;
};

export type ChoiceQuality = 'best' | 'slightly_worse' | 'worse' | 'bad' | 'blunder' | 'unknown';

export type ChoiceEvalFeature = {
  choice_id: number;
  rank: number;
  gapFromBest: number | null;
  quality: ChoiceQuality;
  isCorrect: boolean;
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

export type LineFactsSummary = {
  firstResponse: string | null;
  firstSixMoves: string[];
  moveCount: number;

  hasDrop: boolean;
  hasPromotion: boolean;

  dropPieces: string[];
  promotedMoves: string[];
};

export type DraftMoveFacts = {
  choiceId: number;
  usi: string;
  label: string;

  movedPiece: string | null;
  from: string | null;
  to: string | null;
  isDrop: boolean;
  isPromotion: boolean;
  promotedPiece: string | null;
  capturedPiece: string | null;

  attacksAfterMove: Array<{
    square: string;
    piece: string;
  }>;

  attacksHighValuePiece: boolean;
  givesCheck: boolean | null;

  firstResponse: string | null;
  firstResponseLabel: string | null;
  firstResponseFacts: string[];
  lineFirstMoves: string[];

  factPhrases: string[];
  tacticalMotifs: string[];
};

export type DraftPositionFeatures = {
  choiceId: number;

  material: {
    capturedPiece: string | null;
    capturedPieceValue: number | null;
    attackedPieces: Array<{
      square: string;
      piece: string;
      value: number;
    }>;
    attackedHighValuePieces: Array<{
      square: string;
      piece: string;
      value: number;
    }>;
    roughImmediateMaterialGain: number;
    materialPhrases: string[];
  };

  pieceActivity: {
    movedPiece: string | null;
    movedPieceAfterMove: string | null;
    from: string | null;
    to: string | null;
    isDrop: boolean;
    isPromotion: boolean;
    promotedPiece: string | null;
    attacksAfterMoveCount: number;
    attacksHighValuePiece: boolean;
    openedLongRangeLines: string[];
    blockedOwnLongRangeLines: string[];
    activityPhrases: string[];
  };

  kingSafety: {
    ownKingSquare: string | null;
    opponentKingSquare: string | null;
    ownKingNearbyDefendersBefore: number | null;
    ownKingNearbyDefendersAfter: number | null;
    opponentAttacksNearOwnKingBefore: number | null;
    opponentAttacksNearOwnKingAfter: number | null;
    ownKingSafetyDelta: number | null;
    kingSafetyPhrases: string[];
    confidence: 'none' | 'low' | 'medium';
  };

  summaryPhrases: string[];
};

export type DraftLineContinuationFeatures = {
  choiceId: number;
  lineFirstMoves: string[];

  firstResponse: string | null;
  firstResponseLabel: string | null;

  nextOwnMove: string | null;
  nextOwnMoveLabel: string | null;

  nextOwnMoveFacts: string[];
  continuationPhrases: string[];

  movedPieceContinuesAfterResponse: boolean;
  movedPiecePromotesAfterResponse: boolean;
  movedPieceCapturesAfterResponse: boolean;
};

export type DraftChoiceContrastDiagnosis =
  | 'small_gain_but_no_continuation'
  | 'small_gain_but_weaker_than_correct'
  | 'low_value_gain_vs_major_piece_attack'
  | 'attacks_piece_but_no_followup'
  | 'slow_pawn_push'
  | 'no_high_value_attack'
  | 'no_tactical_followup'
  | 'no_continuation_compared_to_correct'
  | 'quiet_move_with_large_eval_gap'
  | 'weaker_material_gain'
  | 'promotion_or_capture_missing'
  | 'king_safety_risk'
  | 'natural_but_worse'
  | 'unclear';

export type DraftChoiceContrastFeatures = {
  choiceId: number;
  comparedToCorrectChoiceId: number;

  correctStrengths: string[];
  ownStrengths: string[];

  missingComparedToCorrect: string[];
  missingCorrectEvidence: Array<{
    category:
      | 'material'
      | 'pieceActivity'
      | 'lineContinuation'
      | 'threat'
      | 'defense'
      | 'kingSafety';
    phrase: string;
    evidenceLevel: 'direct' | 'line_observed' | 'heuristic' | 'eval_supported';
    confidence: 'low' | 'medium' | 'high';
    source: 'correct_usableEvidence' | 'correct_evidenceChain';
    textUsefulness?: 'must_use' | 'useful' | 'optional' | 'low_value' | 'avoid';
  }>;
  ownCompensatingEvidence: Array<{
    category:
      | 'material'
      | 'pieceActivity'
      | 'lineContinuation'
      | 'threat'
      | 'defense'
      | 'kingSafety';
    phrase: string;
    confidence: 'low' | 'medium' | 'high';
  }>;
  contrastUsablePhrases: string[];

  contrastPhrases: string[];

  diagnosis: DraftChoiceContrastDiagnosis;
  confidence: 'none' | 'low' | 'medium';
};

export type DraftFeatureCategory =
  | 'material'
  | 'pieceActivity'
  | 'kingSafety'
  | 'lineContinuation'
  | 'contrast'
  | 'threat'
  | 'defense';

export type DraftFeatureEvidenceLevel =
  | 'direct'
  | 'line_observed'
  | 'heuristic'
  | 'eval_supported'
  | 'weak'
  | 'none';

export type DraftUsableExplanationEvidence = {
  category: DraftFeatureCategory;
  phrase: string;
  evidenceLevel: DraftFeatureEvidenceLevel;
  confidence: 'low' | 'medium' | 'high';
  source:
    | 'move_facts'
    | 'position_features'
    | 'line_trajectory'
    | 'contrast_features';
  ply?: number;
  evalSupport?: 'positive' | 'negative' | 'neutral' | 'unknown';
};

export type DraftEvidenceChainStep = {
  ply: number;
  usi: string | null;
  label: string | null;
  side: 'choice' | 'opponent' | 'self' | 'unknown';
  role:
    | 'candidate_move'
    | 'opponent_response'
    | 'next_own_move'
    | 'capture'
    | 'promotion'
    | 'defense'
    | 'threat'
    | 'material_gain'
    | 'king_safety'
    | 'other';
  fact: string;
  candidateLabelAllowedInText?: boolean;
  lineLabelsPreferred?: boolean;
};

export type DraftEvidenceChain = {
  id: string;
  choiceId: number;
  category:
    | 'material'
    | 'pieceActivity'
    | 'kingSafety'
    | 'lineContinuation'
    | 'contrast'
    | 'threat'
    | 'defense';
  confidence: 'low' | 'medium' | 'high';
  evidenceLevel: DraftFeatureEvidenceLevel;
  priority: number;
  steps: DraftEvidenceChainStep[];
  resultPhrase: string;
  usablePhrase: string;
  textUsefulness:
    | 'must_use'
    | 'useful'
    | 'optional'
    | 'low_value'
    | 'avoid';
  textUsefulnessReason: string[];
  beneficiary:
    | 'choice_side'
    | 'opponent'
    | 'both'
    | 'unclear';
  isGoodForChoice: boolean | null;
  limitations: string[];
};

export type DraftCorrectAttackContinuationEvidence = {
  choiceId: number;
  category:
    | 'lineContinuation'
    | 'threat'
    | 'material'
    | 'pieceActivity'
    | 'promotion'
    | 'kingPressure';
  phrase: string;
  usablePhrase: string;
  confidence: 'low' | 'medium' | 'high';
  evidenceLevel: 'direct' | 'line_observed' | 'heuristic';
  source:
    | 'move_facts'
    | 'line_trajectory'
    | 'evidence_chain'
    | 'position_features';
  lineLabels?: string[];
  textUsefulness?: 'must_use' | 'useful' | 'optional' | 'low_value' | 'avoid';
};

export type DraftLineSnapshot = {
  ply: number;
  moveUsi: string | null;
  moveLabel: string | null;

  material: {
    ownMaterialScore: number;
    opponentMaterialScore: number;
    materialBalanceFromChoiceSide: number;
    capturedPieces: string[];
    promotedPieces: string[];
  };

  pieceActivity: {
    attackedPieces: Array<{
      square: string;
      piece: string;
      value: number;
    }>;
    attackedHighValuePieces: Array<{
      square: string;
      piece: string;
      value: number;
    }>;
    longRangePieceActivityCount: number;
    ownAttacksNearOpponentKing: number | null;
  };

  kingSafety: {
    ownKingSquare: string | null;
    opponentKingSquare: string | null;
    ownKingNearbyDefenders: number | null;
    opponentAttacksNearOwnKing: number | null;
    ownAttacksNearOpponentKing: number | null;
  };
};

export type DraftLineTrajectoryFeatures = {
  choiceId: number;

  snapshots: DraftLineSnapshot[];

  materialTrend: {
    afterChoiceDelta: number | null;
    afterPly3Delta: number | null;
    afterPly5Delta: number | null;
    phrases: string[];
    confidence: 'none' | 'low' | 'medium' | 'high';
  };

  pieceActivityTrend: {
    highValueAttackCreated: boolean;
    highValueAttackMaintained: boolean;
    highValueAttackLost: boolean;
    attackNearOpponentKingDeltaPly5: number | null;
    phrases: string[];
    confidence: 'none' | 'low' | 'medium' | 'high';
  };

  kingSafetyTrend: {
    ownKingSafetyDeltaPly5: number | null;
    opponentKingPressureDeltaPly5: number | null;
    phrases: string[];
    confidence: 'none' | 'low' | 'medium';
  };

  usableEvidence: DraftUsableExplanationEvidence[];
  evidenceChains: DraftEvidenceChain[];
  correctAttackContinuationEvidence: DraftCorrectAttackContinuationEvidence[];
};

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
    moveFacts?: DraftMoveFacts;
    positionFeatures?: DraftPositionFeatures;
    lineContinuationFeatures?: DraftLineContinuationFeatures;
    contrastFeatures?: DraftChoiceContrastFeatures;
    lineTrajectoryFeatures?: DraftLineTrajectoryFeatures;
  };
};

export type ExplanationChoiceResult = {
  choiceId: number;
  explanation: string;
};

export type GenerateChoiceExplanationsInput = {
  problem: DraftProblem;
  choices: DraftProblemChoice[];
};

export type GenerateChoiceExplanationsResult = {
  problemId: number;
  choices: ExplanationChoiceResult[];
};

export type LlmExplanationChoice = {
  choice_id: number;
  explanation: string;
};

export type LlmExplanationResponse = {
  choices: LlmExplanationChoice[];
};
