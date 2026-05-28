export type BasePosition = {
  id: string;
  initial_sfen: string;
  tags: string[];
};

export type KifuInsertRow = {
  source_type: "self_play";
  source_ref: string | null;
  initial_sfen: string;
  moves: string;
  status: "pending";
  tags: string[] | null;
  base_position_id: string | null;
  source_payload: Record<string, unknown>;
};

export type SelfPlayGameResult = {
  moves: string[];
  terminationReason: "maxMoves" | "bestmove_none";
};
