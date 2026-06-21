import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildExplanationPlan } from './buildExplanationPlan.js';
import type {
  AnalysisSummary,
  ExistingChoiceAnalysis,
  ExistingProblemAnalysis,
  ExplanationPlan,
  ExplanationTextLabels,
  SuspectedExplanationPattern,
} from './types.js';

const TEXT_LABEL_KEYS: Array<keyof Omit<ExplanationTextLabels, 'mentionedMoves'>> = [
  'mentionsAttack',
  'mentionsDefense',
  'mentionsKingSafety',
  'mentionsMaterial',
  'mentionsLineControl',
  'saysIntentWorks',
  'saysIntentFails',
  'saysOpponentCanEscape',
  'saysOpponentCanBlock',
  'saysOpponentCanDefend',
  'saysTooSlow',
  'saysNoThreat',
  'saysOneMovePass',
  'saysMaterialGain',
  'saysMaterialLoss',
  'saysGivesPieces',
  'saysGoodMove',
  'saysBadMove',
  'saysQuestionable',
  'saysNaturalBut',
  'hasAiPrefix',
];

function allChoices(analysis: ExistingProblemAnalysis[]): ExistingChoiceAnalysis[] {
  return analysis.flatMap((problem) => problem.choices);
}

function average(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function median(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const middle = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[middle - 1] + nums[middle]) / 2 : nums[middle];
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function patternCounts(choices: ExistingChoiceAnalysis[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const choice of choices) {
    for (const pattern of choice.suspectedPatterns) increment(counts, pattern);
  }
  return counts;
}

function explanationPlans(analysis: ExistingProblemAnalysis[]): ExplanationPlan[] {
  return allChoices(analysis).map((choice) => buildExplanationPlan(choice));
}

function planPrimaryReasonCounts(plans: ExplanationPlan[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const plan of plans) increment(counts, plan.primaryReason);
  return counts;
}

function planToneCounts(plans: ExplanationPlan[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const plan of plans) increment(counts, plan.tone);
  return counts;
}

function planConfidenceCounts(plans: ExplanationPlan[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const plan of plans) increment(counts, plan.confidence);
  return counts;
}

function textLabelCounts(choices: ExistingChoiceAnalysis[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const choice of choices) {
    for (const key of TEXT_LABEL_KEYS) {
      if (choice.textLabels[key]) increment(counts, key);
    }
  }
  return counts;
}

function patternCooccurrenceCounts(choices: ExistingChoiceAnalysis[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const choice of choices) {
    const patterns = Array.from(new Set(choice.suspectedPatterns.filter((pattern) => pattern !== 'unknown'))).sort();
    for (let i = 0; i < patterns.length; i += 1) {
      for (let j = i + 1; j < patterns.length; j += 1) {
        increment(counts, `${patterns[i]}+${patterns[j]}`);
      }
    }
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function averageGapByPattern(
  choices: ExistingChoiceAnalysis[],
  field: 'absGapCp' | 'absGapPercent',
): Record<string, number | null> {
  const valuesByPattern = new Map<SuspectedExplanationPattern, Array<number | null>>();
  for (const choice of choices) {
    for (const pattern of choice.suspectedPatterns) {
      const current = valuesByPattern.get(pattern) ?? [];
      current.push(choice.eval[field]);
      valuesByPattern.set(pattern, current);
    }
  }
  return Object.fromEntries(
    Array.from(valuesByPattern.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pattern, values]) => [pattern, average(values)]),
  );
}

export function buildAnalysisSummary(analysis: ExistingProblemAnalysis[]): AnalysisSummary {
  const choices = allChoices(analysis);
  const correctChoices = choices.filter((choice) => choice.isCorrect);
  const wrongChoices = choices.filter((choice) => !choice.isCorrect);
  const unknownChoices = choices.filter((choice) => choice.suspectedPatterns.length === 1 && choice.suspectedPatterns[0] === 'unknown');
  const plans = choices.map((choice) => buildExplanationPlan(choice));
  const unknownPlans = plans.filter((plan) => plan.primaryReason === 'unknown');
  const correctPlans = plans.filter((plan) => plan.isCorrect);
  const wrongPlans = plans.filter((plan) => !plan.isCorrect);

  return {
    problemCount: analysis.length,
    choiceCount: choices.length,
    correctChoiceCount: correctChoices.length,
    wrongChoiceCount: wrongChoices.length,
    aiPrefixChoiceCount: choices.filter((choice) => choice.textLabels.hasAiPrefix).length,
    unknownChoiceCount: unknownChoices.length,
    unknownChoiceRate: choices.length === 0 ? 0 : unknownChoices.length / choices.length,
    planUnknownPrimaryReasonCount: unknownPlans.length,
    planUnknownPrimaryReasonRate: plans.length === 0 ? 0 : unknownPlans.length / plans.length,
    unknownCorrectChoiceCount: unknownChoices.filter((choice) => choice.isCorrect).length,
    unknownWrongChoiceCount: unknownChoices.filter((choice) => !choice.isCorrect).length,
    averageExplanationLengthCorrect: average(correctChoices.map((choice) => choice.explanation.length)),
    averageExplanationLengthWrong: average(wrongChoices.map((choice) => choice.explanation.length)),
    medianExplanationLengthCorrect: median(correctChoices.map((choice) => choice.explanation.length)),
    medianExplanationLengthWrong: median(wrongChoices.map((choice) => choice.explanation.length)),
    patternCountsCorrect: patternCounts(correctChoices),
    patternCountsWrong: patternCounts(wrongChoices),
    textLabelCountsCorrect: textLabelCounts(correctChoices),
    textLabelCountsWrong: textLabelCounts(wrongChoices),
    averageAbsGapPercentByPattern: averageGapByPattern(choices, 'absGapPercent'),
    averageAbsGapCpByPattern: averageGapByPattern(choices, 'absGapCp'),
    patternCooccurrenceCountsAll: patternCooccurrenceCounts(choices),
    patternCooccurrenceCountsCorrect: patternCooccurrenceCounts(correctChoices),
    patternCooccurrenceCountsWrong: patternCooccurrenceCounts(wrongChoices),
    planPrimaryReasonCountsAll: planPrimaryReasonCounts(plans),
    planPrimaryReasonCountsCorrect: planPrimaryReasonCounts(correctPlans),
    planPrimaryReasonCountsWrong: planPrimaryReasonCounts(wrongPlans),
    planToneCounts: planToneCounts(plans),
    planConfidenceCounts: planConfidenceCounts(plans),
  };
}

function csvValue(value: unknown): string {
  const text = Array.isArray(value) ? value.join('|') : value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function choiceToCsvRow(choice: ExistingChoiceAnalysis): unknown[] {
  return [
    choice.problemId,
    choice.displayNo,
    choice.choiceId,
    choice.isCorrect,
    choice.label,
    choice.usi,
    choice.eval.evalCp,
    choice.eval.evalPercent,
    choice.eval.absGapCp,
    choice.eval.absGapPercent,
    choice.explanation.length,
    choice.explanation,
    choice.suspectedPatterns,
    choice.textLabels.mentionedMoves,
    choice.textLabels.mentionsAttack,
    choice.textLabels.mentionsDefense,
    choice.textLabels.mentionsKingSafety,
    choice.textLabels.mentionsMaterial,
    choice.textLabels.mentionsLineControl,
    choice.textLabels.saysIntentFails,
    choice.textLabels.saysOpponentCanEscape,
    choice.textLabels.saysOpponentCanBlock,
    choice.textLabels.saysTooSlow,
    choice.textLabels.saysNoThreat,
    choice.textLabels.saysMaterialLoss,
    choice.textLabels.saysGivesPieces,
    choice.lineFacts.firstResponse,
    choice.lineFacts.hasDrop,
    choice.lineFacts.hasPromotion,
    choice.lineFacts.dropPieces,
    choice.lineFacts.promotedMoves,
    choice.comparisonToCorrect?.sharedLineMoves ?? [],
  ];
}

function buildChoiceCsv(analysis: ExistingProblemAnalysis[]): string {
  const headers = [
    'problemId',
    'displayNo',
    'choiceId',
    'isCorrect',
    'label',
    'usi',
    'evalCp',
    'evalPercent',
    'absGapCp',
    'absGapPercent',
    'explanationLength',
    'explanation',
    'suspectedPatterns',
    'mentionedMoves',
    'mentionsAttack',
    'mentionsDefense',
    'mentionsKingSafety',
    'mentionsMaterial',
    'mentionsLineControl',
    'saysIntentFails',
    'saysOpponentCanEscape',
    'saysOpponentCanBlock',
    'saysTooSlow',
    'saysNoThreat',
    'saysMaterialLoss',
    'saysGivesPieces',
    'firstResponse',
    'hasDrop',
    'hasPromotion',
    'dropPieces',
    'promotedMoves',
    'sharedLineMoves',
  ];
  const rows = allChoices(analysis).map((choice) => choiceToCsvRow(choice).map(csvValue).join(','));
  return [headers.join(','), ...rows].join('\n') + '\n';
}

function buildUnknownExamplesCsv(analysis: ExistingProblemAnalysis[]): string {
  const headers = [
    'problemId',
    'displayNo',
    'choiceId',
    'isCorrect',
    'label',
    'usi',
    'explanationLength',
    'evalPercent',
    'absGapCp',
    'absGapPercent',
    'hasMoveMention',
    'rawTextFlags',
    'explanation',
    'mentionedMoves',
    'firstResponse',
    'lineFirstSixMoves',
  ];
  const rows = allChoices(analysis)
    .filter((choice) => choice.suspectedPatterns.length === 1 && choice.suspectedPatterns[0] === 'unknown')
    .slice(0, 100)
    .map((choice) => [
      choice.problemId,
      choice.displayNo,
      choice.choiceId,
      choice.isCorrect,
      choice.label,
      choice.usi,
      choice.explanation.length,
      choice.eval.evalPercent,
      choice.eval.absGapCp,
      choice.eval.absGapPercent,
      choice.textLabels.mentionedMoves.length > 0,
      rawTextFlags(choice.explanation),
      choice.explanation,
      choice.textLabels.mentionedMoves,
      choice.lineFacts.firstResponse,
      choice.lineFacts.firstSixMoves,
    ].map(csvValue).join(','));
  return [headers.join(','), ...rows].join('\n') + '\n';
}

function rawTextFlags(explanation: string): string[] {
  const terms = [
    '互角',
    '難解',
    '少し悪い',
    '少し良い',
    '有利',
    '優勢',
    '勝勢',
    '耐える',
    '耐えられる',
    '忙しい',
    '厳しい',
    '痛い',
    '薄い',
    '厚い',
    '働く',
    '働き',
    '活躍',
    '重い',
    '軽い',
  ];
  return terms.filter((term) => explanation.includes(term));
}

function textLabelsSummary(choice: ExistingChoiceAnalysis): string[] {
  return TEXT_LABEL_KEYS.filter((key) => choice.textLabels[key]);
}

function lineFactsSummary(choice: ExistingChoiceAnalysis): string[] {
  return [
    `firstResponse=${choice.lineFacts.firstResponse ?? ''}`,
    `hasDrop=${choice.lineFacts.hasDrop}`,
    `hasPromotion=${choice.lineFacts.hasPromotion}`,
    `dropPieces=${choice.lineFacts.dropPieces.join('|')}`,
  ];
}

function buildPatternExamplesCsv(analysis: ExistingProblemAnalysis[]): string {
  const headers = [
    'pattern',
    'problemId',
    'displayNo',
    'choiceId',
    'isCorrect',
    'label',
    'absGapPercent',
    'explanation',
    'firstResponse',
    'allPatterns',
    'textLabelsSummary',
    'lineFactsSummary',
  ];
  const counts = new Map<string, number>();
  const rows: string[] = [];
  for (const choice of allChoices(analysis)) {
    for (const pattern of choice.suspectedPatterns) {
      const count = counts.get(pattern) ?? 0;
      if (count >= 20) continue;
      counts.set(pattern, count + 1);
      rows.push([
        pattern,
        choice.problemId,
        choice.displayNo,
        choice.choiceId,
        choice.isCorrect,
        choice.label,
        choice.eval.absGapPercent,
        choice.explanation,
        choice.lineFacts.firstResponse,
        choice.suspectedPatterns,
        textLabelsSummary(choice),
        lineFactsSummary(choice),
      ].map(csvValue).join(','));
    }
  }
  return [headers.join(','), ...rows].join('\n') + '\n';
}

function buildNaturalButWorseExamplesCsv(analysis: ExistingProblemAnalysis[]): string {
  const headers = [
    'problemId',
    'displayNo',
    'choiceId',
    'isCorrect',
    'label',
    'usi',
    'absGapCp',
    'absGapPercent',
    'explanation',
    'suspectedPatterns',
    'mentionedMoves',
    'firstResponse',
    'lineFirstSixMoves',
  ];
  const rows = allChoices(analysis)
    .filter((choice) => choice.suspectedPatterns.includes('natural_but_worse'))
    .slice(0, 200)
    .map((choice) => [
      choice.problemId,
      choice.displayNo,
      choice.choiceId,
      choice.isCorrect,
      choice.label,
      choice.usi,
      choice.eval.absGapCp,
      choice.eval.absGapPercent,
      choice.explanation,
      choice.suspectedPatterns,
      choice.textLabels.mentionedMoves,
      choice.lineFacts.firstResponse,
      choice.lineFacts.firstSixMoves,
    ].map(csvValue).join(','));
  return [headers.join(','), ...rows].join('\n') + '\n';
}

function buildExplanationPlansCsv(plans: ExplanationPlan[], choices: ExistingChoiceAnalysis[]): string {
  const headers = [
    'problemId',
    'displayNo',
    'choiceId',
    'isCorrect',
    'label',
    'usi',
    'primaryReason',
    'secondaryReasons',
    'tone',
    'confidence',
    'reasonDetail',
    'suggestedStructure',
    'allowedPhrases',
    'avoidPhrases',
    'suspectedPatterns',
    'absGapCp',
    'absGapPercent',
    'firstResponse',
    'explanation',
  ];
  const choicesByKey = new Map(choices.map((choice) => [`${choice.problemId}:${choice.choiceId}`, choice]));
  const rows = plans.map((plan) => {
    const choice = choicesByKey.get(`${plan.problemId}:${plan.choiceId}`);
    return [
      plan.problemId,
      plan.displayNo,
      plan.choiceId,
      plan.isCorrect,
      plan.label,
      plan.usi,
      plan.primaryReason,
      plan.secondaryReasons,
      plan.tone,
      plan.confidence,
      plan.reasonDetail,
      plan.suggestedStructure,
      plan.allowedPhrases,
      plan.avoidPhrases,
      plan.sourceSignals.suspectedPatterns,
      plan.sourceSignals.absGapCp,
      plan.sourceSignals.absGapPercent,
      plan.sourceSignals.firstResponse,
      choice?.explanation ?? '',
    ].map(csvValue).join(',');
  });
  return [headers.join(','), ...rows].join('\n') + '\n';
}

export async function writeAnalysisReports(
  analysis: ExistingProblemAnalysis[],
  outDir: string,
): Promise<AnalysisSummary> {
  const summary = buildAnalysisSummary(analysis);
  const plans = explanationPlans(analysis);
  const choices = allChoices(analysis);
  const debugDir = path.join(outDir, 'debug');
  await mkdir(outDir, { recursive: true });
  await mkdir(debugDir, { recursive: true });
  await Promise.all([
    rm(path.join(outDir, 'analysis-details.json'), { force: true }),
    rm(path.join(outDir, 'choice-analysis.csv'), { force: true }),
    rm(path.join(outDir, 'unknown-examples.csv'), { force: true }),
    rm(path.join(outDir, 'pattern-examples.csv'), { force: true }),
    rm(path.join(outDir, 'natural-but-worse-examples.csv'), { force: true }),
  ]);
  await Promise.all([
    writeFile(path.join(outDir, 'analysis-summary.json'), JSON.stringify(summary, null, 2), 'utf8'),
    writeFile(path.join(outDir, 'explanation-plans.json'), JSON.stringify(plans, null, 2), 'utf8'),
    writeFile(path.join(outDir, 'explanation-plans.csv'), buildExplanationPlansCsv(plans, choices), 'utf8'),
    writeFile(path.join(debugDir, 'analysis-details.json'), JSON.stringify(analysis, null, 2), 'utf8'),
    writeFile(path.join(debugDir, 'choice-analysis.csv'), buildChoiceCsv(analysis), 'utf8'),
    writeFile(path.join(debugDir, 'unknown-examples.csv'), buildUnknownExamplesCsv(analysis), 'utf8'),
    writeFile(path.join(debugDir, 'pattern-examples.csv'), buildPatternExamplesCsv(analysis), 'utf8'),
    writeFile(path.join(debugDir, 'natural-but-worse-examples.csv'), buildNaturalButWorseExamplesCsv(analysis), 'utf8'),
  ]);
  return summary;
}
