// src/sql/buildSql.ts
import { createChoiceLabel } from "../label/createChoiceLabel";
import type { StateForLabel } from "../problem/buildStateAtSForLabel";

export type ChoiceOut = {
  choiceId: number;
  usi: string;
  evalCp: number;
  evalPercent: number;
  line: string[]; // 必ず8
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

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

function toPgTextArray(items: string[]): string {
  const quoted = items.map((x) => `'${sqlEscape(x)}'`).join(",");
  return `ARRAY[${quoted}]`;
}

export function buildInsertSql(problem: ProblemOut): string {
  const {
    id,
    createdAt,
    prompt,
    rootSfen,
    correctChoiceId,
    introMovesUsi,
    stateForLabelAtS,
    rootEvalCp,
    rootEvalPercent,
    choices,
  } = problem;

  if (choices.length !== 3) {
    throw new Error(`buildInsertSql: choices must be 3, got ${choices.length}`);
  }

  const problemSql =
    `INSERT INTO "public"."next_move_problems" ` +
    `("id","created_at","prompt","root_sfen","correct_choice_id","intro_moves_usi","root_eval_cp","root_eval_percent") VALUES ` +
    `('${id}','${sqlEscape(createdAt)}','${sqlEscape(prompt)}','${sqlEscape(rootSfen)}','${correctChoiceId}',${toPgTextArray(
      introMovesUsi
    )},'${rootEvalCp}','${rootEvalPercent}');`;

  const rows = choices
    .slice()
    .sort((a, b) => a.choiceId - b.choiceId)
    .map((c) => {
      try {
        const label = createChoiceLabel({ state: stateForLabelAtS, usi: c.usi });

        const lineArr = toPgTextArray(c.line);

        return `('${id}','${c.choiceId}','${sqlEscape(c.usi)}','${sqlEscape(label)}','${c.evalCp}','${c.evalPercent}','',${lineArr})`;
      } catch (e) {
        console.error("[buildInsertSql] createChoiceLabel failed", {
          problemId: id,
          choiceId: c.choiceId,
          usi: c.usi,
          rootSfen,
          introMovesUsi,
          turn: stateForLabelAtS.position.turn,
          lastMoveTo: stateForLabelAtS.lastMoveTo,
        });
        throw e;
      }
    })
    .join(",");

  const choicesSql =
    `INSERT INTO "public"."next_move_choices" ` +
    `("problem_id","choice_id","usi","label","eval_cp","eval_percent","explanation","line") VALUES ` +
    `${rows};`;

  return `${problemSql}\n\n${choicesSql}`;
}