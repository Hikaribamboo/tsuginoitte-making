import { access, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  DraftChoiceContrastFeatures,
  DraftLineContinuationFeatures,
  DraftLineTrajectoryFeatures,
  DraftMoveFacts,
  DraftPositionFeatures,
  ExplanationPlan,
  LlmExplanationResponse,
} from './types.js';

export type ExplanationDiagnosticCode =
  | 'ok_uses_fact_phrase'
  | 'ok_uses_continuation'
  | 'unsupported_claim'
  | 'unsupported_escape'
  | 'unsupported_counterattack'
  | 'unsupported_king_danger'
  | 'vague_wrong_choice_reason'
  | 'weak_wrong_choice_reason'
  | 'missing_own_strength_in_wrong_choice'
  | 'generic_wrong_choice_only'
  | 'too_plain_correct_choice'
  | 'overstated_attack_disappears'
  | 'vague_expectation_phrase'
  | 'unsupported_large_gain_comparison'
  | 'low_usable_evidence'
  | 'missing_material_trajectory'
  | 'missing_activity_trajectory'
  | 'missing_king_safety_trajectory'
  | 'missing_contrast_feature'
  | 'missing_line_continuation'
  | 'repetitive_wrong_choice_template'
  | 'style_too_generic'
  | 'style_label_start_overused'
  | 'style_bad_phrase'
  | 'too_many_sentences'
  | 'fallback_used'
  | 'retry_used';

export type ExplanationDiagnosticSeverity = 'info' | 'warning' | 'error';
export type ExplanationDiagnosticConfidence = 'high' | 'medium' | 'low';

export type ExplanationDiagnostic = {
  code: ExplanationDiagnosticCode;
  severity: ExplanationDiagnosticSeverity;
  message: string;
};

export type ExplanationChoiceDiagnostics = {
  choiceId: number;
  explanation: string;
  diagnostics: ExplanationDiagnostic[];
  confidence: ExplanationDiagnosticConfidence;
};

export type ExplanationDiagnosticsReport = {
  problemId: number | null;
  debugDir: string;
  generatedAt: string;
  source: 'validated' | 'fallback' | 'retry' | 'llm' | 'none';
  filesPresent: string[];
  choices: ExplanationChoiceDiagnostics[];
};

export type ExplanationDiagnosticSummary = {
  debugRoot: string;
  generatedAt: string;
  folderCount: number;
  choiceCount: number;
  codeCounts: Record<ExplanationDiagnosticCode, number>;
  confidenceDistribution: Record<ExplanationDiagnosticConfidence, number>;
  reports: Array<{
    debugDir: string;
    problemId: number | null;
    choiceCount: number;
    source: ExplanationDiagnosticsReport['source'];
  }>;
};

type DebugInput = {
  problem?: {
    id?: number;
    correct_choice_id?: number;
  };
  choices?: Array<{
    choice_id?: number;
  }>;
};

type ValidationIssue = {
  code?: string;
  severity?: string;
  choiceId?: number;
  message?: string;
};

type StyleRepairOutput = {
  repairedChoiceIds?: number[];
};

type FallbackDebugOutput = LlmExplanationResponse & {
  replacedChoiceIds?: number[];
  reasonByChoiceId?: Record<string, string[]>;
};

const DEBUG_FILES = [
  'input.json',
  'move-facts.json',
  'position-features.json',
  'line-continuation-features.json',
  'line-trajectory-features.json',
  'usable-evidence.json',
  'feature-coverage-report.json',
  'contrast-features.json',
  'plans.json',
  'prompt.txt',
  'llm-output.json',
  'retry-prompt.txt',
  'retry-llm-output.json',
  'validated.json',
  'validation-issues.json',
  'retry-validation-issues.json',
  'fallback-output.json',
  'style-repair-output.json',
] as const;

const REQUIRED_SUMMARY_CODES: ExplanationDiagnosticCode[] = [
  'unsupported_claim',
  'weak_wrong_choice_reason',
  'missing_contrast_feature',
  'generic_wrong_choice_only',
  'missing_own_strength_in_wrong_choice',
  'too_plain_correct_choice',
  'overstated_attack_disappears',
  'vague_expectation_phrase',
  'unsupported_large_gain_comparison',
  'low_usable_evidence',
  'missing_material_trajectory',
  'missing_activity_trajectory',
  'missing_king_safety_trajectory',
  'style_bad_phrase',
  'fallback_used',
  'retry_used',
];

const GENERIC_PHRASES = [
  '効果的',
  'おすすめ',
  'お勧め',
  '可能性',
  '可能性があります',
  '効果',
  '圧力',
  '自然な一手',
  '成果が出にくい',
  '対応が必要',
  '狙いが弱く',
  'この手を無視できない',
  '優勢',
  '有利',
  '形勢',
  '評価が良い',
  '保てる',
  '勝ちやすい',
  '見込み',
];

const BAD_PHRASES = [
  ...GENERIC_PHRASES,
  '反撃',
];

const SOFT_REPAIR_PHRASES = [
  ...GENERIC_PHRASES,
  '攻め筋が消える',
  '攻め筋がなくなる',
  '攻めが消える',
  '攻めがなくなる',
  '大きな得ではない',
  '得ではない',
];

const VAGUE_WRONG_CHOICE_PHRASES = [
  '攻め味が薄い',
  '攻め味が弱い',
  '攻めが続かない',
  '物足りない',
  '狙いが弱い',
  '十分でない',
  'はっきりしない',
];

const LABEL_START_PATTERN = /^[▲△]?[１-９一二三四五六七八九0-9]+[一二三四五六七八九]?[歩香桂銀金角飛玉王と馬龍竜成打]/;

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists<T>(debugDir: string, fileName: string): Promise<T | undefined> {
  const filePath = path.join(debugDir, fileName);
  if (!(await exists(filePath))) return undefined;
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function listPresentDebugFiles(debugDir: string): Promise<string[]> {
  const present: string[] = [];
  for (const file of DEBUG_FILES) {
    if (await exists(path.join(debugDir, file))) present.push(file);
  }
  return present;
}

function toChoiceId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function outputSource(filesPresent: string[]): ExplanationDiagnosticsReport['source'] {
  if (filesPresent.includes('validated.json')) return 'validated';
  if (filesPresent.includes('fallback-output.json')) return 'fallback';
  if (filesPresent.includes('retry-llm-output.json')) return 'retry';
  if (filesPresent.includes('llm-output.json')) return 'llm';
  return 'none';
}

function byChoiceId<T extends { choiceId?: number }>(items: T[] | undefined): Map<number, T> {
  const map = new Map<number, T>();
  for (const item of items ?? []) {
    if (typeof item.choiceId === 'number') map.set(item.choiceId, item);
  }
  return map;
}

function planByChoiceId(plans: ExplanationPlan[] | undefined): Map<number, ExplanationPlan> {
  const map = new Map<number, ExplanationPlan>();
  for (const plan of plans ?? []) {
    if (typeof plan.choiceId === 'number') map.set(plan.choiceId, plan);
  }
  return map;
}

function validationIssuesByChoiceId(issues: ValidationIssue[] | undefined): Map<number, ValidationIssue[]> {
  const map = new Map<number, ValidationIssue[]>();
  for (const issue of issues ?? []) {
    if (typeof issue.choiceId !== 'number') continue;
    const bucket = map.get(issue.choiceId) ?? [];
    bucket.push(issue);
    map.set(issue.choiceId, bucket);
  }
  return map;
}

function sentenceCount(text: string): number {
  return text
    .split('。')
    .map((sentence) => sentence.trim())
    .filter(Boolean).length;
}

function compactText(text: string): string {
  return text
    .replace(/[、，。,.]/g, '')
    .replace(/\s+/g, '')
    .replace(/正解手ほど攻めが続かない/g, '<mainline-weaker>')
    .replace(/攻め味が薄い/g, '<vague-attack>')
    .replace(/攻め味が弱い/g, '<vague-attack>');
}

function compactGenericWrongText(text: string): string {
  return text
    .replace(/[、，。,.]/g, '')
    .replace(/\s+/g, '')
    .replace(/正解手ほど攻めが続かない/g, '')
    .replace(/正解手と比べると攻め味が弱い/g, '')
    .replace(/攻め味が弱い/g, '')
    .replace(/攻め味が薄い/g, '')
    .replace(/後続の攻めが弱い/g, '')
    .replace(/厳しい狙いが残りにくい/g, '')
    .replace(/狙いが残りにくい/g, '')
    .replace(/攻めが続かない/g, '')
    .replace(/物足りない/g, '');
}

function includesLoose(text: string, phrase: string): boolean {
  const normalizedText = text.replace(/，/g, '、');
  const normalizedPhrase = phrase.replace(/，/g, '、').trim();
  if (!normalizedPhrase) return false;
  if (normalizedText.includes(normalizedPhrase)) return true;
  if (
    (normalizedPhrase.includes('角が成れる') || normalizedPhrase.includes('角成')) &&
    (normalizedText.includes('角が成') || normalizedText.includes('角成'))
  ) return true;
  if (normalizedPhrase.includes('馬を作れる') && normalizedText.includes('馬を作')) return true;
  if (normalizedPhrase.includes('龍を作れる') && (normalizedText.includes('龍を作') || normalizedText.includes('竜を作'))) {
    return true;
  }
  return false;
}

function hasOwnStrengthPhrase(explanation: string, ownStrengths: string[]): boolean {
  return ownStrengths.some((phrase) => {
    if (includesLoose(explanation, phrase)) return true;
    if (phrase === '歩を取れる' && explanation.includes('一歩取れる')) return true;
    if (phrase === '一歩取れる' && explanation.includes('歩を取れる')) return true;
    if (phrase.includes('飛車取り') && explanation.includes('飛車取り')) return true;
    if (phrase.includes('角成') && (explanation.includes('角成') || explanation.includes('角が成'))) return true;
    return false;
  });
}

function phraseEvidenceForChoice(
  moveFacts: DraftMoveFacts | undefined,
  positionFeatures: DraftPositionFeatures | undefined,
): string[] {
  return [
    ...(moveFacts?.factPhrases ?? []),
    ...(moveFacts?.firstResponseFacts ?? []),
    ...(positionFeatures?.summaryPhrases ?? []),
    ...(positionFeatures?.material.materialPhrases ?? []),
    ...(positionFeatures?.pieceActivity.activityPhrases ?? []),
    ...(positionFeatures?.kingSafety.kingSafetyPhrases ?? []),
  ].filter((phrase) => phrase.trim());
}

function hasFactPhrase(explanation: string, phrases: string[]): boolean {
  return phrases.some((phrase) => includesLoose(explanation, phrase));
}

function continuationEvidence(lineContinuation: DraftLineContinuationFeatures | undefined): string[] {
  return [
    ...(lineContinuation?.continuationPhrases ?? []),
    ...(lineContinuation?.nextOwnMoveFacts ?? []),
  ].filter((phrase) => phrase.trim());
}

function usableEvidenceForChoice(lineTrajectory: DraftLineTrajectoryFeatures | undefined): string[] {
  return (lineTrajectory?.usableEvidence ?? [])
    .filter((item) => item.evidenceLevel !== 'weak' && item.evidenceLevel !== 'none')
    .map((item) => item.phrase)
    .filter((phrase) => phrase.trim());
}

function hasMaterialTrajectory(lineTrajectory: DraftLineTrajectoryFeatures | undefined): boolean {
  if (!lineTrajectory) return false;
  return lineTrajectory.snapshots.some((snapshot) =>
    snapshot.material.materialBalanceFromChoiceSide !== null ||
    snapshot.material.capturedPieces.length > 0 ||
    snapshot.material.promotedPieces.length > 0
  );
}

function hasActivityTrajectory(lineTrajectory: DraftLineTrajectoryFeatures | undefined): boolean {
  if (!lineTrajectory) return false;
  return lineTrajectory.snapshots.some((snapshot) =>
    snapshot.pieceActivity.attackedPieces.length > 0 ||
    snapshot.pieceActivity.attackedHighValuePieces.length > 0 ||
    snapshot.pieceActivity.longRangePieceActivityCount > 0 ||
    snapshot.pieceActivity.ownAttacksNearOpponentKing !== null
  );
}

function hasKingSafetyTrajectory(lineTrajectory: DraftLineTrajectoryFeatures | undefined): boolean {
  if (!lineTrajectory) return false;
  return lineTrajectory.snapshots.some((snapshot) =>
    snapshot.kingSafety.ownKingSquare !== null ||
    snapshot.kingSafety.opponentKingSquare !== null ||
    snapshot.kingSafety.ownKingNearbyDefenders !== null ||
    snapshot.kingSafety.opponentAttacksNearOwnKing !== null ||
    snapshot.kingSafety.ownAttacksNearOpponentKing !== null
  );
}

function hasContinuationPhrase(
  explanation: string,
  lineContinuation: DraftLineContinuationFeatures | undefined,
): boolean {
  return continuationEvidence(lineContinuation).some((phrase) => includesLoose(explanation, phrase));
}

function hasEscapeEvidence(
  moveFacts: DraftMoveFacts | undefined,
  lineContinuation: DraftLineContinuationFeatures | undefined,
): boolean {
  return [
    ...(moveFacts?.firstResponseFacts ?? []),
    ...(moveFacts?.factPhrases ?? []),
    ...(lineContinuation?.continuationPhrases ?? []),
  ].some((phrase) =>
    phrase.includes('逃げられる') ||
    phrase.includes('逃げる') ||
    phrase.includes('逃げても') ||
    phrase.includes('かわされる')
  );
}

function hasCounterattackEvidence(
  moveFacts: DraftMoveFacts | undefined,
  positionFeatures: DraftPositionFeatures | undefined,
  lineContinuation: DraftLineContinuationFeatures | undefined,
): boolean {
  const evidence = [
    ...phraseEvidenceForChoice(moveFacts, positionFeatures),
    ...continuationEvidence(lineContinuation),
    ...(moveFacts?.tacticalMotifs ?? []),
  ];
  return evidence.some((phrase) =>
    phrase.includes('反撃') ||
    phrase.includes('攻め返') ||
    phrase.includes('切り返')
  );
}

function hasKingDangerEvidence(positionFeatures: DraftPositionFeatures | undefined): boolean {
  return Boolean(
    positionFeatures?.kingSafety.confidence === 'medium' &&
    positionFeatures.kingSafety.kingSafetyPhrases.some((phrase) => phrase.trim()),
  );
}

function hasStrongClaimEvidence(
  moveFacts: DraftMoveFacts | undefined,
  positionFeatures: DraftPositionFeatures | undefined,
  lineContinuation: DraftLineContinuationFeatures | undefined,
): boolean {
  const evidence = [
    ...phraseEvidenceForChoice(moveFacts, positionFeatures),
    ...continuationEvidence(lineContinuation),
    ...(moveFacts?.tacticalMotifs ?? []),
  ];
  return evidence.some((phrase) =>
    phrase.includes('詰') ||
    phrase.includes('必至') ||
    phrase.includes('勝ち') ||
    phrase.includes('優勢') ||
    phrase.includes('有利') ||
    phrase.includes('形勢') ||
    phrase.includes('評価が良い') ||
    phrase.includes('保てる') ||
    phrase.includes('勝ちやすい') ||
    phrase.includes('決め手')
  );
}

function hasMaterialComparisonEvidence(positionFeatures: DraftPositionFeatures | undefined): boolean {
  return Boolean(
    (positionFeatures?.material.roughImmediateMaterialGain ?? 0) > 0 ||
    positionFeatures?.material.materialPhrases.some((phrase) =>
      phrase.includes('駒得') ||
      phrase.includes('取れる') ||
      phrase.includes('得')
    )
  );
}

function addDiagnostic(
  diagnostics: ExplanationDiagnostic[],
  code: ExplanationDiagnosticCode,
  severity: ExplanationDiagnosticSeverity,
  message: string,
): void {
  if (diagnostics.some((diagnostic) => diagnostic.code === code && diagnostic.message === message)) return;
  diagnostics.push({ code, severity, message });
}

function addValidationIssueDiagnostics(
  diagnostics: ExplanationDiagnostic[],
  issues: ValidationIssue[],
): void {
  for (const issue of issues) {
    if (issue.code === 'too_many_sentences') {
      addDiagnostic(diagnostics, 'too_many_sentences', 'warning', issue.message ?? '3文以上になっている');
    } else if (issue.code === 'bad_phrase') {
      addDiagnostic(diagnostics, 'style_bad_phrase', 'warning', issue.message ?? '禁止・弱い表現が含まれている');
    } else if (issue.code === 'unsupported_claim') {
      addDiagnostic(diagnostics, 'unsupported_claim', 'warning', issue.message ?? '強い評価・終局表現の根拠が不足している');
    } else if (issue.code === 'unsupported_escape_phrase') {
      addDiagnostic(diagnostics, 'unsupported_escape', 'warning', issue.message ?? '逃げ表現の根拠が不足している');
    } else if (issue.code === 'unsupported_counterattack_phrase') {
      addDiagnostic(diagnostics, 'unsupported_counterattack', 'warning', issue.message ?? '反撃表現の根拠が不足している');
    } else if (issue.code === 'unsupported_risk_phrase') {
      addDiagnostic(diagnostics, 'unsupported_king_danger', 'warning', issue.message ?? '玉の危険表現の根拠が不足している');
    } else if (issue.code === 'missing_required_continuation_phrase') {
      addDiagnostic(diagnostics, 'missing_line_continuation', 'warning', issue.message ?? '継続事実が本文に使われていない');
    }
  }
}

function finalTextRelevantValidationIssues(explanation: string, issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => {
    if (issue.code === 'bad_phrase') {
      return SOFT_REPAIR_PHRASES.some((phrase) => explanation.includes(phrase));
    }
    if (issue.code === 'unsupported_escape_phrase') {
      return explanation.includes('逃げられる') || explanation.includes('かわされる') || explanation.includes('逃げても');
    }
    if (issue.code === 'unsupported_counterattack_phrase') {
      return explanation.includes('反撃');
    }
    if (issue.code === 'unsupported_risk_phrase') {
      return explanation.includes('危険') || explanation.includes('危ない') || explanation.includes('玉が薄い');
    }
    if (issue.code === 'unsupported_claim') {
      return (
        explanation.includes('詰み') ||
        explanation.includes('必至') ||
        explanation.includes('勝ち') ||
        explanation.includes('優勢') ||
        explanation.includes('有利') ||
        explanation.includes('形勢') ||
        explanation.includes('評価が良い') ||
        explanation.includes('保てる') ||
        explanation.includes('勝ちやすい') ||
        explanation.includes('決め手')
      );
    }
    return true;
  });
}

function diagnoseConfidence(diagnostics: ExplanationDiagnostic[]): ExplanationDiagnosticConfidence {
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  if (errorCount > 0 || warningCount >= 2) return 'low';
  if (warningCount === 1) return 'medium';
  return diagnostics.some((diagnostic) => diagnostic.severity === 'info') ? 'medium' : 'low';
}

function isWrongChoice(choiceId: number, input: DebugInput | undefined, plan: ExplanationPlan | undefined): boolean {
  if (typeof plan?.isCorrect === 'boolean') return !plan.isCorrect;
  return input?.problem?.correct_choice_id !== choiceId;
}

function hasChoiceSpecificEvidence(explanation: string, ownPhrases: string[]): boolean {
  return hasFactPhrase(explanation, ownPhrases);
}

function hasContrastText(explanation: string, correctPhrases: string[]): boolean {
  return correctPhrases.some((phrase) => includesLoose(explanation, phrase));
}

function diagnoseChoice(params: {
  choiceId: number;
  explanation: string;
  input?: DebugInput;
  moveFacts?: DraftMoveFacts;
  positionFeatures?: DraftPositionFeatures;
  lineContinuation?: DraftLineContinuationFeatures;
  lineTrajectory?: DraftLineTrajectoryFeatures;
  contrastFeatures?: DraftChoiceContrastFeatures;
  plan?: ExplanationPlan;
  correctPhrases: string[];
  validationIssues: ValidationIssue[];
  fallbackUsed: boolean;
  retryUsed: boolean;
  repeatedWrongTemplate: boolean;
  labelStartOverused: boolean;
}): ExplanationChoiceDiagnostics {
  const diagnostics: ExplanationDiagnostic[] = [];
  const {
    choiceId,
    explanation,
    input,
    moveFacts,
    positionFeatures,
    lineContinuation,
    lineTrajectory,
    contrastFeatures,
    plan,
    correctPhrases,
    validationIssues,
    fallbackUsed,
    retryUsed,
    repeatedWrongTemplate,
    labelStartOverused,
  } = params;
  const factPhrases = phraseEvidenceForChoice(moveFacts, positionFeatures);
  const ownContinuationEvidence = continuationEvidence(lineContinuation);
  const usableEvidence = usableEvidenceForChoice(lineTrajectory);
  const contrastPhrases = contrastFeatures?.contrastPhrases ?? [];
  const ownStrengths = contrastFeatures?.ownStrengths ?? [];
  const contrastStrengths = [
    ...(contrastFeatures?.correctStrengths ?? []),
    ...ownStrengths,
    ...(contrastFeatures?.missingComparedToCorrect ?? []),
  ];
  const wrongChoice = isWrongChoice(choiceId, input, plan);

  addValidationIssueDiagnostics(diagnostics, finalTextRelevantValidationIssues(explanation, validationIssues));

  if (fallbackUsed) {
    addDiagnostic(diagnostics, 'fallback_used', 'warning', 'fallback-output.json が使われている');
  }
  if (retryUsed) {
    addDiagnostic(diagnostics, 'retry_used', 'info', 'retry-llm-output.json または retry-prompt.txt が残っている');
  }

  if (sentenceCount(explanation) > 2) {
    addDiagnostic(diagnostics, 'too_many_sentences', 'warning', '解説が3文以上になっている');
  }

  if (usableEvidence.length < 2) {
    addDiagnostic(diagnostics, 'low_usable_evidence', 'warning', '本文に使える直接・line上の証拠が少ない');
  }
  if (!hasMaterialTrajectory(lineTrajectory)) {
    addDiagnostic(diagnostics, 'missing_material_trajectory', 'warning', 'line上の駒損得推移が取れていない');
  }
  if (!hasActivityTrajectory(lineTrajectory)) {
    addDiagnostic(diagnostics, 'missing_activity_trajectory', 'warning', 'line上の駒の効き推移が取れていない');
  }
  if (!hasKingSafetyTrajectory(lineTrajectory)) {
    addDiagnostic(diagnostics, 'missing_king_safety_trajectory', 'info', 'line上の玉安全推移が取れていない');
  }

  const badPhrase = BAD_PHRASES.find((phrase) => explanation.includes(phrase));
  if (badPhrase) {
    addDiagnostic(diagnostics, 'style_bad_phrase', 'warning', `避けたい表現「${badPhrase}」が含まれている`);
  }

  const genericPhrase = GENERIC_PHRASES.find((phrase) => explanation.includes(phrase));
  if (genericPhrase) {
    addDiagnostic(diagnostics, 'style_too_generic', 'warning', `抽象的な表現「${genericPhrase}」に寄っている`);
  }

  if (labelStartOverused && LABEL_START_PATTERN.test(explanation.trim())) {
    addDiagnostic(diagnostics, 'style_label_start_overused', 'warning', '複数choiceで手のラベル始まりが繰り返されている');
  }

  if (hasFactPhrase(explanation, factPhrases)) {
    addDiagnostic(diagnostics, 'ok_uses_fact_phrase', 'info', 'move_facts / position_features のfact phraseを使えている');
  }
  if (wrongChoice && hasFactPhrase(explanation, contrastPhrases)) {
    addDiagnostic(diagnostics, 'ok_uses_fact_phrase', 'info', 'contrast_features のcontrastPhrasesを使えている');
  }

  if (hasContinuationPhrase(explanation, lineContinuation)) {
    addDiagnostic(diagnostics, 'ok_uses_continuation', 'info', 'line_continuation_features のcontinuationPhrasesを使えている');
  } else if (!wrongChoice && ownContinuationEvidence.length > 0) {
    addDiagnostic(diagnostics, 'missing_line_continuation', 'warning', '正解手のline_continuation_featuresが本文に使われていない');
  }

  if (
    !wrongChoice &&
    !hasFactPhrase(explanation, factPhrases) &&
    !hasContinuationPhrase(explanation, lineContinuation) &&
    explanation.includes('攻めが続く') &&
    explanation.replace(/[▲△１-９一二三四五六七八九歩香桂銀金角飛玉王と馬龍竜成打は。攻めが続く，、\s]/g, '').length < 4
  ) {
    addDiagnostic(diagnostics, 'too_plain_correct_choice', 'warning', '正解手なのに具体factより「攻めが続く」に寄っている');
  }

  if (
    (explanation.includes('逃げられる') || explanation.includes('かわされる') || explanation.includes('逃げても')) &&
    !hasEscapeEvidence(moveFacts, lineContinuation)
  ) {
    addDiagnostic(diagnostics, 'unsupported_escape', 'warning', '逃げる/かわす表現を支えるfeaturesが不足している');
  }

  if (explanation.includes('反撃') && !hasCounterattackEvidence(moveFacts, positionFeatures, lineContinuation)) {
    addDiagnostic(diagnostics, 'unsupported_counterattack', 'warning', '反撃表現を支えるfeaturesが不足している');
  }

  if (
    (explanation.includes('危険') || explanation.includes('危ない') || explanation.includes('玉が薄い')) &&
    !hasKingDangerEvidence(positionFeatures)
  ) {
    addDiagnostic(diagnostics, 'unsupported_king_danger', 'warning', 'kingSafety.confidence=medium の根拠なしに危険表現を使っている');
  }

  if (
    (explanation.includes('詰み') ||
      explanation.includes('必至') ||
      explanation.includes('勝ち') ||
      explanation.includes('優勢') ||
      explanation.includes('有利') ||
      explanation.includes('形勢') ||
      explanation.includes('評価が良い') ||
      explanation.includes('保てる') ||
      explanation.includes('勝ちやすい') ||
      explanation.includes('決め手')) &&
    !hasStrongClaimEvidence(moveFacts, positionFeatures, lineContinuation)
  ) {
    addDiagnostic(diagnostics, 'unsupported_claim', 'warning', '強い評価・終局表現を支えるfeaturesが不足している');
  }

  if (
    explanation.includes('攻め筋が消える') ||
    explanation.includes('攻め筋がなくなる') ||
    explanation.includes('攻めが消える') ||
    explanation.includes('攻めがなくなる')
  ) {
    addDiagnostic(diagnostics, 'overstated_attack_disappears', 'warning', '攻め筋が消える系の強い断定が含まれている');
  }

  if (
    explanation.includes('見込み') ||
    explanation.includes('可能性') ||
    explanation.includes('かもしれない') ||
    explanation.includes('と思われる')
  ) {
    addDiagnostic(diagnostics, 'vague_expectation_phrase', 'warning', '見込み・可能性などの曖昧表現が含まれている');
  }

  if (
    (explanation.includes('大きな得ではない') ||
      explanation.includes('得ではない') ||
      explanation.includes('大きな得')) &&
    !hasMaterialComparisonEvidence(positionFeatures)
  ) {
    addDiagnostic(diagnostics, 'unsupported_large_gain_comparison', 'warning', '駒得比較を支えるmaterial featuresが不足している');
  }

  if (wrongChoice) {
    const usesContrastPhrase = hasFactPhrase(explanation, contrastPhrases);
    const usesOwnStrength = hasOwnStrengthPhrase(explanation, ownStrengths);
    const usesOwnEvidence = hasChoiceSpecificEvidence(explanation, factPhrases) || usesContrastPhrase || usesOwnStrength;
    const usesContrast = usesContrastPhrase ||
      hasFactPhrase(explanation, contrastStrengths) ||
      hasContrastText(explanation, correctPhrases);
    const weakFallbackText = explanation.includes('正解手ほど攻めが続かない');
    const vagueText = VAGUE_WRONG_CHOICE_PHRASES.some((phrase) => explanation.includes(phrase));
    const genericWrongOnly = compactGenericWrongText(explanation).length === 0;

    if (repeatedWrongTemplate) {
      addDiagnostic(diagnostics, 'repetitive_wrong_choice_template', 'warning', '不正解手どうしで似たテンプレート表現が繰り返されている');
    }
    if (ownStrengths.length > 0 && !usesOwnStrength) {
      addDiagnostic(diagnostics, 'missing_own_strength_in_wrong_choice', 'warning', 'ownStrengths があるのに本文に使われていない');
    }
    if (genericWrongOnly) {
      addDiagnostic(diagnostics, 'generic_wrong_choice_only', 'warning', '不正解手の説明が汎用的な弱さだけになっている');
    }
    if (!usesOwnEvidence && vagueText) {
      addDiagnostic(diagnostics, 'vague_wrong_choice_reason', 'warning', 'その手固有のfactより曖昧な弱さの説明に寄っている');
    }
    if (weakFallbackText && (!usesOwnEvidence || explanation.replace('正解手ほど攻めが続かない', '').length < 12)) {
      addDiagnostic(diagnostics, 'weak_wrong_choice_reason', 'warning', '「正解手ほど攻めが続かない」に説明が寄り、具体的な悪さが弱い');
    }
    const hasUsableContrastFeature = Boolean(
      contrastFeatures &&
      contrastFeatures.contrastPhrases.length > 0 &&
      contrastFeatures.diagnosis !== 'unclear' &&
      contrastFeatures.confidence === 'medium'
    );
    if (!contrastFeatures || contrastFeatures.contrastPhrases.length === 0 || contrastFeatures.diagnosis === 'unclear') {
      addDiagnostic(diagnostics, 'missing_contrast_feature', 'warning', '正解手との差分featuresが作られていない');
    } else if (!hasUsableContrastFeature && (!usesContrast || (!usesOwnEvidence && correctPhrases.length > 0))) {
      addDiagnostic(diagnostics, 'missing_contrast_feature', 'warning', '正解手との差分featuresが十分に本文へ出ていない');
    }
  }

  return {
    choiceId,
    explanation,
    diagnostics,
    confidence: diagnoseConfidence(diagnostics),
  };
}

function repeatedWrongTemplates(
  choices: Array<{ choiceId: number; explanation: string }>,
  input: DebugInput | undefined,
  plansByChoiceId: Map<number, ExplanationPlan>,
): Set<number> {
  const wrongChoices = choices.filter((choice) => isWrongChoice(choice.choiceId, input, plansByChoiceId.get(choice.choiceId)));
  const repeated = new Set<number>();
  for (let i = 0; i < wrongChoices.length; i += 1) {
    for (let j = i + 1; j < wrongChoices.length; j += 1) {
      const a = compactText(wrongChoices[i].explanation);
      const b = compactText(wrongChoices[j].explanation);
      if (a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a))) {
        repeated.add(wrongChoices[i].choiceId);
        repeated.add(wrongChoices[j].choiceId);
      }
    }
  }
  return repeated;
}

function outputChoices(response: LlmExplanationResponse | undefined): Array<{ choiceId: number; explanation: string }> {
  return (response?.choices ?? [])
    .map((choice) => ({
      choiceId: toChoiceId(choice.choice_id),
      explanation: typeof choice.explanation === 'string' ? choice.explanation.trim() : '',
    }))
    .filter((choice): choice is { choiceId: number; explanation: string } => choice.choiceId !== null);
}

export async function diagnoseExplanationDebugDirectory(
  debugDir: string,
  options: { write?: boolean } = {},
): Promise<ExplanationDiagnosticsReport> {
  const filesPresent = await listPresentDebugFiles(debugDir);
  const input = await readJsonIfExists<DebugInput>(debugDir, 'input.json');
  const moveFacts = await readJsonIfExists<DraftMoveFacts[]>(debugDir, 'move-facts.json');
  const positionFeatures = await readJsonIfExists<DraftPositionFeatures[]>(debugDir, 'position-features.json');
  const lineContinuationFeatures = await readJsonIfExists<DraftLineContinuationFeatures[]>(
    debugDir,
    'line-continuation-features.json',
  );
  const lineTrajectoryFeatures = await readJsonIfExists<DraftLineTrajectoryFeatures[]>(
    debugDir,
    'line-trajectory-features.json',
  );
  const contrastFeatures = await readJsonIfExists<DraftChoiceContrastFeatures[]>(debugDir, 'contrast-features.json');
  const plans = await readJsonIfExists<ExplanationPlan[]>(debugDir, 'plans.json');
  const llmOutput = await readJsonIfExists<LlmExplanationResponse>(debugDir, 'llm-output.json');
  const retryLlmOutput = await readJsonIfExists<LlmExplanationResponse>(debugDir, 'retry-llm-output.json');
  const fallbackOutput = await readJsonIfExists<FallbackDebugOutput>(debugDir, 'fallback-output.json');
  const styleRepairOutput = await readJsonIfExists<StyleRepairOutput>(debugDir, 'style-repair-output.json');
  const validated = await readJsonIfExists<LlmExplanationResponse>(debugDir, 'validated.json');
  const validationIssues = await readJsonIfExists<ValidationIssue[]>(debugDir, 'validation-issues.json');
  const retryValidationIssues = await readJsonIfExists<ValidationIssue[]>(debugDir, 'retry-validation-issues.json');
  const source = outputSource(filesPresent);
  const choices = outputChoices(validated ?? fallbackOutput ?? retryLlmOutput ?? llmOutput);
  const moveFactsByChoiceId = byChoiceId(moveFacts);
  const positionFeaturesByChoiceId = byChoiceId(positionFeatures);
  const lineContinuationByChoiceId = byChoiceId(lineContinuationFeatures);
  const lineTrajectoryByChoiceId = byChoiceId(lineTrajectoryFeatures);
  const contrastFeaturesByChoiceId = byChoiceId(contrastFeatures);
  const plansByChoiceId = planByChoiceId(plans);
  const allValidationIssuesByChoiceId = validationIssuesByChoiceId([
    ...(validationIssues ?? []),
    ...(retryValidationIssues ?? []),
  ]);
  const repairedChoiceIds = new Set(styleRepairOutput?.repairedChoiceIds ?? []);
  const correctChoiceId = input?.problem?.correct_choice_id;
  const correctMoveFacts = correctChoiceId === undefined ? undefined : moveFactsByChoiceId.get(correctChoiceId);
  const correctPositionFeatures = correctChoiceId === undefined ? undefined : positionFeaturesByChoiceId.get(correctChoiceId);
  const correctLineContinuation = correctChoiceId === undefined ? undefined : lineContinuationByChoiceId.get(correctChoiceId);
  const correctPhrases = [
    ...phraseEvidenceForChoice(correctMoveFacts, correctPositionFeatures),
    ...continuationEvidence(correctLineContinuation),
  ];
  const repeatedWrongChoiceIds = repeatedWrongTemplates(choices, input, plansByChoiceId);
  const labelStartCount = choices.filter((choice) => LABEL_START_PATTERN.test(choice.explanation.trim())).length;
  const labelStartOverused = choices.length > 1 && labelStartCount >= Math.ceil(choices.length / 2);
  const fallbackChoiceIds = new Set(fallbackOutput?.replacedChoiceIds ?? []);
  const retryUsed = filesPresent.includes('retry-llm-output.json') || filesPresent.includes('retry-prompt.txt');

  const report: ExplanationDiagnosticsReport = {
    problemId: input?.problem?.id ?? null,
    debugDir,
    generatedAt: new Date().toISOString(),
    source,
    filesPresent,
    choices: choices.map((choice) => diagnoseChoice({
      choiceId: choice.choiceId,
      explanation: choice.explanation,
      input,
      moveFacts: moveFactsByChoiceId.get(choice.choiceId),
      positionFeatures: positionFeaturesByChoiceId.get(choice.choiceId),
      lineContinuation: lineContinuationByChoiceId.get(choice.choiceId),
      lineTrajectory: lineTrajectoryByChoiceId.get(choice.choiceId),
      contrastFeatures: contrastFeaturesByChoiceId.get(choice.choiceId),
      plan: plansByChoiceId.get(choice.choiceId),
      correctPhrases,
      validationIssues: (allValidationIssuesByChoiceId.get(choice.choiceId) ?? [])
        .filter((issue) => !(issue.code === 'bad_phrase' && repairedChoiceIds.has(choice.choiceId))),
      fallbackUsed: fallbackChoiceIds.has(choice.choiceId),
      retryUsed,
      repeatedWrongTemplate: repeatedWrongChoiceIds.has(choice.choiceId),
      labelStartOverused,
    })),
  };

  if (options.write) {
    await writeFile(path.join(debugDir, 'explanation-diagnostics.json'), JSON.stringify(report, null, 2), 'utf8');
  }

  return report;
}

export async function listExplanationDebugDirectories(debugRoot: string, limit?: number): Promise<string[]> {
  const entries = await readdir(debugRoot, { withFileTypes: true });
  const dirs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const fullPath = path.join(debugRoot, entry.name);
        const stats = await stat(fullPath);
        return { fullPath, mtimeMs: stats.mtimeMs };
      }),
  );
  return dirs
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((dir) => dir.fullPath);
}

export function summarizeExplanationDiagnostics(
  debugRoot: string,
  reports: ExplanationDiagnosticsReport[],
): ExplanationDiagnosticSummary {
  const codeCounts = Object.fromEntries(
    REQUIRED_SUMMARY_CODES.map((code) => [code, 0]),
  ) as Record<ExplanationDiagnosticCode, number>;
  const confidenceDistribution: Record<ExplanationDiagnosticConfidence, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const report of reports) {
    for (const choice of report.choices) {
      confidenceDistribution[choice.confidence] += 1;
      for (const diagnostic of choice.diagnostics) {
        codeCounts[diagnostic.code] = (codeCounts[diagnostic.code] ?? 0) + 1;
      }
    }
  }

  return {
    debugRoot,
    generatedAt: new Date().toISOString(),
    folderCount: reports.length,
    choiceCount: reports.reduce((sum, report) => sum + report.choices.length, 0),
    codeCounts,
    confidenceDistribution,
    reports: reports.map((report) => ({
      debugDir: report.debugDir,
      problemId: report.problemId,
      choiceCount: report.choices.length,
      source: report.source,
    })),
  };
}
