import type { ExistingExplanationChoice, ExistingExplanationProblem } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function numberOrFallback(value: unknown, fallback: number): number {
  return numberOrNull(value) ?? fallback;
}

function stringOrFallback(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => stringOrFallback(item)).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((item) => stringOrFallback(item)).filter(Boolean);
    } catch {
      return [trimmed];
    }
  }
  return [];
}

function rawDatasetArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    if (raw.length === 1 && isRecord(raw[0]) && Array.isArray(raw[0].jsonb_agg)) {
      return raw[0].jsonb_agg;
    }
    return raw;
  }
  if (isRecord(raw) && Array.isArray(raw.jsonb_agg)) return raw.jsonb_agg;
  if (isRecord(raw) && 'next_move_explanation_dataset' in raw) {
    const dataset = raw.next_move_explanation_dataset;
    if (Array.isArray(dataset)) return dataset;
    if (typeof dataset === 'string') {
      const parsed = JSON.parse(dataset);
      if (Array.isArray(parsed)) return parsed;
      throw new Error('next_move_explanation_dataset string must contain a JSON array');
    }
  }
  throw new Error('input must be an array or { next_move_explanation_dataset: array|string }');
}

function normalizeChoice(raw: unknown, problemId: number, index: number, correctChoiceId: number): ExistingExplanationChoice {
  const row = isRecord(raw) ? raw : {};
  const choiceId = numberOrFallback(row.choice_id, index + 1);
  const explanation = stringOrFallback(row.explanation);
  if (!explanation.trim()) {
    console.warn(`[explanation-analysis] warning problem_id=${problemId} choice_id=${choiceId}: missing explanation`);
  }

  const explicitIsCorrect = typeof row.is_correct === 'boolean' ? row.is_correct : null;
  return {
    choice_id: choiceId,
    is_correct: explicitIsCorrect ?? choiceId === correctChoiceId,
    usi: stringOrFallback(row.usi),
    label: stringOrFallback(row.label),
    eval_cp: numberOrNull(row.eval_cp),
    eval_percent: numberOrNull(row.eval_percent),
    line: stringArray(row.line),
    explanation,
    correct_eval_cp: numberOrNull(row.correct_eval_cp),
    correct_eval_percent: numberOrNull(row.correct_eval_percent),
    gap_from_correct_cp: numberOrNull(row.gap_from_correct_cp),
    abs_gap_from_correct_cp: numberOrNull(row.abs_gap_from_correct_cp),
    gap_from_correct_percent: numberOrNull(row.gap_from_correct_percent),
    abs_gap_from_correct_percent: numberOrNull(row.abs_gap_from_correct_percent),
    explanation_length: numberOrNull(row.explanation_length) ?? explanation.length,
  };
}

function normalizeProblem(raw: unknown, index: number): ExistingExplanationProblem {
  const row = isRecord(raw) ? raw : {};
  const problemId = numberOrFallback(row.problem_id ?? row.id, index + 1);
  const correctChoiceId = numberOrFallback(row.correct_choice_id, 1);
  const rawChoices = Array.isArray(row.choices) ? row.choices : [];
  if (!Array.isArray(row.choices)) {
    console.warn(`[explanation-analysis] warning problem_id=${problemId}: missing choices array`);
  } else if (row.choices.length !== 3) {
    console.warn(`[explanation-analysis] warning problem_id=${problemId}: expected 3 choices, got ${row.choices.length}`);
  }

  return {
    problem_id: problemId,
    display_no: numberOrNull(row.display_no),
    root_sfen: stringOrFallback(row.root_sfen),
    intro_moves_usi: stringArray(row.intro_moves_usi),
    correct_choice_id: correctChoiceId,
    root_eval_cp: numberOrNull(row.root_eval_cp),
    root_eval_percent: numberOrNull(row.root_eval_percent),
    problem_rating: numberOrNull(row.problem_rating),
    tags: stringArray(row.tags),
    choices: rawChoices.map((choice, choiceIndex) => normalizeChoice(choice, problemId, choiceIndex, correctChoiceId)),
  };
}

export function parseExistingExplanationDataset(raw: unknown): ExistingExplanationProblem[] {
  return rawDatasetArray(raw).map(normalizeProblem);
}
