import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildFallbackResponse } from './buildFallbackExplanation.js';
import { buildDraftExplanationPlansForProblem } from './buildDraftExplanationPlan.js';
import { buildExplanationPrompt } from './buildExplanationPrompt.js';
import { diagnoseExplanationDebugDirectory } from './diagnoseExplanationDebug.js';
import { extractEvalFeatures } from './extractEvalFeatures.js';
import { requestExplanationJson } from './llmClient.js';
import type { GenerateChoiceExplanationsInput, GenerateChoiceExplanationsResult, LlmExplanationResponse } from './types.js';
import {
  ExplanationValidationError,
  type ExplanationValidationIssue,
  validateExplanations,
} from './validateExplanations.js';

function shouldWriteDebugLogs(): boolean {
  return process.env.EXPLANATION_DEBUG === '1';
}

function safeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeDebugJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function writeDebugText(filePath: string, value: string): Promise<void> {
  await writeFile(filePath, value, 'utf8');
}

async function writeExplanationDebugLogs(params: {
  problemId: number;
  input: GenerateChoiceExplanationsInput;
  features: unknown;
  plans: unknown;
  moveFacts?: unknown;
  positionFeatures?: unknown;
  lineContinuationFeatures?: unknown;
  contrastFeatures?: unknown;
  prompt: string;
  llmOutput?: unknown;
  validationIssues?: unknown;
  retryPrompt?: string;
  retryLlmOutput?: unknown;
  retryValidationIssues?: unknown;
  fallbackOutput?: unknown;
  validated?: unknown;
  error?: unknown;
}): Promise<void> {
  if (!shouldWriteDebugLogs()) return;

  const dir = path.resolve(
    process.cwd(),
    'tmp',
    'explanation-generation-debug',
    `${params.problemId}-${safeTimestamp()}`,
  );

  await mkdir(dir, { recursive: true });

  await writeDebugJson(path.join(dir, 'input.json'), params.input);
  await writeDebugJson(path.join(dir, 'features.json'), params.features);
  await writeDebugJson(path.join(dir, 'plans.json'), params.plans);
  if (params.moveFacts !== undefined) {
    await writeDebugJson(path.join(dir, 'move-facts.json'), params.moveFacts);
  }
  if (params.positionFeatures !== undefined) {
    await writeDebugJson(path.join(dir, 'position-features.json'), params.positionFeatures);
  }
  if (params.lineContinuationFeatures !== undefined) {
    await writeDebugJson(path.join(dir, 'line-continuation-features.json'), params.lineContinuationFeatures);
  }
  if (params.contrastFeatures !== undefined) {
    await writeDebugJson(path.join(dir, 'contrast-features.json'), params.contrastFeatures);
  }
  await writeDebugText(path.join(dir, 'prompt.txt'), params.prompt);

  if (params.llmOutput !== undefined) {
    await writeDebugJson(path.join(dir, 'llm-output.json'), params.llmOutput);
  }
  if (params.validationIssues !== undefined) {
    await writeDebugJson(path.join(dir, 'validation-issues.json'), params.validationIssues);
  }
  if (params.retryPrompt !== undefined) {
    await writeDebugText(path.join(dir, 'retry-prompt.txt'), params.retryPrompt);
  }
  if (params.retryLlmOutput !== undefined) {
    await writeDebugJson(path.join(dir, 'retry-llm-output.json'), params.retryLlmOutput);
  }
  if (params.retryValidationIssues !== undefined) {
    await writeDebugJson(path.join(dir, 'retry-validation-issues.json'), params.retryValidationIssues);
  }
  if (params.fallbackOutput !== undefined) {
    await writeDebugJson(path.join(dir, 'fallback-output.json'), params.fallbackOutput);
  }

  if (params.validated !== undefined) {
    await writeDebugJson(path.join(dir, 'validated.json'), params.validated);
  }

  if (params.error !== undefined) {
    await writeDebugJson(path.join(dir, 'error.json'), {
      message: params.error instanceof Error ? params.error.message : String(params.error),
      stack: params.error instanceof Error ? params.error.stack : undefined,
    });
  }

  try {
    await diagnoseExplanationDebugDirectory(dir, { write: true });
  } catch (error) {
    console.warn('[explanations] failed to write diagnostics', {
      dir,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  console.log(`[explanations] debug logs written: ${dir}`);
}

function validationContext(plans: ReturnType<typeof buildDraftExplanationPlansForProblem>) {
  return {
    moveFactsList: plans.map((plan) => plan.sourceSignals.moveFacts).filter(Boolean),
    positionFeaturesList: plans.map((plan) => plan.sourceSignals.positionFeatures).filter(Boolean),
    lineContinuationFeaturesList: plans.map((plan) => plan.sourceSignals.lineContinuationFeatures).filter(Boolean),
    requiredContinuationChoiceIds: plans
      .filter((plan) => plan.isCorrect && (plan.sourceSignals.lineContinuationFeatures?.continuationPhrases.length ?? 0) > 0)
      .map((plan) => plan.choiceId),
  };
}

function repairableValidationIssue(issue: ExplanationValidationIssue): boolean {
  return issue.code === 'unsupported_escape_phrase' ||
    issue.code === 'unsupported_risk_phrase' ||
    issue.code === 'missing_required_continuation_phrase' ||
    issue.code === 'too_many_sentences' ||
    issue.code === 'bad_phrase';
}

function fallbackChoiceIds(issues: ExplanationValidationIssue[], plans: ReturnType<typeof buildDraftExplanationPlansForProblem>): Set<number> {
  const ids = new Set<number>();
  for (const issue of issues) {
    if (typeof issue.choiceId === 'number') ids.add(issue.choiceId);
  }
  if (ids.size === 0) {
    for (const plan of plans) ids.add(plan.choiceId);
  }
  return ids;
}

function buildRetryPrompt(prompt: string): string {
  return [
    prompt,
    '',
    '追加注意:',
    '前回の出力には、根拠のない「逃げられる」「かわされる」が含まれていました。',
    'move_facts.firstResponseFacts / factPhrases / line_continuation_features で確認できない場合、',
    '「逃げられる」「かわされる」は使わず、',
    '「正解手ほど攻めが続かない」「攻め味が弱い」のように控えめに書き直してください。',
    '根拠のない「反撃」「危険」も使わず、move_facts / position_features / line_continuation_features にある事実だけで書いてください。',
    '「可能性」「効果」「優勢」「有利」「形勢」「保てる」のような抽象語や形勢断定は使わないでください。',
    '正解手に line_continuation_features.continuationPhrases がある場合は、必ずその継続事実を1つ本文に入れてください。',
    '各 explanation は必ず1〜2文にしてください。3文以上にしないでください。',
  ].join('\n');
}

export async function generateChoiceExplanations(
  input: GenerateChoiceExplanationsInput,
): Promise<GenerateChoiceExplanationsResult> {
  const sortedChoices = [...input.choices].sort((a, b) => a.choice_id - b.choice_id);
  const features = extractEvalFeatures(input.problem, sortedChoices);
  const plans = buildDraftExplanationPlansForProblem(input.problem, sortedChoices, features);
  const moveFacts = plans.map((plan) => plan.sourceSignals.moveFacts).filter(Boolean);
  const positionFeatures = plans.map((plan) => plan.sourceSignals.positionFeatures).filter(Boolean);
  const lineContinuationFeatures = plans.map((plan) => plan.sourceSignals.lineContinuationFeatures).filter(Boolean);
  const contrastFeatures = plans.map((plan) => plan.sourceSignals.contrastFeatures).filter(Boolean);
  const prompt = buildExplanationPrompt(input.problem, sortedChoices, features, plans);
  const validateContext = validationContext(plans);

  try {
    console.log('[explanations] generating explanations', {
      problemId: input.problem.id,
      choiceCount: sortedChoices.length,
      primaryReasons: plans.map((plan) => ({
        choiceId: plan.choiceId,
        label: plan.label,
        isCorrect: plan.isCorrect,
        primaryReason: plan.primaryReason,
        tone: plan.tone,
        confidence: plan.confidence,
      })),
      promptIncludesBadOldPhrase: prompt.includes('相手に受けを迫る形'),
      promptIncludesNaturalMovePhrase: prompt.includes('自然な一手'),
      promptIncludesClearResultPhrase: prompt.includes('明確な成果'),
    });

    let llmOutput = await requestExplanationJson(prompt);
    let validationIssues: ExplanationValidationIssue[] | undefined;
    let retryPrompt: string | undefined;
    let retryLlmOutput: LlmExplanationResponse | undefined;
    let retryValidationIssues: ExplanationValidationIssue[] | undefined;
    let fallbackOutput: LlmExplanationResponse | undefined;
    let validated;

    try {
      validated = validateExplanations(llmOutput, sortedChoices, validateContext);
    } catch (error) {
      if (!(error instanceof ExplanationValidationError) || !error.issues.some(repairableValidationIssue)) {
        throw error;
      }

      validationIssues = error.issues;
      retryPrompt = buildRetryPrompt(prompt);
      retryLlmOutput = await requestExplanationJson(retryPrompt);

      try {
        validated = validateExplanations(retryLlmOutput, sortedChoices, validateContext);
        llmOutput = retryLlmOutput;
      } catch (retryError) {
        if (!(retryError instanceof ExplanationValidationError)) {
          throw retryError;
        }

        retryValidationIssues = retryError.issues;
        const ids = fallbackChoiceIds(retryError.issues, plans);
        fallbackOutput = buildFallbackResponse({
          baseOutput: retryLlmOutput,
          plans,
          features,
          fallbackChoiceIds: ids,
        });
        validated = validateExplanations(fallbackOutput, sortedChoices, validateContext);
      }
    }

    await writeExplanationDebugLogs({
      problemId: input.problem.id,
      input,
      features,
      plans,
      moveFacts,
      positionFeatures,
      lineContinuationFeatures,
      contrastFeatures,
      prompt,
      llmOutput,
      validationIssues,
      retryPrompt,
      retryLlmOutput,
      retryValidationIssues,
      fallbackOutput,
      validated,
    });

    return {
      problemId: input.problem.id,
      choices: validated.choices
        .sort((a, b) => a.choice_id - b.choice_id)
        .map((choice) => ({
          choiceId: choice.choice_id,
          explanation: choice.explanation,
        })),
    };
  } catch (error) {
    const exposedError = error instanceof ExplanationValidationError
      ? new Error('AI解説の生成結果に根拠の弱い表現が含まれたため保存しませんでした。もう一度生成してください。')
      : error;
    await writeExplanationDebugLogs({
      problemId: input.problem.id,
      input,
      features,
      plans,
      moveFacts,
      positionFeatures,
      lineContinuationFeatures,
      contrastFeatures,
      prompt,
      error: exposedError,
      validationIssues: error instanceof ExplanationValidationError ? error.issues : undefined,
    });

    throw exposedError;
  }
}
