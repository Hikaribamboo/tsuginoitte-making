import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  ExplanationChoiceDiagnostics,
  ExplanationDiagnosticCode,
  ExplanationDiagnosticsReport,
} from './diagnoseExplanationDebug.js';
import type {
  DraftChoiceContrastFeatures,
  DraftEvidenceChain,
  DraftLineContinuationFeatures,
  DraftLineTrajectoryFeatures,
  DraftMoveFacts,
  DraftPositionFeatures,
  DraftProblemChoice,
  ExplanationPlan,
  LlmExplanationResponse,
} from './types.js';
import {
  ExplanationValidationError,
  validateExplanations,
  type ExplanationValidationIssue,
} from './validateExplanations.js';

type MetricValue = number | null;

type EvaluationMetrics = {
  factuality: {
    unsupportedClaimRate: MetricValue;
    unsupportedEscapeRate: MetricValue;
    unsupportedCounterattackRate: MetricValue;
    unsupportedKingDangerRate: MetricValue;
    unsupportedMaterialClaimRate: MetricValue;
    unsupportedLineClaimRate: MetricValue;
  };
  humanStyle: {
    styleBadPhraseRate: MetricValue;
    avgSentenceCount: MetricValue;
    avgCharLength: MetricValue;
    labelStartRate: MetricValue;
    candidateMoveSubjectRate: MetricValue;
    aiGenericPhraseRate: MetricValue;
    humanStylePatternMatchRate: MetricValue;
  };
  specificity: {
    specificPieceMentionRate: MetricValue;
    specificSquareMentionRate: MetricValue;
    lineLabelUsageRate: MetricValue;
    evidenceChainUsageRate: MetricValue;
    ownStrengthUsageRate: MetricValue;
    genericWrongChoiceOnlyRate: MetricValue;
    vagueWrongChoiceReasonRate: MetricValue;
  };
  contrast: {
    contrastFeatureCoverage: MetricValue;
    contrastPhraseUsageRate: MetricValue;
    missingContrastFeatureRate: MetricValue;
    weakWrongChoiceReasonRate: MetricValue;
    repetitiveWrongChoiceTemplateRate: MetricValue;
  };
  contrastEvidence: {
    wrongChoiceHasOwnStrengthAndMissingCorrectEvidenceRate: MetricValue;
    wrongChoiceOnlyGenericContrastRate: MetricValue;
    correctEvidenceAvailableButUnusedRate: MetricValue;
    missingCorrectEvidenceCoverage: MetricValue;
  };
  humanPatternSpecific: {
    wrongNaturalButWorse: {
      detectedCount: number;
      usedWellCount: number;
      usedWellRate: MetricValue;
      missingOwnStrengthRate: MetricValue;
      missingCorrectDifferenceRate: MetricValue;
      tooGenericRate: MetricValue;
    };
    correctAttackContinues: {
      detectedCount: number;
      usedWellCount: number;
      usedWellRate: MetricValue;
      tooGenericRate: MetricValue;
      missingSpecificFollowupRate: MetricValue;
      chainAvailableButUnusedRate: MetricValue;
      noConcreteEvidenceRate: MetricValue;
    };
  };
  evidence: {
    evidenceChainCountPerChoice: MetricValue;
    mediumHighEvidenceChainCount: MetricValue;
    chainAvailableButNotUsedRate: MetricValue;
    lineLabelExpectedButMissingRate: MetricValue;
    usefulLineChainAvailableRate: MetricValue;
    usefulLineChainUsedRate: MetricValue;
    usefulLineChainExpectedButMissingRate: MetricValue;
    lowValueLineChainSkippedRate: MetricValue;
    lineLabelUsageRate: MetricValue;
    missingEvidenceChainRate: MetricValue;
    missingMaterialChainRate: MetricValue;
    missingActivityChainRate: MetricValue;
    missingDefenseChainRate: MetricValue;
  };
  shogiFeatureRichness: {
    materialEvidenceCount: number;
    pieceActivityEvidenceCount: number;
    kingSafetyEvidenceCount: number;
    lineObservedEvidenceCount: number;
    directEvidenceCount: number;
    heuristicEvidenceCount: number;
    avgUsableEvidenceCount: MetricValue;
    avgHighMediumEvidenceCount: MetricValue;
    lowUsableEvidenceRate: MetricValue;
  };
  humanPatternCoverage: {
    excludingUnknown: {
      extractorWeightedCoverage: MetricValue;
      currentObservedCoverage: MetricValue;
      extractorStrongPatternCount: number;
      extractorPartialPatternCount: number;
      extractorWeakPatternCount: number;
      extractorUnsupportedPatternCount: number;
      currentStrongPatternCount: number;
      currentWeakPatternCount: number;
      currentUnsupportedPatternCount: number;
      currentNotObservedPatternCount: number;
    };
    unknownCount: number;
    unknownShare: MetricValue;
  };
};

export type HumanPatternCoverageRow = {
  pattern: string;
  humanCount: number;
  requiredEvidence: string[];
  extractorSupport: 'strong' | 'partial' | 'weak' | 'unsupported';
  currentOutputSupport: 'strong' | 'weak' | 'unsupported' | 'not_observed';
  currentOutputCount: number;
  notes: string[];
};

export type ExplanationQualityEvaluationSummary = {
  generatedAt: string;
  debugRoot: string;
  problemCount: number;
  choiceCount: number;
  wrongChoiceCount: number;
  metrics: EvaluationMetrics;
  metricDefinitions: Record<string, Record<string, string>>;
  humanPatterns: HumanPatternCoverageRow[];
  measurementNotes: string[];
};

type AnalysisSummaryLike = {
  choiceCount?: number;
  averageExplanationLengthCorrect?: number | null;
  averageExplanationLengthWrong?: number | null;
  medianExplanationLengthCorrect?: number | null;
  medianExplanationLengthWrong?: number | null;
  planPrimaryReasonCountsAll?: Record<string, number>;
};

type DebugInput = {
  problem?: {
    id?: number;
    correct_choice_id?: number;
  };
  choices?: Array<{
    choice_id?: number;
    label?: string;
    draft_problem_id?: number;
    usi?: string;
    eval_cp?: number | null;
    eval_percent?: number | null;
    line?: string[];
  }>;
};

type ValidationIssueLike = {
  code?: string;
  severity?: string;
  choiceId?: number;
  message?: string;
};

type StyleRepairOutputLike = LlmExplanationResponse & {
  repairedChoiceIds?: number[];
};

type ChoiceDebug = {
  report: ExplanationDiagnosticsReport;
  diagnostics: ExplanationChoiceDiagnostics;
  input?: DebugInput;
  plan?: ExplanationPlan;
  moveFacts?: DraftMoveFacts;
  positionFeatures?: DraftPositionFeatures;
  lineTrajectory?: DraftLineTrajectoryFeatures;
  contrastFeatures?: DraftChoiceContrastFeatures;
  evidenceChains: DraftEvidenceChain[];
  llmExplanation?: string;
  retryExplanation?: string;
  finalExplanation: string;
};

type FeatureRequirement = {
  requiredEvidence: string[];
  categories: string[];
};

type LineLabelMissingReason =
  | 'llm_used_result_phrase_only'
  | 'usable_phrase_not_in_prompt'
  | 'usable_phrase_too_long'
  | 'line_label_removed_by_repair'
  | 'candidate_label_filter_too_aggressive'
  | 'chain_priority_too_low'
  | 'unknown';

type LineLabelMissingAnalysisItem = {
  problemId: number | null;
  choiceId: number;
  explanation: string;
  expectedLineLabels: string[];
  chainUsablePhrase: string;
  chainResultPhrase: string;
  chainCategory: DraftEvidenceChain['category'];
  chainPriority: number;
  reasonNotUsed: LineLabelMissingReason;
};

type MissingEvidenceChainReason =
  | 'usable_evidence_has_no_line_steps'
  | 'line_too_short'
  | 'only_direct_fact_no_chain_needed'
  | 'extractor_missing_material_chain'
  | 'extractor_missing_activity_chain'
  | 'extractor_missing_defense_chain'
  | 'low_confidence_only'
  | 'unknown';

type MissingEvidenceChainAnalysisItem = {
  problemId: number | null;
  choiceId: number;
  explanation: string;
  usableEvidence: Array<{
    category: string;
    phrase: string;
    evidenceLevel: string;
    confidence: string;
    ply?: number;
  }>;
  evidenceChainCount: number;
  mediumHighEvidenceChainCount: number;
  missingChainCategories: string[];
  diagnosticCodes: string[];
  reason: MissingEvidenceChainReason;
};

type RetryIssueKind =
  | 'unsupported_line_claim'
  | 'unsupported_counterattack'
  | 'unsupported_escape'
  | 'unsupported_claim'
  | 'too_many_sentences'
  | 'other';

type RetryAnalysisItem = {
  problemId: number | null;
  debugDir: string;
  retryChoiceIds: number[];
  issueKinds: RetryIssueKind[];
  retryFailedSameOutput: boolean;
  sameChoiceIds: number[];
  fallbackUsed: boolean;
  softIssueSurvivedFinal: number;
  hardIssueSurvivedFinal: number;
  initialIssues: Array<{
    code: string;
    severity: string;
    choiceId: number | null;
    message: string;
    kind: RetryIssueKind;
  }>;
  initialExplanations: Array<{ choiceId: number; explanation: string }>;
  retryExplanations: Array<{ choiceId: number; explanation: string }>;
  finalExplanations: Array<{ choiceId: number; explanation: string }>;
};

type NextMetricRecommendation = {
  recommendedNextMetric: string;
  reason: string;
  candidateFixes: Array<{
    target: string;
    description: string;
  }>;
  metricsToProtect: string[];
};

const PIECE_PATTERN = /[歩香桂銀金角飛玉王と馬龍竜]/;
const SQUARE_PATTERN = /[１-９][一二三四五六七八九]|[1-9][1-9]/;
const HUMAN_STYLE_LENGTH_TOLERANCE = 18;
const LINE_LABEL_ROLES = new Set<DraftEvidenceChain['steps'][number]['role']>([
  'opponent_response',
  'next_own_move',
  'defense',
  'threat',
  'material_gain',
  'promotion',
]);

const REQUIRED_BY_PATTERN: Record<string, FeatureRequirement> = {
  correct_attack_continues: {
    requiredEvidence: ['lineContinuation', 'pieceActivity'],
    categories: ['lineContinuation', 'pieceActivity', 'threat'],
  },
  correct_defense_works: {
    requiredEvidence: ['defenseChain', 'kingSafety'],
    categories: ['defense', 'kingSafety'],
  },
  correct_material_gain: {
    requiredEvidence: ['material', 'lineContinuation'],
    categories: ['material', 'lineContinuation'],
  },
  correct_forcing_sequence: {
    requiredEvidence: ['lineContinuation', 'threat'],
    categories: ['lineContinuation', 'threat'],
  },
  correct_tactical_gain: {
    requiredEvidence: ['pieceActivity', 'material'],
    categories: ['pieceActivity', 'material', 'threat'],
  },
  wrong_attack_disappears: {
    requiredEvidence: ['contrast', 'lineContinuation'],
    categories: ['contrast', 'lineContinuation'],
  },
  wrong_opponent_escapes: {
    requiredEvidence: ['lineContinuation', 'pieceActivity'],
    categories: ['lineContinuation', 'pieceActivity'],
  },
  wrong_opponent_blocks_line: {
    requiredEvidence: ['lineContinuation', 'defenseChain'],
    categories: ['lineContinuation', 'defense'],
  },
  wrong_no_threat: {
    requiredEvidence: ['contrast', 'pieceActivity'],
    categories: ['contrast', 'pieceActivity', 'threat'],
  },
  wrong_too_slow: {
    requiredEvidence: ['contrast', 'lineContinuation'],
    categories: ['contrast', 'lineContinuation'],
  },
  wrong_material_loss: {
    requiredEvidence: ['material', 'contrast'],
    categories: ['material', 'contrast'],
  },
  wrong_gives_pieces: {
    requiredEvidence: ['material', 'kingSafety'],
    categories: ['material', 'kingSafety'],
  },
  wrong_king_safety_risk: {
    requiredEvidence: ['kingSafety', 'defenseChain'],
    categories: ['kingSafety', 'defense'],
  },
  wrong_bad_move_short: {
    requiredEvidence: ['contrast'],
    categories: ['contrast'],
  },
  wrong_natural_but_worse: {
    requiredEvidence: ['contrast', 'ownStrength'],
    categories: ['contrast', 'pieceActivity', 'material'],
  },
  unknown: {
    requiredEvidence: ['unclassifiedHumanPattern'],
    categories: [],
  },
};

const EXTRACTOR_SUPPORT_BY_PATTERN: Record<string, HumanPatternCoverageRow['extractorSupport']> = {
  correct_attack_continues: 'partial',
  correct_defense_works: 'partial',
  correct_material_gain: 'strong',
  correct_forcing_sequence: 'partial',
  correct_tactical_gain: 'partial',
  wrong_attack_disappears: 'strong',
  wrong_opponent_escapes: 'strong',
  wrong_opponent_blocks_line: 'partial',
  wrong_no_threat: 'weak',
  wrong_too_slow: 'strong',
  wrong_material_loss: 'strong',
  wrong_gives_pieces: 'strong',
  wrong_king_safety_risk: 'partial',
  wrong_bad_move_short: 'strong',
  wrong_natural_but_worse: 'partial',
  unknown: 'unsupported',
};

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  if (!(await exists(filePath))) return undefined;
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

function byChoiceId<T extends { choiceId?: number }>(items: T[] | undefined): Map<number, T> {
  const map = new Map<number, T>();
  for (const item of items ?? []) {
    if (typeof item.choiceId === 'number') map.set(item.choiceId, item);
  }
  return map;
}

function validationIssuesByChoiceId(issues: ExplanationValidationIssue[] | undefined): Map<number, ExplanationValidationIssue[]> {
  const map = new Map<number, ExplanationValidationIssue[]>();
  for (const issue of issues ?? []) {
    if (typeof issue.choiceId !== 'number') continue;
    const bucket = map.get(issue.choiceId) ?? [];
    bucket.push(issue);
    map.set(issue.choiceId, bucket);
  }
  return map;
}

function phraseFromIssueMessage(message: string): string | null {
  return message.match(/"([^"]+)"/)?.[1] ?? null;
}

function planByChoiceId(plans: ExplanationPlan[] | undefined): Map<number, ExplanationPlan> {
  const map = new Map<number, ExplanationPlan>();
  for (const plan of plans ?? []) map.set(plan.choiceId, plan);
  return map;
}

function evidenceChainsByChoiceId(items: Array<{ choiceId?: number; evidenceChains?: DraftEvidenceChain[] }> | undefined): Map<number, DraftEvidenceChain[]> {
  const map = new Map<number, DraftEvidenceChain[]>();
  for (const item of items ?? []) {
    if (typeof item.choiceId === 'number') map.set(item.choiceId, item.evidenceChains ?? []);
  }
  return map;
}

function outputChoices(response: LlmExplanationResponse | undefined): Array<{ choiceId: number; explanation: string }> {
  return (response?.choices ?? [])
    .map((choice) => ({
      choiceId: typeof choice.choice_id === 'number' ? choice.choice_id : null,
      explanation: typeof choice.explanation === 'string' ? choice.explanation.trim() : '',
    }))
    .filter((choice): choice is { choiceId: number; explanation: string } => choice.choiceId !== null);
}

function hasDiagnostic(choice: ExplanationChoiceDiagnostics, code: ExplanationDiagnosticCode): boolean {
  return choice.diagnostics.some((diagnostic) => diagnostic.code === code);
}

function rate(numerator: number, denominator: number): MetricValue {
  return denominator === 0 ? null : numerator / denominator;
}

function average(values: number[]): MetricValue {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sentenceCount(text: string): number {
  return text.split('。').map((sentence) => sentence.trim()).filter(Boolean).length;
}

function strongChains(chains: DraftEvidenceChain[]): DraftEvidenceChain[] {
  return chains.filter((chain) =>
    (chain.confidence === 'high' || chain.confidence === 'medium') &&
    chain.evidenceLevel !== 'weak' &&
    chain.evidenceLevel !== 'none'
  );
}

function chainBeneficiary(chain: DraftEvidenceChain): DraftEvidenceChain['beneficiary'] {
  if (chain.beneficiary) return chain.beneficiary;
  const materialRoles = new Set<DraftEvidenceChain['steps'][number]['role']>(['capture', 'material_gain', 'promotion']);
  const materialSteps = chain.steps.filter((step) => materialRoles.has(step.role));
  if (materialSteps.some((step) => step.side === 'opponent')) return 'opponent';
  if (materialSteps.some((step) => step.side === 'choice' || step.side === 'self')) return 'choice_side';
  if (chain.steps.some((step) => (step.side === 'choice' || step.side === 'self') && step.role === 'next_own_move')) {
    return 'choice_side';
  }
  return 'unclear';
}

function chainTextUsefulness(chain: DraftEvidenceChain, isCorrectChoice?: boolean): DraftEvidenceChain['textUsefulness'] {
  if (chain.textUsefulness) return chain.textUsefulness;
  const beneficiary = chainBeneficiary(chain);
  if (beneficiary === 'opponent') return 'avoid';
  if (chain.resultPhrase.includes('一歩取れる') || chain.usablePhrase.includes('一歩取れる')) return 'optional';
  const isCaptureOnly = chain.resultPhrase.includes('取れる') || chain.usablePhrase.includes('取れる');
  const isMajorPieceCapture = chain.resultPhrase.includes('飛車を取れる') ||
    chain.resultPhrase.includes('角を取れる') ||
    chain.usablePhrase.includes('飛車を取れる') ||
    chain.usablePhrase.includes('角を取れる');
  if (isCorrectChoice === false && chain.category === 'lineContinuation' && isCaptureOnly && !isMajorPieceCapture) {
    return 'low_value';
  }
  if (
    (chain.category === 'lineContinuation' || chain.category === 'defense' || chain.category === 'threat') &&
    (chain.confidence === 'high' || chain.confidence === 'medium') &&
    chain.priority >= 80
  ) return 'useful';
  return 'optional';
}

function usefulLineChains(chains: DraftEvidenceChain[], isCorrectChoice?: boolean): DraftEvidenceChain[] {
  return chains.filter((chain) =>
    (chainTextUsefulness(chain, isCorrectChoice) === 'must_use' || chainTextUsefulness(chain, isCorrectChoice) === 'useful') &&
    (chain.confidence === 'high' || chain.confidence === 'medium') &&
    (chainBeneficiary(chain) === 'choice_side' || chainBeneficiary(chain) === 'both') &&
    expectedLineLabelSteps(chain).length > 0
  );
}

function lowValueLineChains(chains: DraftEvidenceChain[], isCorrectChoice?: boolean): DraftEvidenceChain[] {
  return chains.filter((chain) =>
    (chainTextUsefulness(chain, isCorrectChoice) === 'low_value' ||
      chainTextUsefulness(chain, isCorrectChoice) === 'avoid' ||
      chainTextUsefulness(chain, isCorrectChoice) === 'optional') &&
    expectedLineLabelSteps(chain).length > 0
  );
}

function chainUsedInExplanation(explanation: string, chain: DraftEvidenceChain): boolean {
  if (explanation.includes(chain.usablePhrase) || explanation.includes(chain.resultPhrase)) return true;
  return chain.steps.some((step) =>
    (step.label !== null && explanation.includes(step.label)) ||
    (step.fact.trim() !== '' && explanation.includes(step.fact))
  );
}

function usesLineLabel(explanation: string, chains: DraftEvidenceChain[]): boolean {
  return chains.some((chain) => chain.steps.some((step) =>
    step.side !== 'choice' &&
    step.label !== null &&
    LINE_LABEL_ROLES.has(step.role) &&
    explanation.includes(step.label)
  ));
}

function usableEvidence(lineTrajectory?: DraftLineTrajectoryFeatures) {
  return (lineTrajectory?.usableEvidence ?? []).filter((item) =>
    item.evidenceLevel !== 'weak' &&
    item.evidenceLevel !== 'none'
  );
}

function isWrongChoice(choice: ChoiceDebug): boolean {
  if (typeof choice.plan?.isCorrect === 'boolean') return !choice.plan.isCorrect;
  return choice.report.problemId !== null && choice.diagnostics.choiceId !== choice.plan?.choiceId;
}

function usesOwnStrength(choice: ChoiceDebug): boolean {
  const ownStrengths = [
    ...(choice.contrastFeatures?.ownStrengths ?? []),
    ...(choice.contrastFeatures?.ownCompensatingEvidence ?? []).map((item) => item.phrase),
  ];
  if (ownStrengths.length === 0) return false;
  return ownStrengths.some((phrase) => phrase.trim() !== '' && choice.diagnostics.explanation.includes(phrase));
}

function usesContrastPhrase(choice: ChoiceDebug): boolean {
  const phrases = [
    ...(choice.contrastFeatures?.contrastUsablePhrases ?? []),
    ...(choice.contrastFeatures?.contrastPhrases ?? []),
  ];
  return phrases.some((phrase) => phrase.trim() !== '' && choice.diagnostics.explanation.includes(phrase));
}

function hasMissingCorrectEvidence(choice: ChoiceDebug): boolean {
  return (choice.contrastFeatures?.missingCorrectEvidence.length ?? 0) > 0;
}

function hasOwnStrengthAndMissingCorrectEvidenceDiagnostic(choice: ChoiceDebug): boolean {
  return hasDiagnostic(choice.diagnostics, 'wrong_choice_uses_own_strength_and_missing_correct_evidence');
}

function wrongNaturalButWorseDetected(choice: ChoiceDebug): boolean {
  return hasDiagnostic(choice.diagnostics, 'wrong_natural_but_worse_detected');
}

function wrongNaturalButWorseUsedWell(choice: ChoiceDebug): boolean {
  return hasDiagnostic(choice.diagnostics, 'wrong_natural_but_worse_used_well');
}

function correctAttackContinuesDetected(choice: ChoiceDebug): boolean {
  return hasDiagnostic(choice.diagnostics, 'correct_attack_continues_detected');
}

function correctAttackContinuesUsedWell(choice: ChoiceDebug): boolean {
  return hasDiagnostic(choice.diagnostics, 'correct_attack_continues_used_well');
}

function expectedHumanLength(analysisSummary?: AnalysisSummaryLike): number | null {
  const values = [
    analysisSummary?.medianExplanationLengthCorrect,
    analysisSummary?.medianExplanationLengthWrong,
    analysisSummary?.averageExplanationLengthCorrect,
    analysisSummary?.averageExplanationLengthWrong,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function readChoiceDebug(report: ExplanationDiagnosticsReport): Promise<ChoiceDebug[]> {
  const debugDir = report.debugDir;
  const input = await readJsonIfExists<DebugInput>(path.join(debugDir, 'input.json'));
  const moveFacts = byChoiceId(await readJsonIfExists<DraftMoveFacts[]>(path.join(debugDir, 'move-facts.json')));
  const positionFeatures = byChoiceId(await readJsonIfExists<DraftPositionFeatures[]>(path.join(debugDir, 'position-features.json')));
  const lineTrajectory = byChoiceId(await readJsonIfExists<DraftLineTrajectoryFeatures[]>(path.join(debugDir, 'line-trajectory-features.json')));
  const contrastFeatures = byChoiceId(await readJsonIfExists<DraftChoiceContrastFeatures[]>(path.join(debugDir, 'contrast-features.json')));
  const chainsByChoice = evidenceChainsByChoiceId(await readJsonIfExists<Array<{ choiceId?: number; evidenceChains?: DraftEvidenceChain[] }>>(path.join(debugDir, 'evidence-chains.json')));
  const plans = planByChoiceId(await readJsonIfExists<ExplanationPlan[]>(path.join(debugDir, 'plans.json')));
  const validated = await readJsonIfExists<LlmExplanationResponse>(path.join(debugDir, 'validated.json'));
  const fallback = await readJsonIfExists<LlmExplanationResponse>(path.join(debugDir, 'fallback-output.json'));
  const retry = await readJsonIfExists<LlmExplanationResponse>(path.join(debugDir, 'retry-llm-output.json'));
  const llm = await readJsonIfExists<LlmExplanationResponse>(path.join(debugDir, 'llm-output.json'));
  const outputByChoice = new Map(outputChoices(validated ?? fallback ?? retry ?? llm).map((choice) => [choice.choiceId, choice.explanation]));
  const llmByChoice = new Map(outputChoices(llm).map((choice) => [choice.choiceId, choice.explanation]));
  const retryByChoice = new Map(outputChoices(retry).map((choice) => [choice.choiceId, choice.explanation]));

  return report.choices.map((diagnostics) => {
    const plan = plans.get(diagnostics.choiceId);
    const finalExplanation = outputByChoice.get(diagnostics.choiceId) ?? diagnostics.explanation;
    return {
      report: input?.problem?.id === undefined ? report : { ...report, problemId: input.problem.id ?? report.problemId },
      diagnostics: {
        ...diagnostics,
        explanation: finalExplanation,
      },
      input,
      plan,
      moveFacts: moveFacts.get(diagnostics.choiceId),
      positionFeatures: positionFeatures.get(diagnostics.choiceId),
      lineTrajectory: lineTrajectory.get(diagnostics.choiceId),
      contrastFeatures: contrastFeatures.get(diagnostics.choiceId),
      evidenceChains: chainsByChoice.get(diagnostics.choiceId) ?? lineTrajectory.get(diagnostics.choiceId)?.evidenceChains ?? [],
      llmExplanation: llmByChoice.get(diagnostics.choiceId),
      retryExplanation: retryByChoice.get(diagnostics.choiceId),
      finalExplanation,
    };
  });
}

function evidenceCategoryCount(choices: ChoiceDebug[], category: string): number {
  return choices.reduce((sum, choice) =>
    sum + usableEvidence(choice.lineTrajectory).filter((item) => item.category === category).length,
  0);
}

function evidenceLevelCount(choices: ChoiceDebug[], evidenceLevel: string): number {
  return choices.reduce((sum, choice) =>
    sum + usableEvidence(choice.lineTrajectory).filter((item) => item.evidenceLevel === evidenceLevel).length,
  0);
}

function extractorSupport(pattern: string): HumanPatternCoverageRow['extractorSupport'] {
  return EXTRACTOR_SUPPORT_BY_PATTERN[pattern] ?? 'unsupported';
}

function currentOutputSupport(pattern: string, choices: ChoiceDebug[]): HumanPatternCoverageRow['currentOutputSupport'] {
  const matching = choices.filter((choice) => choice.plan?.primaryReason === pattern);
  if (matching.length === 0) return 'not_observed';
  if (pattern === 'correct_attack_continues') {
    return matching.some(correctAttackContinuesUsedWell) ? 'strong' : 'weak';
  }
  if (pattern === 'wrong_natural_but_worse') {
    return matching.some(wrongNaturalButWorseUsedWell) ? 'strong' : 'weak';
  }
  const strong = matching.filter((choice) =>
    (
      hasDiagnostic(choice.diagnostics, 'ok_uses_fact_phrase') ||
      hasDiagnostic(choice.diagnostics, 'ok_uses_continuation') ||
      usesContrastPhrase(choice) ||
      strongChains(choice.evidenceChains).some((chain) => chainUsedInExplanation(choice.diagnostics.explanation, chain))
    ) &&
    !hasDiagnostic(choice.diagnostics, 'missing_contrast_feature') &&
    !hasDiagnostic(choice.diagnostics, 'generic_wrong_choice_only') &&
    !hasDiagnostic(choice.diagnostics, 'weak_wrong_choice_reason')
  ).length;
  return strong > 0 ? 'strong' : 'weak';
}

function buildHumanPatternCoverage(
  analysisSummary: AnalysisSummaryLike | undefined,
  choices: ChoiceDebug[],
): HumanPatternCoverageRow[] {
  const humanCounts = analysisSummary?.planPrimaryReasonCountsAll ?? {};
  const currentPatterns = choices
    .map((choice) => choice.plan?.primaryReason)
    .filter((pattern): pattern is ExplanationPlan['primaryReason'] => pattern !== undefined);
  const patternNames = Array.from(new Set<string>([
    ...Object.keys(humanCounts),
    ...currentPatterns,
    ...Object.keys(REQUIRED_BY_PATTERN),
  ]));

  return patternNames
    .map((pattern) => {
      const support = currentOutputSupport(pattern, choices);
      const requirement = REQUIRED_BY_PATTERN[pattern] ?? REQUIRED_BY_PATTERN.unknown;
      const humanCount = humanCounts[pattern] ?? 0;
      const currentOutputCount = choices.filter((choice) => choice.plan?.primaryReason === pattern).length;
      const supportByExtractor = extractorSupport(pattern);
      return {
        pattern,
        humanCount,
        requiredEvidence: requirement.requiredEvidence,
        extractorSupport: supportByExtractor,
        currentOutputSupport: support,
        currentOutputCount,
        notes: [
          ...(humanCount === 0 ? ['not observed in current 600-set analysis summary'] : []),
          ...(currentOutputCount === 0 ? ['not_observed in current 17-problem output'] : []),
          ...(supportByExtractor === 'weak' || supportByExtractor === 'unsupported' ? ['required evidence is not well represented by current debug features'] : []),
        ],
      } satisfies HumanPatternCoverageRow;
    })
    .sort((a, b) => b.humanCount - a.humanCount || a.pattern.localeCompare(b.pattern));
}

function metricDefinitions(): ExplanationQualityEvaluationSummary['metricDefinitions'] {
  return {
    factuality: {
      unsupportedClaimRate: 'choices with strong value/endgame claims unsupported by debug features / all choices',
      unsupportedEscapeRate: 'choices with escape phrasing unsupported by move or line features / all choices',
      unsupportedCounterattackRate: 'choices with counterattack phrasing unsupported by move, position, or line features / all choices',
      unsupportedKingDangerRate: 'choices with king-danger phrasing unsupported by kingSafety features / all choices',
      unsupportedMaterialClaimRate: 'choices with material comparison phrasing unsupported by material features / all choices',
      unsupportedLineClaimRate: 'currently measurable as unsupported line-continuation validation issues / all choices',
    },
    humanStyle: {
      styleBadPhraseRate: 'choices containing phrases currently marked as bad or too AI-like / all choices',
      avgSentenceCount: 'average Japanese full-stop sentence count',
      avgCharLength: 'average explanation character length',
      labelStartRate: 'choices starting with candidate move label / all choices',
      candidateMoveSubjectRate: 'choices using the candidate move itself as the grammatical subject / all choices',
      aiGenericPhraseRate: 'choices containing generic AI-like phrases / all choices',
      humanStylePatternMatchRate: 'choices close to 600-set length, <=2 sentences, and without generic/bad style diagnostics / all choices',
    },
    specificity: {
      specificPieceMentionRate: 'choices mentioning at least one shogi piece / all choices',
      specificSquareMentionRate: 'choices mentioning at least one board square / all choices',
      lineLabelUsageRate: 'choices using non-candidate line labels from evidence chains / all choices',
      evidenceChainUsageRate: 'choices using at least one medium/high evidence chain / choices with such chains',
      ownStrengthUsageRate: 'wrong choices using ownStrengths from contrast features / wrong choices with ownStrengths',
      genericWrongChoiceOnlyRate: 'wrong choices diagnosed as only generic weakness / wrong choices',
      vagueWrongChoiceReasonRate: 'wrong choices diagnosed as vague and not choice-specific / wrong choices',
    },
    contrast: {
      contrastFeatureCoverage: 'wrong choices with usable medium contrast features / wrong choices',
      contrastPhraseUsageRate: 'wrong choices whose text uses a generated contrast phrase / wrong choices with contrast phrases',
      missingContrastFeatureRate: 'wrong choices with missing or unused contrast features / wrong choices',
      weakWrongChoiceReasonRate: 'wrong choices dominated by weak comparison phrasing / wrong choices',
      repetitiveWrongChoiceTemplateRate: 'wrong choices repeating a wrong-choice template within the problem / wrong choices',
    },
    contrastEvidence: {
      wrongChoiceHasOwnStrengthAndMissingCorrectEvidenceRate: 'wrong choices using both own strength and missing correct-side evidence / wrong choices',
      wrongChoiceOnlyGenericContrastRate: 'wrong choices diagnosed as only generic contrast / wrong choices',
      correctEvidenceAvailableButUnusedRate: 'wrong choices with missingCorrectEvidence available but not reflected in final text / wrong choices with missingCorrectEvidence',
      missingCorrectEvidenceCoverage: 'wrong choices with generated missingCorrectEvidence / wrong choices where correctStrengths are available',
    },
    humanPatternSpecific: {
      wrongNaturalButWorse: 'detected/used-well/missing/too-generic diagnostics for the frequent 600-set wrong_natural_but_worse pattern',
      correctAttackContinues: 'detected/used-well/followup/chain-use diagnostics for the frequent 600-set correct_attack_continues pattern',
    },
    evidence: {
      evidenceChainCountPerChoice: 'average evidence chain count per choice',
      mediumHighEvidenceChainCount: 'average medium/high usable evidence chain count per choice',
      chainAvailableButNotUsedRate: 'choices with medium/high chains not used / choices with medium/high chains',
      lineLabelExpectedButMissingRate: 'legacy coarse line-label omission rate; kept for continuity, not a primary improvement metric',
      usefulLineChainAvailableRate: 'choices with at least one must_use/useful line-labeled chain that benefits the choice side / all choices',
      usefulLineChainUsedRate: 'must_use/useful line-labeled chains used in final text / available must_use/useful line-labeled chains',
      usefulLineChainExpectedButMissingRate: 'must_use/useful line-labeled chains not used in final text / available must_use/useful line-labeled chains',
      lowValueLineChainSkippedRate: 'optional/low_value/avoid line-labeled chains skipped in final text / optional/low_value/avoid line-labeled chains',
      lineLabelUsageRate: 'choices using a non-candidate line label / all choices',
      missingEvidenceChainRate: 'choices diagnosed as lacking usable evidence chains / all choices',
      missingMaterialChainRate: 'choices diagnosed with material evidence but no material chain / all choices',
      missingActivityChainRate: 'choices diagnosed with activity evidence but no activity chain / all choices',
      missingDefenseChainRate: 'choices diagnosed with kingSafety or defense evidence but no defense chain / all choices',
    },
    humanPatternCoverage: {
      excludingUnknown: 'main coverage block excluding unclassified human explanations',
      extractorWeightedCoverage: 'human-count-weighted feature support for 600-set primaryReason patterns, independent of current 17-problem output; strong=1, partial=0.5, weak=0.25, unsupported=0',
      currentObservedCoverage: 'share of currently observed 17-problem output patterns with strong output support, weighted by currentOutputCount and excluding not_observed/unknown',
      unknownCount: '600-set primaryReason unknown count, excluded from main coverage',
      unknownShare: 'unknownCount / total 600-set analyzed choices',
    },
  };
}

function extractorSupportScore(support: HumanPatternCoverageRow['extractorSupport']): number {
  if (support === 'strong') return 1;
  if (support === 'partial') return 0.5;
  if (support === 'weak') return 0.25;
  return 0;
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function expectedLineLabelSteps(chain: DraftEvidenceChain): DraftEvidenceChain['steps'] {
  return chain.steps.filter((step) =>
    step.side !== 'choice' &&
    step.label !== null &&
    LINE_LABEL_ROLES.has(step.role) &&
    step.lineLabelsPreferred === true &&
    chain.usablePhrase.includes(step.label)
  );
}

function uniqueStrings(items: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const text = item?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

async function promptIncludesUsablePhrase(choice: ChoiceDebug, usablePhrase: string): Promise<boolean> {
  const prompt = await readFile(path.join(choice.report.debugDir, 'prompt.txt'), 'utf8').catch(() => '');
  return prompt.includes(usablePhrase);
}

async function lineLabelRemovedByRepair(choice: ChoiceDebug, expectedLabels: string[]): Promise<boolean> {
  const repair = await readJsonIfExists<StyleRepairOutputLike>(path.join(choice.report.debugDir, 'style-repair-output.json'));
  if (!repair?.repairedChoiceIds?.includes(choice.diagnostics.choiceId)) return false;
  const beforeTexts = [choice.llmExplanation, choice.retryExplanation].filter((text): text is string => Boolean(text));
  return expectedLabels.some((label) =>
    beforeTexts.some((text) => text.includes(label)) &&
    !choice.finalExplanation.includes(label)
  );
}

async function classifyLineLabelMissingReason(
  choice: ChoiceDebug,
  chain: DraftEvidenceChain,
  expectedLabels: string[],
): Promise<LineLabelMissingReason> {
  if (!(await promptIncludesUsablePhrase(choice, chain.usablePhrase))) return 'usable_phrase_not_in_prompt';
  if (await lineLabelRemovedByRepair(choice, expectedLabels)) return 'line_label_removed_by_repair';
  if (chain.resultPhrase && choice.finalExplanation.includes(chain.resultPhrase)) return 'llm_used_result_phrase_only';
  if (chain.usablePhrase.length > 48) return 'usable_phrase_too_long';
  if (expectedLabels.some((label) => label === choice.plan?.label || label === choice.plan?.label.replace(/^([▲△])/, ''))) {
    return 'candidate_label_filter_too_aggressive';
  }
  if (chain.priority < 80) return 'chain_priority_too_low';
  return 'unknown';
}

async function buildLineLabelMissingAnalysis(choices: ChoiceDebug[]) {
  const items: LineLabelMissingAnalysisItem[] = [];
  for (const choice of choices) {
    if (!hasDiagnostic(choice.diagnostics, 'line_label_expected_but_missing')) continue;
    for (const chain of usefulLineChains(choice.evidenceChains, choice.plan?.isCorrect)) {
      const expectedLabels = uniqueStrings(
        expectedLineLabelSteps(chain)
          .filter((step) => step.label !== null && !choice.finalExplanation.includes(step.label))
          .map((step) => step.label),
      );
      if (expectedLabels.length === 0) continue;
      items.push({
        problemId: choice.report.problemId,
        choiceId: choice.diagnostics.choiceId,
        explanation: choice.finalExplanation,
        expectedLineLabels: expectedLabels,
        chainUsablePhrase: chain.usablePhrase,
        chainResultPhrase: chain.resultPhrase,
        chainCategory: chain.category,
        chainPriority: chain.priority,
        reasonNotUsed: await classifyLineLabelMissingReason(choice, chain, expectedLabels),
      });
    }
  }
  const reasonCounts: Record<string, number> = {};
  for (const item of items) increment(reasonCounts, item.reasonNotUsed);
  return {
    generatedAt: new Date().toISOString(),
    itemCount: items.length,
    reasonCounts,
    items,
  };
}

function inputLineLength(choice: ChoiceDebug): number {
  const inputChoice = choice.input?.choices?.find((item) => item.choice_id === choice.diagnostics.choiceId);
  return inputChoice?.line?.length ?? 0;
}

function missingChainCategories(choice: ChoiceDebug): string[] {
  const chainCategories = new Set(choice.evidenceChains.map((chain) => chain.category));
  const categories = new Set<string>();
  for (const item of usableEvidence(choice.lineTrajectory)) {
    if (item.category === 'material' && !chainCategories.has('material')) categories.add('material');
    if (item.category === 'pieceActivity' && !chainCategories.has('pieceActivity') && !chainCategories.has('lineContinuation')) {
      categories.add('pieceActivity');
    }
    if (item.category === 'kingSafety' && !chainCategories.has('defense') && !chainCategories.has('kingSafety')) {
      categories.add('kingSafety');
    }
    if (item.category === 'lineContinuation' && !chainCategories.has('lineContinuation')) categories.add('lineContinuation');
    if (item.category === 'contrast' && !chainCategories.has('contrast')) categories.add('contrast');
  }
  return [...categories];
}

function classifyMissingEvidenceChainReason(
  choice: ChoiceDebug,
  categories: string[],
): MissingEvidenceChainReason {
  const evidence = choice.lineTrajectory?.usableEvidence ?? [];
  if (inputLineLength(choice) <= 1) return 'line_too_short';
  if (choice.evidenceChains.length > 0 && strongChains(choice.evidenceChains).length === 0) {
    return 'low_confidence_only';
  }
  if (evidence.length > 0 && evidence.every((item) => item.confidence === 'low' || item.evidenceLevel === 'weak' || item.evidenceLevel === 'none')) {
    return 'low_confidence_only';
  }
  const usable = usableEvidence(choice.lineTrajectory);
  if (usable.length > 0 && usable.every((item) => item.evidenceLevel === 'direct' && (item.ply ?? 1) <= 1)) {
    return 'only_direct_fact_no_chain_needed';
  }
  if (hasDiagnostic(choice.diagnostics, 'missing_material_chain') || categories.includes('material')) {
    return 'extractor_missing_material_chain';
  }
  if (hasDiagnostic(choice.diagnostics, 'missing_activity_chain') || categories.includes('pieceActivity')) {
    return 'extractor_missing_activity_chain';
  }
  if (hasDiagnostic(choice.diagnostics, 'missing_defense_chain') || categories.includes('kingSafety')) {
    return 'extractor_missing_defense_chain';
  }
  if (usable.length > 0 && usable.every((item) => item.evidenceLevel !== 'line_observed' && (item.ply ?? 1) <= 1)) {
    return 'usable_evidence_has_no_line_steps';
  }
  return 'unknown';
}

function buildMissingEvidenceChainAnalysis(choices: ChoiceDebug[]) {
  const items: MissingEvidenceChainAnalysisItem[] = [];
  for (const choice of choices) {
    const diagnosticCodes = choice.diagnostics.diagnostics
      .filter((diagnostic) => (
        diagnostic.code === 'missing_evidence_chain' ||
        diagnostic.code === 'choicesWithNoEvidenceChain' ||
        diagnostic.code === 'missing_material_chain' ||
        diagnostic.code === 'missing_activity_chain' ||
        diagnostic.code === 'missing_defense_chain'
      ))
      .map((diagnostic) => diagnostic.code);
    if (diagnosticCodes.length === 0) continue;
    const categories = missingChainCategories(choice);
    const strong = strongChains(choice.evidenceChains);
    const usable = usableEvidence(choice.lineTrajectory);
    items.push({
      problemId: choice.report.problemId,
      choiceId: choice.diagnostics.choiceId,
      explanation: choice.finalExplanation,
      usableEvidence: usable.map((item) => ({
        category: item.category,
        phrase: item.phrase,
        evidenceLevel: item.evidenceLevel,
        confidence: item.confidence,
        ply: item.ply,
      })),
      evidenceChainCount: choice.evidenceChains.length,
      mediumHighEvidenceChainCount: strong.length,
      missingChainCategories: categories,
      diagnosticCodes: uniqueStrings(diagnosticCodes),
      reason: classifyMissingEvidenceChainReason(choice, categories),
    });
  }
  const reasonCounts: Record<string, number> = {};
  for (const item of items) increment(reasonCounts, item.reason);
  return {
    generatedAt: new Date().toISOString(),
    itemCount: items.length,
    reasonCounts,
    items,
    notes: [
      'only_direct_fact_no_chain_needed is separated because a direct fact immediately after the candidate move may be sufficient and should not always be treated as a severe failure.',
    ],
  };
}

function buildEvidenceChainQualityAnalysis(choices: ChoiceDebug[]) {
  const textUsefulnessCounts: Record<DraftEvidenceChain['textUsefulness'], number> = {
    must_use: 0,
    useful: 0,
    optional: 0,
    low_value: 0,
    avoid: 0,
  };
  const beneficiaryCounts: Record<DraftEvidenceChain['beneficiary'], number> = {
    choice_side: 0,
    opponent: 0,
    both: 0,
    unclear: 0,
  };
  const chains = choices.flatMap((choice) => choice.evidenceChains);
  for (const choice of choices) {
    for (const chain of choice.evidenceChains) {
      const textUsefulness = chainTextUsefulness(chain, choice.plan?.isCorrect);
      const beneficiary = chainBeneficiary(chain);
      textUsefulnessCounts[textUsefulness] = (textUsefulnessCounts[textUsefulness] ?? 0) + 1;
      beneficiaryCounts[beneficiary] = (beneficiaryCounts[beneficiary] ?? 0) + 1;
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    chainCount: chains.length,
    textUsefulnessCounts,
    beneficiaryCounts,
  };
}

function inputChoicesForValidation(input: DebugInput | undefined): DraftProblemChoice[] {
  return (input?.choices ?? [])
    .filter((choice) => typeof choice.choice_id === 'number')
    .map((choice) => ({
      id: undefined,
      draft_problem_id: choice.draft_problem_id ?? input?.problem?.id ?? 0,
      choice_id: choice.choice_id as number,
      usi: choice.usi ?? '',
      label: choice.label ?? '',
      eval_cp: choice.eval_cp ?? null,
      eval_percent: choice.eval_percent ?? null,
      line: choice.line ?? [],
      explanation: null,
    }));
}

async function finalValidationIssuesForDebugDir(debugDir: string): Promise<ExplanationValidationIssue[]> {
  const input = await readJsonIfExists<DebugInput>(path.join(debugDir, 'input.json'));
  const inputChoices = inputChoicesForValidation(input);
  if (inputChoices.length === 0) return [];
  const moveFacts = await readJsonIfExists<DraftMoveFacts[]>(path.join(debugDir, 'move-facts.json'));
  const positionFeatures = await readJsonIfExists<DraftPositionFeatures[]>(path.join(debugDir, 'position-features.json'));
  const lineContinuationFeatures = await readJsonIfExists<DraftLineContinuationFeatures[]>(path.join(debugDir, 'line-continuation-features.json'));
  const validated = await readJsonIfExists<LlmExplanationResponse>(path.join(debugDir, 'validated.json'));
  const fallback = await readJsonIfExists<LlmExplanationResponse>(path.join(debugDir, 'fallback-output.json'));
  const retry = await readJsonIfExists<LlmExplanationResponse>(path.join(debugDir, 'retry-llm-output.json'));
  const llm = await readJsonIfExists<LlmExplanationResponse>(path.join(debugDir, 'llm-output.json'));
  const finalOutput = validated ?? fallback ?? retry ?? llm;
  if (!finalOutput) return [];
  try {
    validateExplanations(finalOutput, inputChoices, {
      moveFactsList: moveFacts ?? [],
      positionFeaturesList: positionFeatures ?? [],
      lineContinuationFeaturesList: lineContinuationFeatures ?? [],
      correctChoiceId: input?.problem?.correct_choice_id,
      requiredContinuationChoiceIds: (lineContinuationFeatures ?? [])
        .filter((features) =>
          features.choiceId === input?.problem?.correct_choice_id &&
          features.continuationPhrases.length > 0
        )
        .map((features) => features.choiceId),
    });
    return [];
  } catch (error) {
    if (error instanceof ExplanationValidationError) return error.issues;
    throw error;
  }
}

async function buildFinalOutputValidationAnalysis(reports: ExplanationDiagnosticsReport[]) {
  let finalChoiceCount = 0;
  let softIssueSurvivedFinal = 0;
  let hardIssueSurvivedFinal = 0;
  let wrongChoiceCalledGoodMove = 0;
  let badPhraseSurvivedFinal = 0;
  const items: Array<{
    problemId: number | null;
    debugDir: string;
    choiceId: number;
    explanation: string;
    survivedIssues: Array<{
      code: string;
      severity: string;
      phrase: string | null;
      message: string;
    }>;
  }> = [];

  for (const report of reports) {
    finalChoiceCount += report.choices.length;
    const issues = await finalValidationIssuesForDebugDir(report.debugDir);
    softIssueSurvivedFinal += issues.filter((issue) => issue.severity === 'soft').length;
    hardIssueSurvivedFinal += issues.filter((issue) => issue.severity === 'hard').length;
    wrongChoiceCalledGoodMove += issues.filter((issue) => issue.code === 'wrong_choice_called_good_move').length;
    badPhraseSurvivedFinal += issues.filter((issue) => issue.code === 'bad_phrase').length;
    const issuesByChoiceId = validationIssuesByChoiceId(issues);
    for (const choice of report.choices) {
      const survivedIssues = issuesByChoiceId.get(choice.choiceId) ?? [];
      if (survivedIssues.length === 0) continue;
      items.push({
        problemId: report.problemId,
        debugDir: report.debugDir,
        choiceId: choice.choiceId,
        explanation: choice.explanation,
        survivedIssues: survivedIssues.map((issue) => ({
          code: issue.code,
          severity: issue.severity,
          phrase: issue.phrase ?? phraseFromIssueMessage(issue.message),
          message: issue.message,
        })),
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    finalChoiceCount,
    softIssueSurvivedFinal,
    hardIssueSurvivedFinal,
    wrongChoiceCalledGoodMove,
    badPhraseSurvivedFinal,
    items,
  };
}

function retryIssueKind(code: string | undefined): RetryIssueKind {
  if (code === 'missing_required_continuation_phrase') return 'unsupported_line_claim';
  if (code === 'unsupported_counterattack_phrase') return 'unsupported_counterattack';
  if (code === 'unsupported_escape_phrase') return 'unsupported_escape';
  if (code === 'unsupported_claim') return 'unsupported_claim';
  if (code === 'too_many_sentences') return 'too_many_sentences';
  return 'other';
}

async function buildRetryAnalysis(reports: ExplanationDiagnosticsReport[]) {
  const items: RetryAnalysisItem[] = [];
  for (const report of reports) {
    if (!report.filesPresent.includes('retry-prompt.txt') && !report.filesPresent.includes('retry-llm-output.json')) continue;
    const debugDir = report.debugDir;
    const initialIssues = await readJsonIfExists<ValidationIssueLike[]>(path.join(debugDir, 'validation-issues.json')) ?? [];
    const llm = await readJsonIfExists<LlmExplanationResponse>(path.join(debugDir, 'llm-output.json'));
    const retry = await readJsonIfExists<LlmExplanationResponse>(path.join(debugDir, 'retry-llm-output.json'));
    const fallback = await readJsonIfExists<LlmExplanationResponse>(path.join(debugDir, 'fallback-output.json'));
    const validated = await readJsonIfExists<LlmExplanationResponse>(path.join(debugDir, 'validated.json'));
    const finalIssues = await finalValidationIssuesForDebugDir(debugDir);
    const retryChoiceIds = uniqueStrings(initialIssues.map((issue) =>
      typeof issue.choiceId === 'number' ? String(issue.choiceId) : null,
    )).map(Number);
    const llmByChoice = new Map(outputChoices(llm).map((choice) => [choice.choiceId, choice.explanation]));
    const retryByChoice = new Map(outputChoices(retry).map((choice) => [choice.choiceId, choice.explanation]));
    const retryFailedSameOutput = retryChoiceIds.some((choiceId) =>
      retryByChoice.get(choiceId) !== undefined &&
      retryByChoice.get(choiceId) === llmByChoice.get(choiceId)
    );
    const sameChoiceIds = retryChoiceIds.filter((choiceId) =>
      retryByChoice.get(choiceId) !== undefined &&
      retryByChoice.get(choiceId) === llmByChoice.get(choiceId)
    );
    const normalizedIssues = initialIssues.map((issue) => ({
      code: issue.code ?? 'unknown',
      severity: issue.severity ?? 'unknown',
      choiceId: typeof issue.choiceId === 'number' ? issue.choiceId : null,
      message: issue.message ?? '',
      kind: retryIssueKind(issue.code),
    }));
    items.push({
      problemId: report.problemId,
      debugDir,
      retryChoiceIds,
      issueKinds: uniqueStrings(normalizedIssues.map((issue) => issue.kind)) as RetryIssueKind[],
      retryFailedSameOutput,
      sameChoiceIds,
      fallbackUsed: outputChoices(fallback).length > 0,
      softIssueSurvivedFinal: finalIssues.filter((issue) => issue.severity === 'soft').length,
      hardIssueSurvivedFinal: finalIssues.filter((issue) => issue.severity === 'hard').length,
      initialIssues: normalizedIssues,
      initialExplanations: outputChoices(llm),
      retryExplanations: outputChoices(retry),
      finalExplanations: outputChoices(validated ?? fallback ?? retry ?? llm),
    });
  }
  const reasonCounts: Record<string, number> = {};
  for (const item of items) {
    for (const kind of item.issueKinds) increment(reasonCounts, kind);
  }
  return {
    generatedAt: new Date().toISOString(),
    itemCount: items.length,
    reasonCounts,
    items,
    notes: [
      'retryFailedSameOutput means at least one retried choice kept the exact same explanation text after retry.',
      'softIssueSurvivedFinal / hardIssueSurvivedFinal are recomputed from final output with the current validator.',
    ],
  };
}

function buildRetryQualityAnalysis(retryAnalysis: Awaited<ReturnType<typeof buildRetryAnalysis>>) {
  const retryFailedSameOutputItems = retryAnalysis.items
    .filter((item) => item.retryFailedSameOutput)
    .map((item) => ({
      problemId: item.problemId,
      debugDir: item.debugDir,
      sameChoiceIds: item.sameChoiceIds,
      initialText: item.initialExplanations
        .filter((choice) => item.sameChoiceIds.includes(choice.choiceId))
        .map((choice) => `choice ${choice.choiceId}: ${choice.explanation}`)
        .join('\n'),
      retryText: item.retryExplanations
        .filter((choice) => item.sameChoiceIds.includes(choice.choiceId))
        .map((choice) => `choice ${choice.choiceId}: ${choice.explanation}`)
        .join('\n'),
      finalText: item.finalExplanations
        .filter((choice) => item.sameChoiceIds.includes(choice.choiceId))
        .map((choice) => `choice ${choice.choiceId}: ${choice.explanation}`)
        .join('\n'),
      fallbackUsed: item.fallbackUsed,
    }));
  return {
    generatedAt: new Date().toISOString(),
    retryFolderCount: retryAnalysis.itemCount,
    retryFailedSameOutput: retryAnalysis.items.filter((item) => item.retryFailedSameOutput).length,
    retryFailedSameOutputItems,
    hardIssueSurvivedFinal: retryAnalysis.items.reduce((sum, item) => sum + item.hardIssueSurvivedFinal, 0),
    softIssueSurvivedFinal: retryAnalysis.items.reduce((sum, item) => sum + item.softIssueSurvivedFinal, 0),
  };
}

function buildNextMetricRecommendation(params: {
  evidenceChainQualityAnalysis: ReturnType<typeof buildEvidenceChainQualityAnalysis>;
  lineLabelAnalysis: Awaited<ReturnType<typeof buildLineLabelMissingAnalysis>>;
  missingEvidenceAnalysis: ReturnType<typeof buildMissingEvidenceChainAnalysis>;
  retryAnalysis: Awaited<ReturnType<typeof buildRetryAnalysis>>;
}): NextMetricRecommendation {
  const lowValueOrAvoid = (params.evidenceChainQualityAnalysis.textUsefulnessCounts.low_value ?? 0) +
    (params.evidenceChainQualityAnalysis.textUsefulnessCounts.avoid ?? 0);
  if (lowValueOrAvoid > 0) {
    return {
      recommendedNextMetric: 'usefulLineChainExpectedButMissingRate',
      reason: 'line-labeled chains now include low-value or avoid cases, so the next primary metric should separate useful omissions from healthy skips.',
      candidateFixes: [
        {
          target: 'extractDraftLineTrajectoryFeatures.ts',
          description: 'Tune textUsefulness / beneficiary classification on evidence chains before changing prompt pressure.',
        },
        {
          target: 'evaluateExplanationQuality.ts',
          description: 'Compare usefulLineChainExpectedButMissingRate with lowValueLineChainSkippedRate to avoid optimizing for noisy line-label usage.',
        },
      ],
      metricsToProtect: [
        'candidate_label_overused',
        'candidate_move_as_subject',
        'unsupported_claim',
        'style_bad_phrase',
        'fallback_used',
      ],
    };
  }
  const directOnly = params.missingEvidenceAnalysis.reasonCounts.only_direct_fact_no_chain_needed ?? 0;
  const missingEvidenceActionable = params.missingEvidenceAnalysis.itemCount - directOnly;
  if (params.lineLabelAnalysis.itemCount >= missingEvidenceActionable) {
    return {
      recommendedNextMetric: 'usefulLineChainExpectedButMissingRate',
      reason: 'useful line-labeled chains are still omitted, but the coarse lineLabelExpectedButMissingRate is no longer treated as the primary metric.',
      candidateFixes: [
        {
          target: 'extractDraftLineTrajectoryFeatures.ts',
          description: 'Improve textUsefulness and beneficiary classification for line-observed chains.',
        },
        {
          target: 'evaluateExplanationQuality.ts',
          description: 'Inspect usefulLineChainExpectedButMissingRate cases before applying any prompt change.',
        },
      ],
      metricsToProtect: [
        'candidate_label_overused',
        'candidate_move_as_subject',
        'unsupported_claim',
        'style_bad_phrase',
        'fallback_used',
      ],
    };
  }
  return {
    recommendedNextMetric: 'missingEvidenceChainRate',
    reason: 'actionable missing evidence-chain cases exceed line-label omissions after excluding direct facts that may not need chains.',
    candidateFixes: [
      {
        target: 'extractDraftLineTrajectoryFeatures.ts',
        description: 'Create chains for line-observed material/activity evidence that currently remains only usableEvidence.',
      },
      {
        target: 'diagnoseExplanationDebug.ts',
        description: 'Downgrade only_direct_fact_no_chain_needed so direct candidate facts do not overstate the failure rate.',
      },
    ],
    metricsToProtect: [
      'unsupported_claim',
      'style_bad_phrase',
      'fallback_used',
      'lineLabelUsageRate',
    ],
  };
}

export async function evaluateExplanationQuality(params: {
  debugRoot: string;
  reports: ExplanationDiagnosticsReport[];
  analysisSummaryPath?: string;
  write?: boolean;
}): Promise<ExplanationQualityEvaluationSummary> {
  const analysisSummary = params.analysisSummaryPath
    ? await readJsonIfExists<AnalysisSummaryLike>(params.analysisSummaryPath)
    : undefined;
  const choices = (await Promise.all(params.reports.map(readChoiceDebug))).flat();
  const choiceCount = choices.length;
  const wrongChoices = choices.filter(isWrongChoice);
  const correctChoices = choices.filter((choice) => !isWrongChoice(choice));
  const wrongChoiceCount = wrongChoices.length;
  const expectedLength = expectedHumanLength(analysisSummary);
  const choicesWithStrongChains = choices.filter((choice) => strongChains(choice.evidenceChains).length > 0);
  const wrongWithOwnStrengths = wrongChoices.filter((choice) => (choice.contrastFeatures?.ownStrengths.length ?? 0) > 0);
  const wrongWithContrastPhrases = wrongChoices.filter((choice) =>
    (choice.contrastFeatures?.contrastPhrases.length ?? 0) > 0 ||
    (choice.contrastFeatures?.contrastUsablePhrases.length ?? 0) > 0
  );
  const humanPatterns = buildHumanPatternCoverage(analysisSummary, choices);
  const knownHumanPatterns = humanPatterns.filter((pattern) => pattern.humanCount > 0 && pattern.pattern !== 'unknown');
  const unknownCount = humanPatterns.find((pattern) => pattern.pattern === 'unknown')?.humanCount ?? 0;
  const totalHumanCountIncludingUnknown = humanPatterns
    .filter((pattern) => pattern.humanCount > 0)
    .reduce((sum, pattern) => sum + pattern.humanCount, 0);
  const extractorWeightedScore = knownHumanPatterns
    .reduce((sum, pattern) => sum + pattern.humanCount * extractorSupportScore(pattern.extractorSupport), 0);
  const knownHumanCount = knownHumanPatterns.reduce((sum, pattern) => sum + pattern.humanCount, 0);
  const currentObservedPatterns = knownHumanPatterns.filter((pattern) => pattern.currentOutputSupport !== 'not_observed');
  const currentStrongOutputCount = currentObservedPatterns
    .filter((pattern) => pattern.currentOutputSupport === 'strong')
    .reduce((sum, pattern) => sum + pattern.currentOutputCount, 0);
  const currentObservedOutputCount = currentObservedPatterns.reduce((sum, pattern) => sum + pattern.currentOutputCount, 0);
  const lineLabelAnalysis = await buildLineLabelMissingAnalysis(choices);
  const missingEvidenceAnalysis = buildMissingEvidenceChainAnalysis(choices);
  const evidenceChainQualityAnalysis = buildEvidenceChainQualityAnalysis(choices);
  const finalOutputValidationAnalysis = await buildFinalOutputValidationAnalysis(params.reports);
  const retryAnalysis = await buildRetryAnalysis(params.reports);
  const retryQualityAnalysis = buildRetryQualityAnalysis(retryAnalysis);
  const nextMetricRecommendation = buildNextMetricRecommendation({
    evidenceChainQualityAnalysis,
    lineLabelAnalysis,
    missingEvidenceAnalysis,
    retryAnalysis,
  });
  const availableUsefulLineChains = choices.flatMap((choice) => usefulLineChains(choice.evidenceChains, choice.plan?.isCorrect));
  const usedUsefulLineChains = choices.flatMap((choice) =>
    usefulLineChains(choice.evidenceChains, choice.plan?.isCorrect).filter((chain) => chainUsedInExplanation(choice.diagnostics.explanation, chain)),
  );
  const lowValueChains = choices.flatMap((choice) => lowValueLineChains(choice.evidenceChains, choice.plan?.isCorrect));
  const skippedLowValueChains = choices.flatMap((choice) =>
    lowValueLineChains(choice.evidenceChains, choice.plan?.isCorrect).filter((chain) => !chainUsedInExplanation(choice.diagnostics.explanation, chain)),
  );

  const metrics: EvaluationMetrics = {
    factuality: {
      unsupportedClaimRate: rate(choices.filter((choice) => hasDiagnostic(choice.diagnostics, 'unsupported_claim')).length, choiceCount),
      unsupportedEscapeRate: rate(choices.filter((choice) => hasDiagnostic(choice.diagnostics, 'unsupported_escape')).length, choiceCount),
      unsupportedCounterattackRate: rate(choices.filter((choice) => hasDiagnostic(choice.diagnostics, 'unsupported_counterattack')).length, choiceCount),
      unsupportedKingDangerRate: rate(choices.filter((choice) => hasDiagnostic(choice.diagnostics, 'unsupported_king_danger')).length, choiceCount),
      unsupportedMaterialClaimRate: rate(choices.filter((choice) => hasDiagnostic(choice.diagnostics, 'unsupported_large_gain_comparison')).length, choiceCount),
      unsupportedLineClaimRate: rate(choices.filter((choice) => hasDiagnostic(choice.diagnostics, 'missing_line_continuation')).length, choiceCount),
    },
    humanStyle: {
      styleBadPhraseRate: rate(choices.filter((choice) => hasDiagnostic(choice.diagnostics, 'style_bad_phrase')).length, choiceCount),
      avgSentenceCount: average(choices.map((choice) => sentenceCount(choice.diagnostics.explanation))),
      avgCharLength: average(choices.map((choice) => choice.diagnostics.explanation.length)),
      labelStartRate: rate(choices.filter((choice) => hasDiagnostic(choice.diagnostics, 'candidate_label_overused')).length, choiceCount),
      candidateMoveSubjectRate: rate(choices.filter((choice) => hasDiagnostic(choice.diagnostics, 'candidate_move_as_subject')).length, choiceCount),
      aiGenericPhraseRate: rate(choices.filter((choice) => hasDiagnostic(choice.diagnostics, 'style_too_generic')).length, choiceCount),
      humanStylePatternMatchRate: rate(choices.filter((choice) => {
        const lengthOk = expectedLength === null
          ? true
          : Math.abs(choice.diagnostics.explanation.length - expectedLength) <= HUMAN_STYLE_LENGTH_TOLERANCE;
        return lengthOk &&
          sentenceCount(choice.diagnostics.explanation) <= 2 &&
          !hasDiagnostic(choice.diagnostics, 'style_bad_phrase') &&
          !hasDiagnostic(choice.diagnostics, 'style_too_generic') &&
          !hasDiagnostic(choice.diagnostics, 'candidate_label_overused');
      }).length, choiceCount),
    },
    specificity: {
      specificPieceMentionRate: rate(choices.filter((choice) => PIECE_PATTERN.test(choice.diagnostics.explanation)).length, choiceCount),
      specificSquareMentionRate: rate(choices.filter((choice) => SQUARE_PATTERN.test(choice.diagnostics.explanation)).length, choiceCount),
      lineLabelUsageRate: rate(choices.filter((choice) => usesLineLabel(choice.diagnostics.explanation, strongChains(choice.evidenceChains))).length, choiceCount),
      evidenceChainUsageRate: rate(
        choicesWithStrongChains.filter((choice) => strongChains(choice.evidenceChains).some((chain) => chainUsedInExplanation(choice.diagnostics.explanation, chain))).length,
        choicesWithStrongChains.length,
      ),
      ownStrengthUsageRate: rate(wrongWithOwnStrengths.filter(usesOwnStrength).length, wrongWithOwnStrengths.length),
      genericWrongChoiceOnlyRate: rate(wrongChoices.filter((choice) => hasDiagnostic(choice.diagnostics, 'generic_wrong_choice_only')).length, wrongChoiceCount),
      vagueWrongChoiceReasonRate: rate(wrongChoices.filter((choice) => hasDiagnostic(choice.diagnostics, 'vague_wrong_choice_reason')).length, wrongChoiceCount),
    },
    contrast: {
      contrastFeatureCoverage: rate(wrongChoices.filter((choice) =>
        choice.contrastFeatures?.confidence === 'medium' &&
        choice.contrastFeatures.diagnosis !== 'unclear' &&
        (choice.contrastFeatures.contrastPhrases.length > 0 || choice.contrastFeatures.contrastUsablePhrases.length > 0)
      ).length, wrongChoiceCount),
      contrastPhraseUsageRate: rate(wrongWithContrastPhrases.filter(usesContrastPhrase).length, wrongWithContrastPhrases.length),
      missingContrastFeatureRate: rate(wrongChoices.filter((choice) => hasDiagnostic(choice.diagnostics, 'missing_contrast_feature')).length, wrongChoiceCount),
      weakWrongChoiceReasonRate: rate(wrongChoices.filter((choice) => hasDiagnostic(choice.diagnostics, 'weak_wrong_choice_reason')).length, wrongChoiceCount),
      repetitiveWrongChoiceTemplateRate: rate(wrongChoices.filter((choice) => hasDiagnostic(choice.diagnostics, 'repetitive_wrong_choice_template')).length, wrongChoiceCount),
    },
    contrastEvidence: {
      wrongChoiceHasOwnStrengthAndMissingCorrectEvidenceRate: rate(
        wrongChoices.filter(hasOwnStrengthAndMissingCorrectEvidenceDiagnostic).length,
        wrongChoiceCount,
      ),
      wrongChoiceOnlyGenericContrastRate: rate(
        wrongChoices.filter((choice) => hasDiagnostic(choice.diagnostics, 'wrong_choice_has_only_generic_contrast')).length,
        wrongChoiceCount,
      ),
      correctEvidenceAvailableButUnusedRate: rate(
        wrongChoices.filter((choice) => hasDiagnostic(choice.diagnostics, 'correct_evidence_available_but_unused_in_wrong_choice')).length,
        wrongChoices.filter(hasMissingCorrectEvidence).length,
      ),
      missingCorrectEvidenceCoverage: rate(
        wrongChoices.filter(hasMissingCorrectEvidence).length,
        wrongChoices.filter((choice) => (choice.contrastFeatures?.correctStrengths.length ?? 0) > 0).length,
      ),
    },
    humanPatternSpecific: {
      wrongNaturalButWorse: {
        detectedCount: wrongChoices.filter(wrongNaturalButWorseDetected).length,
        usedWellCount: wrongChoices.filter(wrongNaturalButWorseUsedWell).length,
        usedWellRate: rate(
          wrongChoices.filter(wrongNaturalButWorseUsedWell).length,
          wrongChoices.filter(wrongNaturalButWorseDetected).length,
        ),
        missingOwnStrengthRate: rate(
          wrongChoices.filter((choice) => hasDiagnostic(choice.diagnostics, 'wrong_natural_but_worse_missing_own_strength')).length,
          wrongChoices.filter(wrongNaturalButWorseDetected).length,
        ),
        missingCorrectDifferenceRate: rate(
          wrongChoices.filter((choice) => hasDiagnostic(choice.diagnostics, 'wrong_natural_but_worse_missing_correct_difference')).length,
          wrongChoices.filter(wrongNaturalButWorseDetected).length,
        ),
        tooGenericRate: rate(
          wrongChoices.filter((choice) => hasDiagnostic(choice.diagnostics, 'wrong_natural_but_worse_too_generic')).length,
          wrongChoices.filter(wrongNaturalButWorseDetected).length,
        ),
      },
      correctAttackContinues: {
        detectedCount: correctChoices.filter(correctAttackContinuesDetected).length,
        usedWellCount: correctChoices.filter(correctAttackContinuesUsedWell).length,
        usedWellRate: rate(
          correctChoices.filter(correctAttackContinuesUsedWell).length,
          correctChoices.filter(correctAttackContinuesDetected).length,
        ),
        tooGenericRate: rate(
          correctChoices.filter((choice) => hasDiagnostic(choice.diagnostics, 'correct_attack_continues_too_generic')).length,
          correctChoices.filter(correctAttackContinuesDetected).length,
        ),
        missingSpecificFollowupRate: rate(
          correctChoices.filter((choice) => hasDiagnostic(choice.diagnostics, 'correct_attack_continues_missing_specific_followup')).length,
          correctChoices.filter(correctAttackContinuesDetected).length,
        ),
        chainAvailableButUnusedRate: rate(
          correctChoices.filter((choice) => hasDiagnostic(choice.diagnostics, 'correct_attack_continues_chain_available_but_unused')).length,
          correctChoices.filter(correctAttackContinuesDetected).length,
        ),
        noConcreteEvidenceRate: rate(
          correctChoices.filter((choice) => hasDiagnostic(choice.diagnostics, 'correct_attack_continues_no_concrete_evidence')).length,
          correctChoices.length,
        ),
      },
    },
    evidence: {
      evidenceChainCountPerChoice: average(choices.map((choice) => choice.evidenceChains.length)),
      mediumHighEvidenceChainCount: average(choices.map((choice) => strongChains(choice.evidenceChains).length)),
      chainAvailableButNotUsedRate: rate(choicesWithStrongChains.filter((choice) => hasDiagnostic(choice.diagnostics, 'chain_available_but_not_used')).length, choicesWithStrongChains.length),
      lineLabelExpectedButMissingRate: rate(choicesWithStrongChains.filter((choice) => hasDiagnostic(choice.diagnostics, 'line_label_expected_but_missing')).length, choicesWithStrongChains.length),
      usefulLineChainAvailableRate: rate(choices.filter((choice) => usefulLineChains(choice.evidenceChains, choice.plan?.isCorrect).length > 0).length, choiceCount),
      usefulLineChainUsedRate: rate(usedUsefulLineChains.length, availableUsefulLineChains.length),
      usefulLineChainExpectedButMissingRate: rate(availableUsefulLineChains.length - usedUsefulLineChains.length, availableUsefulLineChains.length),
      lowValueLineChainSkippedRate: rate(skippedLowValueChains.length, lowValueChains.length),
      lineLabelUsageRate: rate(choices.filter((choice) => usesLineLabel(choice.diagnostics.explanation, strongChains(choice.evidenceChains))).length, choiceCount),
      missingEvidenceChainRate: rate(choices.filter((choice) => hasDiagnostic(choice.diagnostics, 'missing_evidence_chain') || hasDiagnostic(choice.diagnostics, 'choicesWithNoEvidenceChain')).length, choiceCount),
      missingMaterialChainRate: rate(choices.filter((choice) => hasDiagnostic(choice.diagnostics, 'missing_material_chain')).length, choiceCount),
      missingActivityChainRate: rate(choices.filter((choice) => hasDiagnostic(choice.diagnostics, 'missing_activity_chain')).length, choiceCount),
      missingDefenseChainRate: rate(choices.filter((choice) => hasDiagnostic(choice.diagnostics, 'missing_defense_chain')).length, choiceCount),
    },
    shogiFeatureRichness: {
      materialEvidenceCount: evidenceCategoryCount(choices, 'material'),
      pieceActivityEvidenceCount: evidenceCategoryCount(choices, 'pieceActivity'),
      kingSafetyEvidenceCount: evidenceCategoryCount(choices, 'kingSafety'),
      lineObservedEvidenceCount: evidenceLevelCount(choices, 'line_observed'),
      directEvidenceCount: evidenceLevelCount(choices, 'direct'),
      heuristicEvidenceCount: evidenceLevelCount(choices, 'heuristic'),
      avgUsableEvidenceCount: average(choices.map((choice) => usableEvidence(choice.lineTrajectory).length)),
      avgHighMediumEvidenceCount: average(choices.map((choice) =>
        usableEvidence(choice.lineTrajectory).filter((item) => item.confidence === 'high' || item.confidence === 'medium').length,
      )),
      lowUsableEvidenceRate: rate(choices.filter((choice) => hasDiagnostic(choice.diagnostics, 'low_usable_evidence')).length, choiceCount),
    },
    humanPatternCoverage: {
      excludingUnknown: {
        extractorWeightedCoverage: rate(extractorWeightedScore, knownHumanCount),
        currentObservedCoverage: rate(currentStrongOutputCount, currentObservedOutputCount),
        extractorStrongPatternCount: knownHumanPatterns.filter((pattern) => pattern.extractorSupport === 'strong').length,
        extractorPartialPatternCount: knownHumanPatterns.filter((pattern) => pattern.extractorSupport === 'partial').length,
        extractorWeakPatternCount: knownHumanPatterns.filter((pattern) => pattern.extractorSupport === 'weak').length,
        extractorUnsupportedPatternCount: knownHumanPatterns.filter((pattern) => pattern.extractorSupport === 'unsupported').length,
        currentStrongPatternCount: knownHumanPatterns.filter((pattern) => pattern.currentOutputSupport === 'strong').length,
        currentWeakPatternCount: knownHumanPatterns.filter((pattern) => pattern.currentOutputSupport === 'weak').length,
        currentUnsupportedPatternCount: knownHumanPatterns.filter((pattern) => pattern.currentOutputSupport === 'unsupported').length,
        currentNotObservedPatternCount: knownHumanPatterns.filter((pattern) => pattern.currentOutputSupport === 'not_observed').length,
      },
      unknownCount,
      unknownShare: rate(unknownCount, totalHumanCountIncludingUnknown),
    },
  };

  const summary: ExplanationQualityEvaluationSummary = {
    generatedAt: new Date().toISOString(),
    debugRoot: params.debugRoot,
    problemCount: new Set(params.reports.map((report) => report.problemId).filter((id): id is number => id !== null)).size,
    choiceCount,
    wrongChoiceCount,
    metrics,
    metricDefinitions: metricDefinitions(),
    humanPatterns,
    measurementNotes: [
      'This report measures current debug artifacts only; it does not change prompts, extractors, validation, fallback, repair, DB, or frontend behavior.',
      'unsupportedLineClaimRate is limited to currently available line-continuation diagnostics; full line-claim verification would need a stricter parser.',
      'humanStylePatternMatchRate is a proxy based on the 600-set aggregate length plus current style diagnostics, not semantic similarity.',
      'humanPatternCoverage excludes unknown from the main coverage scores and separates extractor support from current 17-problem output support.',
    ],
  };

  if (params.write) {
    await writeFile(path.join(params.debugRoot, 'evaluation-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    await writeFile(path.join(params.debugRoot, 'analysis-feature-coverage.json'), JSON.stringify({
      generatedAt: summary.generatedAt,
      sourceAnalysisSummaryPath: params.analysisSummaryPath ?? null,
      humanPatternCoverage: summary.metrics.humanPatternCoverage,
      humanPatterns: summary.humanPatterns,
    }, null, 2), 'utf8');
    await writeFile(path.join(params.debugRoot, 'line-label-missing-analysis.json'), JSON.stringify(lineLabelAnalysis, null, 2), 'utf8');
    await writeFile(path.join(params.debugRoot, 'missing-evidence-chain-analysis.json'), JSON.stringify(missingEvidenceAnalysis, null, 2), 'utf8');
    await writeFile(path.join(params.debugRoot, 'evidence-chain-quality-analysis.json'), JSON.stringify(evidenceChainQualityAnalysis, null, 2), 'utf8');
    await writeFile(path.join(params.debugRoot, 'final-output-validation-analysis.json'), JSON.stringify(finalOutputValidationAnalysis, null, 2), 'utf8');
    await writeFile(path.join(params.debugRoot, 'retry-analysis.json'), JSON.stringify(retryAnalysis, null, 2), 'utf8');
    await writeFile(path.join(params.debugRoot, 'retry-quality-analysis.json'), JSON.stringify(retryQualityAnalysis, null, 2), 'utf8');
    await writeFile(path.join(params.debugRoot, 'next-metric-recommendation.json'), JSON.stringify(nextMetricRecommendation, null, 2), 'utf8');
  }

  return summary;
}
