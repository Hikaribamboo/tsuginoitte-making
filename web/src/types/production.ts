export type ProductionProblemMode = 'next_move' | 'joseki' | 'new_mode';

export interface ProductionProblem {
  problemId: number;
  mode: ProductionProblemMode;
  displayNo: number | null;
  status: string | null;
  prompt: string;
  rootSfen: string;
  rootEvalCp: number | null;
  rootEvalPercent: number | null;
  problemRating: number | null;
  problemRatingGames: number | null;
  tags: string[];
  correctChoiceId: number;
  introMovesUsi: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductionChoice {
  mode: ProductionProblemMode;
  problem_id: number;
  choice_id: number;
  usi: string;
  label: string;
  explanation: string | null;
  line: string[];
  eval_cp: number | null;
  eval_percent: number | null;
}

export interface ProductionProblemDetail extends ProductionProblem {
  choices: ProductionChoice[];
}

export interface ProductionProblemFilters {
  mode?: ProductionProblemMode | 'all';
  status?: string | 'all';
  query?: string;
  limit?: number;
}

export interface UpdateProductionProblemInput {
  prompt: string;
  rootSfen: string;
  correctChoiceId: number;
  introMovesUsi: string[];
  rootEvalCp: number | null;
  rootEvalPercent: number | null;
  problemRating: number | null;
  problemRatingGames: number | null;
  tags: string[];
}
