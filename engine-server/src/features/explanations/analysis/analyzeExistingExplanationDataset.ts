import { classifyExplanationPatterns } from './classifyExplanationPattern.js';
import { compareChoiceToCorrect } from './compareChoicesToCorrect.js';
import { extractExplanationTextLabels } from './extractExplanationTextLabels.js';
import { extractLineFacts } from './extractLineFacts.js';
import type {
  ExistingChoiceAnalysis,
  ExistingExplanationProblem,
  ExistingProblemAnalysis,
} from './types.js';

function findCorrectChoice(problem: ExistingExplanationProblem) {
  return problem.choices.find((choice) => choice.is_correct)
    ?? problem.choices.find((choice) => choice.choice_id === problem.correct_choice_id)
    ?? problem.choices[0]
    ?? null;
}

export function analyzeExistingExplanationDataset(
  problems: ExistingExplanationProblem[],
): ExistingProblemAnalysis[] {
  return problems.map((problem) => {
    const correctChoice = findCorrectChoice(problem);
    const correctLineFacts = correctChoice ? extractLineFacts(correctChoice.line) : null;
    const correctTextLabels = correctChoice ? extractExplanationTextLabels(correctChoice.explanation) : null;

    const choices: ExistingChoiceAnalysis[] = problem.choices.map((choice) => {
      const textLabels = extractExplanationTextLabels(choice.explanation);
      const lineFacts = extractLineFacts(choice.line);
      const comparisonToCorrect = !choice.is_correct && correctChoice && correctLineFacts && correctTextLabels
        ? compareChoiceToCorrect({
            problem,
            choice,
            correctChoice,
            choiceLineFacts: lineFacts,
            correctLineFacts,
            choiceTextLabels: textLabels,
            correctTextLabels,
          })
        : null;
      const suspectedPatterns = classifyExplanationPatterns({
        isCorrect: choice.is_correct,
        explanation: choice.explanation,
        textLabels,
        lineFacts,
        comparisonToCorrect,
      });

      return {
        problemId: problem.problem_id,
        displayNo: problem.display_no,
        choiceId: choice.choice_id,
        isCorrect: choice.is_correct,
        label: choice.label,
        usi: choice.usi,
        explanation: choice.explanation,
        eval: {
          evalCp: choice.eval_cp,
          evalPercent: choice.eval_percent,
          absGapCp: choice.abs_gap_from_correct_cp,
          absGapPercent: choice.abs_gap_from_correct_percent,
        },
        textLabels,
        lineFacts,
        comparisonToCorrect,
        suspectedPatterns,
      };
    });

    return {
      problemId: problem.problem_id,
      displayNo: problem.display_no,
      correctChoiceId: problem.correct_choice_id,
      rootSfen: problem.root_sfen,
      tags: problem.tags,
      choices,
    };
  });
}
