export { buildDraftExplanationPlansForProblem } from './buildDraftExplanationPlan.js';
export { buildExplanationPrompt } from './buildExplanationPrompt.js';
export { getStyleExamplesForPlans } from './explanationStyleExamples.js';
export { extractDraftLineContinuationFeatures, extractDraftLineContinuationFeaturesForChoices } from './extractDraftLineContinuationFeatures.js';
export { extractDraftMoveFacts, extractDraftMoveFactsForChoices } from './extractDraftMoveFacts.js';
export { extractDraftPositionFeatures, extractDraftPositionFeaturesForChoices } from './extractDraftPositionFeatures.js';
export { extractEvalFeatures } from './extractEvalFeatures.js';
export { generateChoiceExplanations } from './generateChoiceExplanations.js';
export { requestExplanationJson } from './llmClient.js';
export { validateExplanations } from './validateExplanations.js';

export type {
  ChoiceEvalFeature,
  ChoiceQuality,
  DraftLineContinuationFeatures,
  DraftProblem,
  DraftProblemChoice,
  DraftMoveFacts,
  DraftPositionFeatures,
  ExplanationChoiceResult,
  ExplanationPlan,
  ExplanationPlanPrimaryReason,
  ExplanationPlanTone,
  GenerateChoiceExplanationsInput,
  GenerateChoiceExplanationsResult,
  LineFactsSummary,
  LlmExplanationResponse,
  SuspectedExplanationPattern,
} from './types.js';
