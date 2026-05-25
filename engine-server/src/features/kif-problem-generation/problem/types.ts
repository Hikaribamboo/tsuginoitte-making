import type { StateForLabel } from "./buildStateAtSForLabel";

export type ChoiceOut = {
  choiceId: number;
  usi: string;
  evalCp: number;
  evalPercent: number;
  line: string[];
};

export type ProblemOut = {
  id: number;
  createdAt: string;
  prompt: string;
  rootSfen: string;
  correctChoiceId: number;
  introMovesUsi: string[];
  stateForLabelAtS: StateForLabel;
  rootEvalCp: number;
  rootEvalPercent: number;
  choices: ChoiceOut[];
};
