import type { ProductionChoice, ProductionProblem, ProductionProblemDetail } from '../types/production';

export type ProductionValidationSeverity = 'error' | 'warning' | 'info';
export type ProductionValidationStatus = 'ok' | 'warning' | 'error';

export interface ProductionValidationIssue {
  severity: ProductionValidationSeverity;
  rule_code: string;
  message: string;
  field_path: string;
}

export interface ProductionValidationSummary {
  issues: ProductionValidationIssue[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  status: ProductionValidationStatus;
}

type ProductionLike = Pick<
  ProductionProblem,
  'displayNo' | 'status' | 'prompt' | 'rootSfen' | 'rootEvalPercent' | 'correctChoiceId'
>;

function isEmptyString(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

function addIssue(
  issues: ProductionValidationIssue[],
  severity: ProductionValidationSeverity,
  rule_code: string,
  field_path: string,
  message: string,
) {
  issues.push({
    severity,
    rule_code,
    field_path,
    message,
  });
}

export function validateProductionProblem(
  problem: ProductionLike,
  choices: ProductionChoice[],
): ProductionValidationIssue[] {
  const issues: ProductionValidationIssue[] = [];

  if (choices.length !== 3) {
    addIssue(
      issues,
      'error',
      'choices_count_not_three',
      'choices',
      `choices が 3 件ではありません (${choices.length} 件)`,
    );
  }

  if (isEmptyString(problem.prompt)) {
    addIssue(issues, 'error', 'prompt_empty', 'prompt', 'prompt が空です');
  }

  if (isEmptyString(problem.rootSfen)) {
    addIssue(issues, 'error', 'root_sfen_empty', 'root_sfen', 'root_sfen が空です');
  }

  if (problem.rootEvalPercent == null) {
    addIssue(
      issues,
      'warning',
      'root_eval_percent_null',
      'root_eval_percent',
      'root_eval_percent が null です',
    );
  }

  if ((problem.status ?? '').toLowerCase() === 'active' && problem.displayNo == null) {
    addIssue(
      issues,
      'warning',
      'active_display_no_null',
      'display_no',
      'active なのに display_no が null です',
    );
  }

  const correctChoice = choices.find((choice) => choice.choice_id === problem.correctChoiceId);
  if (!correctChoice) {
    addIssue(
      issues,
      'error',
      'correct_choice_missing',
      'correct_choice_id',
      'correct_choice_id に対応する choice がありません',
    );
  }

  for (const choice of choices) {
    const base = `choices.${choice.choice_id}`;

    if (isEmptyString(choice.usi)) {
      addIssue(
        issues,
        'error',
        'choice_usi_empty',
        `${base}.usi`,
        `choice ${choice.choice_id} の usi が空です`,
      );
    }

    if (isEmptyString(choice.label)) {
      addIssue(
        issues,
        'error',
        'choice_label_empty',
        `${base}.label`,
        `choice ${choice.choice_id} の label が空です`,
      );
    }

    if (isEmptyString(choice.explanation)) {
      addIssue(
        issues,
        'warning',
        'choice_explanation_empty',
        `${base}.explanation`,
        `choice ${choice.choice_id} の explanation が空です`,
      );
    }

    if (!Array.isArray(choice.line) || choice.line.filter((item) => typeof item === 'string' && item.trim().length > 0).length === 0) {
      addIssue(
        issues,
        'warning',
        'choice_line_empty',
        `${base}.line`,
        `choice ${choice.choice_id} の line が空です`,
      );
    }

    if (choice.eval_percent == null) {
      addIssue(
        issues,
        'warning',
        'choice_eval_percent_null',
        `${base}.eval_percent`,
        `choice ${choice.choice_id} の eval_percent が null です`,
      );
    }
  }

  return issues;
}

export function summarizeProductionIssues(issues: ProductionValidationIssue[]): ProductionValidationSummary {
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const infoCount = issues.filter((issue) => issue.severity === 'info').length;
  const status: ProductionValidationStatus = errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'ok';

  return {
    issues,
    errorCount,
    warningCount,
    infoCount,
    status,
  };
}

export function validateProductionDetail(detail: ProductionProblemDetail): ProductionValidationIssue[] {
  return validateProductionProblem(detail, detail.choices);
}

export function getProductionValidationSummary(
  problem: ProductionLike,
  choices: ProductionChoice[],
): ProductionValidationSummary {
  return summarizeProductionIssues(validateProductionProblem(problem, choices));
}

export function getProductionDetailValidationSummary(
  detail: ProductionProblemDetail,
): ProductionValidationSummary {
  return getProductionValidationSummary(detail, detail.choices);
}
