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
  issueCodes?: Array<ExplanationValidationIssue['code']>;
};

const REPLACEMENTS: Replacement[] = [
  {
    pattern: /^[▲△]?[１-９一二三四五六七八九0-9]+[一二三四五六七八九]?[歩香桂銀金角飛玉王と馬龍竜成打]+(?:は|では|で|には|なら)[、，]?/g,
    replacement: '',
    reason: 'remove candidate label subject',
    issueCodes: ['candidate_label_overused'],
  },
  {
    pattern: /[歩香桂銀金角飛玉王と馬龍竜成銀成桂成香]+を[１-９][一二三四五六七八九]に(?:動かす|打つ)と[、，]?/g,
    replacement: '',
    reason: 'remove candidate move subject',
    issueCodes: ['candidate_label_overused', 'candidate_move_as_subject'],
  },
  {
    pattern: /[１-９][一二三四五六七八九]に[歩香桂銀金角飛玉王と馬龍竜成銀成桂成香]+を打つと[、，]?/g,
    replacement: '',
    reason: 'remove candidate move subject',
    issueCodes: ['candidate_label_overused', 'candidate_move_as_subject'],
  },
  {
    pattern: /歩を[１-９][一二三四五六七八九]に突くのは遅い/g,
    replacement: '手が遅い',
    reason: 'remove candidate move subject',
    issueCodes: ['candidate_label_overused', 'candidate_move_as_subject'],
  },
  {
    pattern: /[１-９][一二三四五六七八九]に歩を突くのは遅い/g,
    replacement: '手が遅い',
    reason: 'remove candidate move subject',
    issueCodes: ['candidate_label_overused', 'candidate_move_as_subject'],
  },
  {
    pattern: /歩を[１-９][一二三四五六七八九]に突くのは/g,
    replacement: '',
    reason: 'remove candidate move subject',
    issueCodes: ['candidate_label_overused', 'candidate_move_as_subject'],
  },
  {
    pattern: /[１-９][一二三四五六七八九]に歩を突くのは/g,
    replacement: '',
    reason: 'remove candidate move subject',
    issueCodes: ['candidate_label_overused', 'candidate_move_as_subject'],
  },
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
    replacement: '',
    reason: 'replace vague possibility phrase',
  },
  {
    pattern: /可能性があります/g,
    replacement: '',
    reason: 'replace vague possibility phrase',
  },
  {
    pattern: /可能性/g,
    replacement: '',
    reason: 'replace vague possibility phrase',
  },
  {
    pattern: /攻め筋が消える見込みがある/g,
    replacement: '後続の攻めが弱い',
    reason: 'replace overstated attack disappearance phrase',
  },
  {
    pattern: /攻め筋が消える/g,
    replacement: '後続の攻めが弱い',
    reason: 'replace overstated attack disappearance phrase',
  },
  {
    pattern: /攻め筋が消えてしまう/g,
    replacement: '後続の攻めが弱い',
    reason: 'replace overstated attack disappearance phrase',
  },
  {
    pattern: /攻め筋がなくなる/g,
    replacement: '後続の攻めが弱い',
    reason: 'replace overstated attack disappearance phrase',
  },
  {
    pattern: /攻めが消える/g,
    replacement: '後続の攻めが弱い',
    reason: 'replace overstated attack disappearance phrase',
  },
  {
    pattern: /攻めがなくなる/g,
    replacement: '後続の攻めが弱い',
    reason: 'replace overstated attack disappearance phrase',
  },
  {
    pattern: /大きな得ではない/g,
    replacement: '大きな当たりではない',
    reason: 'replace unsupported large gain comparison',
  },
  {
    pattern: /得ではない/g,
    replacement: '当たりではない',
    reason: 'replace unsupported large gain comparison',
  },
  {
    pattern: /見込みがある/g,
    replacement: '',
    reason: 'remove vague expectation phrase',
  },
  {
    pattern: /見込み/g,
    replacement: '',
    reason: 'remove vague expectation phrase',
  },
  {
    pattern: /有効な手/g,
    replacement: '手',
    reason: 'replace vague useful-move phrase',
  },
  {
    pattern: /有利/g,
    replacement: '攻めが続く',
    reason: 'replace strong advantage claim',
  },
  {
    pattern: /優勢/g,
    replacement: '攻めが続く',
    reason: 'replace strong advantage claim',
  },
  {
    pattern: /形勢/g,
    replacement: '局面',
    reason: 'replace strong position claim',
  },
  {
    pattern: /おすすめ/g,
    replacement: '',
    reason: 'remove recommendation phrase',
  },
  {
    pattern: /お勧め/g,
    replacement: '',
    reason: 'remove recommendation phrase',
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
  {
    pattern: /([^。]{1,24}に当たる)好手/g,
    replacement: '$1',
    reason: 'preserve concrete attack phrase',
  },
  {
    pattern: /攻めが続く好手/g,
    replacement: '攻めが続く',
    reason: 'remove good-move wording',
  },
  {
    pattern: /好手/g,
    replacement: '',
    reason: 'remove good-move wording',
  },
];

function cleanText(text: string): string {
  return text
    .replace(/^、/g, '')
    .replace(/^，/g, '')
    .replace(/攻めが続く。攻めが続く。/g, '攻めが続く。')
    .replace(/後続の攻めが弱い。後続の攻めが弱い。/g, '後続の攻めが弱い。')
    .replace(/後続の攻めが弱いがある/g, '後続の攻めが弱い')
    .replace(/攻めが弱いがある/g, '攻めが弱い')
    .replace(/，。/g, '。')
    .replace(/、。/g, '。')
    .replace(/が。/g, '。')
    .replace(/。。+/g, '。')
    .replace(/、。/g, '。')
    .replace(/，。/g, '。')
    .replace(/\s+/g, ' ')
    .trim();
}

function repairText(text: string, issueCodes: Set<string>): { text: string; reasons: string[] } {
  let current = text;
  const reasons: string[] = [];

  for (const replacement of REPLACEMENTS) {
    if (
      replacement.issueCodes &&
      !replacement.issueCodes.some((issueCode) => issueCodes.has(issueCode))
    ) continue;
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
  const issueCodesByChoiceId = new Map<number, Set<string>>();
  for (const issue of issues) {
    if (issue.severity !== 'soft' || typeof issue.choiceId !== 'number') continue;
    const bucket = issueCodesByChoiceId.get(issue.choiceId) ?? new Set<string>();
    bucket.add(issue.code);
    issueCodesByChoiceId.set(issue.choiceId, bucket);
  }
  const targetChoiceIds = new Set(
    issues
      .filter((issue) =>
        issue.severity === 'soft' &&
        typeof issue.choiceId === 'number' &&
        (
          issue.code === 'bad_phrase' ||
          issue.code === 'candidate_label_overused' ||
          issue.code === 'candidate_move_as_subject' ||
          issue.code === 'wrong_choice_called_good_move'
        )
      )
      .map((issue) => issue.choiceId as number),
  );
  const repairs: ExplanationStyleRepair[] = [];

  const choices = output.choices.map((choice) => {
    if (!targetChoiceIds.has(choice.choice_id)) return choice;

    const repaired = repairText(choice.explanation, issueCodesByChoiceId.get(choice.choice_id) ?? new Set());
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
