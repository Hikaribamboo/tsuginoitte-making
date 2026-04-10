// ---- Problem & Choice types matching Supabase schema ----

export interface Problem {
  id?: number;
  created_at?: string;
  prompt: string;
  root_sfen: string;
  correct_choice_id: number;
  intro_moves_usi: string[];
  source_run_id: string | null;
  root_eval_cp: number | null;
  root_eval_percent: number | null;
  problem_rating: number | null;
  problem_rating_games: number | null;
  display_no: number | null;
  tags: string[] | null;
}

export interface Choice {
  problem_id?: number;
  choice_id: number; // 1, 2, or 3
  usi: string;
  label: string;
  explanation: string;
  line: string[];
  eval_cp: number | null;
  eval_percent: number | null;
}

// ---- Favorite position ----

export interface FavoritePosition {
  id?: number;
  created_at?: string;
  updated_at?: string;
  name: string;
  root_sfen: string;
  memo: string | null;
  tags: string[] | null;
  last_move?: string | null;
}

// ---- Draft for problem creation form ----

export interface ChoiceDraft {
  slotLabel: string; // "correct" | "incorrect1" | "incorrect2"
  usi: string;
  label: string;
  explanation: string;
  line: string[];
  eval_cp: number | null;
  eval_percent: number | null;
}

export interface ProblemDraft {
  prompt: string;
  root_sfen: string;
  correct_slot: 'correct' | 'incorrect1' | 'incorrect2';
  intro_moves_usi: string[];
  display_no: number | null;
  tags: string[];
  root_eval_cp: number | null;
  root_eval_percent: number | null;
  choices: {
    correct: ChoiceDraft;
    incorrect1: ChoiceDraft;
    incorrect2: ChoiceDraft;
  };
}
