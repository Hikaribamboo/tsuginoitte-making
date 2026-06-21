import type { LlmExplanationResponse } from './types.js';
import type { ExplanationValidationIssue } from './validateExplanations.js';

export type ExplanationStyleRepair = {
  choiceId: number;
  before: string;
  after: string;
  reason: string;
};

export type ExplanationStyleRepairOutput = LlmExplanationResponse & {
  repairedChoiceIds: number[];
  repairs: ExplanationStyleRepair[];
};

type Replacement = {
  pattern: RegExp;
  replacement: string;
  reason: string;
};

const REPLACEMENTS: Replacement[] = [
  {
    pattern: /攻めが続く可能性が高い/g,
    replacement: '攻めが続く',
    reason: 'replace vague possibility phrase',
  },
  {
    pattern: /攻めが続く可能性があります/g,
    replacement: '攻めが続く',
    reason: 'replace vague possibility phrase',
  },
  {
    pattern: /可能性が高い/g,
    replacement: '見込みがある',
    reason: 'replace vague possibility phrase',
  },
  {
    pattern: /可能性があります/g,
    replacement: '見込みがある',
    reason: 'replace vague possibility phrase',
  },
  {
    pattern: /可能性/g,
    replacement: '見込み',
    reason: 'replace vague possibility phrase',
  },
  {
    pattern: /正解手ほど効果的ではない/g,
    replacement: '正解手ほど攻めが続かない',
    reason: 'replace vague effect phrase',
  },
  {
    pattern: /効果が薄い/g,
    replacement: '攻め味が弱い',
    reason: 'replace vague effect phrase',
  },
  {
    pattern: /効果的ではない/g,
    replacement: '攻め味が弱い',
    reason: 'replace vague effect phrase',
  },
  {
    pattern: /効果的/g,
    replacement: '厳しい',
    reason: 'replace vague effect phrase',
  },
  {
    pattern: /効果/g,
    replacement: '攻め味',
    reason: 'replace vague effect phrase',
  },
  {
    pattern: /相手に圧力をかける/g,
    replacement: '攻めが続く',
    reason: 'replace vague pressure phrase',
  },
  {
    pattern: /圧力をかける/g,
    replacement: '攻めが続く',
    reason: 'replace vague pressure phrase',
  },
  {
    pattern: /圧力/g,
    replacement: '攻め',
    reason: 'replace vague pressure phrase',
  },
];

function cleanText(text: string): string {
  return text
    .replace(/攻めが続く。攻めが続く。/g, '攻めが続く。')
    .replace(/。。+/g, '。')
    .replace(/、。/g, '。')
    .replace(/，。/g, '。')
    .replace(/\s+/g, ' ')
    .trim();
}

function repairText(text: string): { text: string; reasons: string[] } {
  let current = text;
  const reasons: string[] = [];

  for (const replacement of REPLACEMENTS) {
    replacement.pattern.lastIndex = 0;
    if (!replacement.pattern.test(current)) continue;
    replacement.pattern.lastIndex = 0;
    current = current.replace(replacement.pattern, replacement.replacement);
    reasons.push(replacement.reason);
  }

  return {
    text: cleanText(current),
    reasons: [...new Set(reasons)],
  };
}

export function repairExplanationStyle(
  output: LlmExplanationResponse,
  issues: ExplanationValidationIssue[],
): ExplanationStyleRepairOutput {
  const targetChoiceIds = new Set(
    issues
      .filter((issue) => issue.code === 'bad_phrase' && issue.severity === 'soft' && typeof issue.choiceId === 'number')
      .map((issue) => issue.choiceId as number),
  );
  const repairs: ExplanationStyleRepair[] = [];

  const choices = output.choices.map((choice) => {
    if (!targetChoiceIds.has(choice.choice_id)) return choice;

    const repaired = repairText(choice.explanation);
    if (repaired.text === choice.explanation || repaired.reasons.length === 0) {
      return choice;
    }

    repairs.push({
      choiceId: choice.choice_id,
      before: choice.explanation,
      after: repaired.text,
      reason: repaired.reasons.join(', '),
    });

    return {
      ...choice,
      explanation: repaired.text,
    };
  });

  return {
    repairedChoiceIds: repairs.map((repair) => repair.choiceId),
    repairs,
    choices,
  };
}
