export type MakingMode = 'next_move' | 'joseki' | 'new_mode';

export type MakingSourceType =
  | 'manual'
  | 'pasted_kifu'
  | 'pasted_sfen'
  | 'image'
  | 'image_position_creator'
  | 'kif_problem_generation'
  | 'engine_generated_next_move'
  | 'db_kifu'
  | 'local_book'
  | 'legacy_workspace'
  | 'legacy_review_next_move'
  | 'imported_legacy_workspace'
  | 'production_edit';

export type MakingWorkspaceStatus = 'draft' | 'validating' | 'needs_fix' | 'ready' | 'published' | 'archived';
export type MakingDraftProblemStatus = MakingWorkspaceStatus;
export type MakingValidationStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type MakingIssueSeverity = 'error' | 'warning' | 'info';
export type MakingPublishTargetEnv = 'dev' | 'prod';
export type MakingPublishAction = 'create' | 'update';
export type MakingPublishStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface MakingDraftProblem {
  id: number;
  workspace_id: string | null;
  mode: MakingMode;
  status: MakingDraftProblemStatus;
  prompt: string;
  root_sfen: string;
  intro_moves_usi: string[];
  correct_choice_id: 1 | 2 | 3;
  root_eval_cp: number | null;
  root_eval_percent: number | null;
  problem_rating: number | null;
  problem_rating_games: number;
  manual_difficulty_tier: number | null;
  display_no: number | null;
  tags: string[];
  review_comment: string | null;
  production_problem_id: number | null;
  source_type: MakingSourceType | string | null;
  source_ref: string | null;
  source_payload: Record<string, unknown>;
  source_snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MakingDraftChoice {
  id: number;
  draft_problem_id: number;
  choice_id: 1 | 2 | 3;
  usi: string;
  label: string;
  eval_cp: number | null;
  eval_percent: number | null;
  line: string[];
  explanation: string;
  source_snapshot?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MakingValidationRun {
  id: number;
  workspace_id: string;
  draft_problem_id: number;
  rule_set_version: string;
  status: MakingValidationStatus;
  issue_count: number;
  error_count: number;
  warning_count: number;
  summary_json: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface MakingValidationIssue {
  id: number;
  validation_run_id: number;
  workspace_id: string;
  draft_problem_id: number;
  severity: MakingIssueSeverity;
  rule_code: string;
  message: string;
  field_path: string | null;
  fix_hint: string | null;
  detail_json: Record<string, unknown>;
  resolved_at: string | null;
  ignored_at: string | null;
  created_at: string;
}

export interface MakingPublishJob {
  id: number;
  workspace_id: string;
  draft_problem_id: number;
  target_env: MakingPublishTargetEnv;
  action: MakingPublishAction;
  status: MakingPublishStatus;
  target_problem_id: number | null;
  published_problem_id: number | null;
  payload_snapshot: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface MakingDraftProblemFilters {
  mode?: MakingMode;
  status?: MakingDraftProblemStatus;
  sourceType?: MakingSourceType;
  limit?: number;
  offset?: number;
}

export interface CreateMakingDraftProblemInput {
  workspace_id?: string | null;
  mode: MakingMode;
  status?: MakingDraftProblemStatus;
  prompt: string;
  root_sfen: string;
  intro_moves_usi?: string[];
  correct_choice_id: 1 | 2 | 3;
  root_eval_cp?: number | null;
  root_eval_percent?: number | null;
  problem_rating?: number | null;
  problem_rating_games?: number;
  manual_difficulty_tier?: number | null;
  display_no?: number | null;
  tags?: string[];
  review_comment?: string | null;
  source_type?: MakingSourceType | string | null;
  source_ref?: string | null;
  source_payload?: Record<string, unknown>;
  source_snapshot?: Record<string, unknown>;
}

export type UpdateMakingDraftProblemInput = Partial<Omit<
  MakingDraftProblem,
  'id' | 'workspace_id' | 'created_at' | 'updated_at' | 'production_problem_id'
>>;

export interface UpsertMakingDraftChoiceInput {
  choice_id: 1 | 2 | 3;
  usi: string;
  label: string;
  eval_cp?: number | null;
  eval_percent?: number | null;
  line?: string[];
  explanation?: string;
}

export interface CreateMakingDraftChoiceInput extends UpsertMakingDraftChoiceInput {}
