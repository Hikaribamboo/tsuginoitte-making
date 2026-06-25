import type {
  DraftLineContinuationFeatures,
  DraftMoveFacts,
  DraftPositionFeatures,
  DraftProblemChoice,
  LlmExplanationResponse,
} from './types.js';

const MAX_EXPLANATION_LENGTH = 240;
const SOFT_STYLE_PHRASES = [
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
  '見込み',
  '有効な手',
  '有利',
  '攻め筋が消える',
  '攻め筋が消えてしまう',
  '攻め筋がなくなる',
  '攻めが消える',
  '攻めがなくなる',
  '大きな得ではない',
  '得ではない',
];

const STRONG_CLAIM_PHRASES = [
  '優勢',
  '有利',
  '形勢',
  '評価が良い',
  '保てる',
  '勝ちやすい',
];

export type ExplanationValidationIssueCode =
  | 'missing_choice'
  | 'duplicate_choice'
  | 'invalid_choice_id'
  | 'too_short'
  | 'too_long'
  | 'too_many_sentences'
  | 'bad_phrase'
  | 'unsupported_escape_phrase'
  | 'unsupported_counterattack_phrase'
  | 'unsupported_risk_phrase'
  | 'unsupported_claim'
  | 'missing_required_continuation_phrase'
  | 'candidate_label_overused'
  | 'candidate_move_as_subject'
  | 'wrong_choice_called_good_move';

export type ExplanationValidationSeverity = 'hard' | 'soft';

export type ExplanationValidationIssue = {
  code: ExplanationValidationIssueCode;
  severity: ExplanationValidationSeverity;
  choiceId?: number;
  phrase?: string;
  message: string;
};

export class ExplanationValidationError extends Error {
  readonly issues: ExplanationValidationIssue[];

  constructor(issues: ExplanationValidationIssue[]) {
    super(issues[0]?.message ?? 'LLM output validation failed');
    this.name = 'ExplanationValidationError';
    this.issues = issues;
  }
}

export type ExplanationValidationContext = {
  moveFactsList?: DraftMoveFacts[];
  positionFeaturesList?: DraftPositionFeatures[];
  lineContinuationFeaturesList?: DraftLineContinuationFeatures[];
  requiredContinuationChoiceIds?: number[];
  correctChoiceId?: number;
};

const SHOGI_LABEL_START_PATTERN = /^[▲△]?[１-９一二三四五六七八九0-9]+[一二三四五六七八九]?[歩香桂銀金角飛玉王と馬龍竜成打]/;
const CANDIDATE_MOVE_SUBJECT_PATTERNS = [
  /[歩香桂銀金角飛玉王と馬龍竜成銀成桂成香]+を[１-９][一二三四五六七八九]に(?:動かす|打つ)と/,
  /[１-９][一二三四五六七八九]に[歩香桂銀金角飛玉王と馬龍竜成銀成桂成香]+を打つと/,
  /歩を[１-９][一二三四五六七八九]に突くのは/,
  /[１-９][一二三四五六七八九]に歩を突くのは/,
];

function normalizeLabelForText(label: string): string {
  return label.replace(/^([▲△])/, '').trim();
}

function startsWithCandidateLabel(explanation: string, label: string | undefined): boolean {
  const text = explanation.trim();
  const normalizedLabel = normalizeLabelForText(label ?? '');
  if (!normalizedLabel) return SHOGI_LABEL_START_PATTERN.test(text);
  return [
    `${label}は`,
    `${label}では`,
    `${label}で`,
    `${label}には`,
    `${label}なら`,
    `${normalizedLabel}は`,
    `${normalizedLabel}では`,
    `${normalizedLabel}で`,
    `${normalizedLabel}には`,
    `${normalizedLabel}なら`,
  ].some((prefix) => text.startsWith(prefix));
}

function hasCandidateMoveSubject(explanation: string): boolean {
  return CANDIDATE_MOVE_SUBJECT_PATTERNS.some((pattern) => pattern.test(explanation));
}

function hasEscapeEvidence(
  moveFacts: DraftMoveFacts | undefined,
  lineContinuationFeatures: DraftLineContinuationFeatures | undefined,
): boolean {
  return [
    ...(moveFacts?.firstResponseFacts ?? []),
    ...(moveFacts?.factPhrases ?? []),
    ...(lineContinuationFeatures?.continuationPhrases ?? []),
  ].some((phrase) =>
    phrase.includes('逃げられる') ||
    phrase.includes('逃げる') ||
    phrase.includes('逃げても') ||
    phrase.includes('かわされる')
  );
}

function sentenceCount(text: string): number {
  const sentences = text
    .split('。')
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.length;
}

function hasKingSafetyEvidence(positionFeatures: DraftPositionFeatures | undefined): boolean {
  return Boolean(
    positionFeatures?.kingSafety.confidence === 'medium' &&
    positionFeatures.kingSafety.kingSafetyPhrases.some((phrase) => phrase.trim()),
  );
}

function phraseEvidenceForChoice(
  moveFacts: DraftMoveFacts | undefined,
  positionFeatures: DraftPositionFeatures | undefined,
  lineContinuationFeatures: DraftLineContinuationFeatures | undefined,
): string[] {
  return [
    ...(moveFacts?.factPhrases ?? []),
    ...(moveFacts?.firstResponseFacts ?? []),
    ...(moveFacts?.tacticalMotifs ?? []),
    ...(positionFeatures?.summaryPhrases ?? []),
    ...(positionFeatures?.material.materialPhrases ?? []),
    ...(positionFeatures?.pieceActivity.activityPhrases ?? []),
    ...(positionFeatures?.kingSafety.kingSafetyPhrases ?? []),
    ...(lineContinuationFeatures?.continuationPhrases ?? []),
    ...(lineContinuationFeatures?.nextOwnMoveFacts ?? []),
  ].filter((phrase) => phrase.trim());
}

function hasCounterattackEvidence(
  moveFacts: DraftMoveFacts | undefined,
  positionFeatures: DraftPositionFeatures | undefined,
  lineContinuationFeatures: DraftLineContinuationFeatures | undefined,
): boolean {
  return phraseEvidenceForChoice(moveFacts, positionFeatures, lineContinuationFeatures).some((phrase) =>
    phrase.includes('反撃') ||
    phrase.includes('攻め返') ||
    phrase.includes('切り返')
  );
}

function hasStrongClaimEvidence(
  moveFacts: DraftMoveFacts | undefined,
  positionFeatures: DraftPositionFeatures | undefined,
  lineContinuationFeatures: DraftLineContinuationFeatures | undefined,
): boolean {
  return phraseEvidenceForChoice(moveFacts, positionFeatures, lineContinuationFeatures).some((phrase) =>
    phrase.includes('詰') ||
    phrase.includes('必至') ||
    phrase.includes('勝ち') ||
    STRONG_CLAIM_PHRASES.some((claim) => phrase.includes(claim)) ||
    phrase.includes('決め手')
  );
}

function hasContinuationPhraseEvidence(
  explanation: string,
  lineContinuationFeatures: DraftLineContinuationFeatures | undefined,
): boolean {
  const continuationPhrases = lineContinuationFeatures?.continuationPhrases ?? [];
  const nextOwnMoveFacts = lineContinuationFeatures?.nextOwnMoveFacts ?? [];
  const candidates = [...continuationPhrases, ...nextOwnMoveFacts].filter((phrase) => phrase.trim());
  if (candidates.some((phrase) => explanation.includes(phrase))) return true;

  if (
    candidates.some((phrase) => phrase.includes('角が成れる') || phrase.includes('角成')) &&
    (explanation.includes('角成') || explanation.includes('角が成'))
  ) {
    return true;
  }

  if (
    candidates.some((phrase) => phrase.includes('馬を作れる')) &&
    explanation.includes('馬を作')
  ) {
    return true;
  }

  if (
    candidates.some((phrase) => phrase.includes('龍を作れる')) &&
    explanation.includes('龍を作')
  ) {
    return true;
  }

  return false;
}

export function validateExplanations(
  value: LlmExplanationResponse,
  inputChoices: DraftProblemChoice[],
  context: ExplanationValidationContext = {},
): LlmExplanationResponse {
  if (!value || !Array.isArray(value.choices)) {
    throw new ExplanationValidationError([{
      code: 'missing_choice',
      severity: 'hard',
      message: 'LLM output choices must be an array',
    }]);
  }

  const expectedChoiceIds = new Set(inputChoices.map((choice) => choice.choice_id));
  const moveFactsByChoiceId = new Map((context.moveFactsList ?? []).map((facts) => [facts.choiceId, facts]));
  const positionFeaturesByChoiceId = new Map(
    (context.positionFeaturesList ?? []).map((features) => [features.choiceId, features]),
  );
  const lineContinuationByChoiceId = new Map(
    (context.lineContinuationFeaturesList ?? []).map((facts) => [facts.choiceId, facts]),
  );
  const requiredContinuationChoiceIds = new Set(context.requiredContinuationChoiceIds ?? []);
  const choiceById = new Map(inputChoices.map((choice) => [choice.choice_id, choice]));
  const actualChoiceIds = new Set<number>();
  const issues: ExplanationValidationIssue[] = [];

  for (const choice of value.choices) {
    if (!choice || typeof choice.choice_id !== 'number' || !Number.isInteger(choice.choice_id)) {
      issues.push({
        code: 'invalid_choice_id',
        severity: 'hard',
        message: 'LLM output contains invalid choice_id',
      });
      continue;
    }
    if (!expectedChoiceIds.has(choice.choice_id)) {
      issues.push({
        code: 'invalid_choice_id',
        severity: 'hard',
        choiceId: choice.choice_id,
        message: `LLM output contains unknown choice_id=${choice.choice_id}`,
      });
      continue;
    }
    if (actualChoiceIds.has(choice.choice_id)) {
      issues.push({
        code: 'duplicate_choice',
        severity: 'hard',
        choiceId: choice.choice_id,
        message: `LLM output contains duplicate choice_id=${choice.choice_id}`,
      });
      continue;
    }
    if (typeof choice.explanation !== 'string' || !choice.explanation.trim()) {
      issues.push({
        code: 'too_short',
        severity: 'hard',
        choiceId: choice.choice_id,
        message: `LLM output explanation is empty for choice_id=${choice.choice_id}`,
      });
    }
    if (typeof choice.explanation === 'string' && choice.explanation.length > MAX_EXPLANATION_LENGTH) {
      issues.push({
        code: 'too_long',
        severity: 'hard',
        choiceId: choice.choice_id,
        message: `LLM output explanation is too long for choice_id=${choice.choice_id}`,
      });
    }
    const explanation = typeof choice.explanation === 'string' ? choice.explanation : '';
    const inputChoice = choiceById.get(choice.choice_id);
    if (startsWithCandidateLabel(explanation, inputChoice?.label)) {
      issues.push({
        code: 'candidate_label_overused',
        severity: 'soft',
        choiceId: choice.choice_id,
        phrase: inputChoice?.label,
        message: `LLM output starts with candidate label for choice_id=${choice.choice_id}`,
      });
    }
    if (hasCandidateMoveSubject(explanation)) {
      const subjectPattern = CANDIDATE_MOVE_SUBJECT_PATTERNS.find((pattern) => pattern.test(explanation));
      issues.push({
        code: 'candidate_move_as_subject',
        severity: 'soft',
        choiceId: choice.choice_id,
        phrase: subjectPattern ? explanation.match(subjectPattern)?.[0] : undefined,
        message: `LLM output uses candidate move as sentence subject for choice_id=${choice.choice_id}`,
      });
    }
    if (
      typeof context.correctChoiceId === 'number' &&
      choice.choice_id !== context.correctChoiceId &&
      explanation.includes('好手')
    ) {
      issues.push({
        code: 'wrong_choice_called_good_move',
        severity: 'soft',
        choiceId: choice.choice_id,
        phrase: '好手',
        message: `LLM output calls wrong choice good move for choice_id=${choice.choice_id}`,
      });
    }
    if (sentenceCount(explanation) > 2) {
      issues.push({
        code: 'too_many_sentences',
        severity: 'hard',
        choiceId: choice.choice_id,
        message: `LLM output explanation has too many sentences for choice_id=${choice.choice_id}`,
      });
    }
    const badPhrase = SOFT_STYLE_PHRASES.find((phrase) => explanation.includes(phrase));
    if (badPhrase) {
      issues.push({
        code: 'bad_phrase',
        severity: 'soft',
        choiceId: choice.choice_id,
        phrase: badPhrase,
        message: `LLM output contains banned phrase "${badPhrase}" for choice_id=${choice.choice_id}`,
      });
    }
    if (explanation.includes('反撃') && !hasCounterattackEvidence(
      moveFactsByChoiceId.get(choice.choice_id),
      positionFeaturesByChoiceId.get(choice.choice_id),
      lineContinuationByChoiceId.get(choice.choice_id),
    )) {
      issues.push({
        code: 'unsupported_counterattack_phrase',
        severity: 'hard',
        choiceId: choice.choice_id,
        message: `LLM output mentions counterattack without feature evidence for choice_id=${choice.choice_id}`,
      });
    }
    const strongClaim = STRONG_CLAIM_PHRASES.find((phrase) => explanation.includes(phrase));
    if (strongClaim && !hasStrongClaimEvidence(
      moveFactsByChoiceId.get(choice.choice_id),
      positionFeaturesByChoiceId.get(choice.choice_id),
      lineContinuationByChoiceId.get(choice.choice_id),
    )) {
      issues.push({
        code: 'unsupported_claim',
        severity: 'hard',
        choiceId: choice.choice_id,
        phrase: strongClaim,
        message: `LLM output contains unsupported strong claim "${strongClaim}" for choice_id=${choice.choice_id}`,
      });
    }
    if (
      (explanation.includes('逃げられる') || explanation.includes('かわされる')) &&
      !hasEscapeEvidence(moveFactsByChoiceId.get(choice.choice_id), lineContinuationByChoiceId.get(choice.choice_id))
    ) {
      issues.push({
        code: 'unsupported_escape_phrase',
        severity: 'hard',
        choiceId: choice.choice_id,
        message: `LLM output mentions escape without move_facts evidence for choice_id=${choice.choice_id}`,
      });
    }
    if (
      (explanation.includes('危険') || explanation.includes('危ない')) &&
      !hasKingSafetyEvidence(positionFeaturesByChoiceId.get(choice.choice_id))
    ) {
      issues.push({
        code: 'unsupported_risk_phrase',
        severity: 'hard',
        choiceId: choice.choice_id,
        message: `LLM output mentions king risk without position_features evidence for choice_id=${choice.choice_id}`,
      });
    }
    if (
      requiredContinuationChoiceIds.has(choice.choice_id) &&
      !hasContinuationPhraseEvidence(explanation, lineContinuationByChoiceId.get(choice.choice_id))
    ) {
      issues.push({
        code: 'missing_required_continuation_phrase',
        severity: 'hard',
        choiceId: choice.choice_id,
        message: `LLM output does not use required line_continuation_features for choice_id=${choice.choice_id}`,
      });
    }
    actualChoiceIds.add(choice.choice_id);
  }

  if (actualChoiceIds.size !== expectedChoiceIds.size) {
    issues.push({
      code: 'missing_choice',
      severity: 'hard',
      message: 'LLM output choice_id set does not match input choices',
    });
  }

  for (const expectedChoiceId of expectedChoiceIds) {
    if (!actualChoiceIds.has(expectedChoiceId)) {
      issues.push({
        code: 'missing_choice',
        severity: 'hard',
        choiceId: expectedChoiceId,
        message: `LLM output is missing choice_id=${expectedChoiceId}`,
      });
    }
  }

  if (issues.length > 0) {
    throw new ExplanationValidationError(issues);
  }

  return {
    choices: value.choices.map((choice) => ({
      choice_id: choice.choice_id,
      explanation: choice.explanation.trim(),
    })),
  };
}
