export type BasePosition = {
  id: string;
  initial_sfen: string;
  tags: string[];
};

export type KifuInsertRow = {
  initial_sfen: string;
  moves: string;
  status: "pending";
  tags: string[] | null;
  base_position_id: string | null;
};

export type SelfPlayGameResult = {
  moves: string[];
  terminationReason: "maxMoves" | "bestmove_none";
};
