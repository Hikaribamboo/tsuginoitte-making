import type {
  ExistingChoiceAnalysis,
  ExplanationPlan,
  ExplanationPlanPrimaryReason,
  ExplanationPlanTone,
  ExplanationTextLabels,
  SuspectedExplanationPattern,
} from './types.js';

const AVOID_PHRASES = ['詰み', '必至', '詰めろ', '勝ち', '絶対', '唯一', '必ず'];

const REASON_DETAILS: Record<ExplanationPlanPrimaryReason, string> = {
  correct_attack_continues: 'この手によって攻めの狙いが続く，または相手が無視できない狙いが生まれる',
  correct_defense_works: '受けや玉の安全を確保しながら，局面を良くできる',
  correct_material_gain: '駒得や交換の得を主張できる',
  correct_forcing_sequence: '相手の応手が限られており，読み筋上こちらの狙いが通りやすい',
  correct_tactical_gain: '戦術的な狙いにより，駒得や大きな攻めの成果が見込める',

  wrong_attack_disappears: '狙いはあるが，相手の応手で攻め筋や攻め味が消える',
  wrong_opponent_escapes: '狙いはあるが，相手に逃げられる，またはかわされて終わる',
  wrong_opponent_blocks_line: '角道・利き・攻め筋を相手に止められ，狙いが成立しない',
  wrong_no_threat: '相手にとって厳しい狙いがなく，手として主張が弱い',
  wrong_too_slow: '狙いはあるが，局面の速度に合っておらず遅い',
  wrong_material_loss: '交換や駒の取り合いで損をする',
  wrong_gives_pieces: '駒を渡すことで相手の攻めや自玉の危険が増える',
  wrong_king_safety_risk: '自然に見えても，自玉の薄さや相手の攻めが問題になる',
  wrong_bad_move_short: '明確に悪い手として短く説明されている',
  wrong_natural_but_worse: '自然に見える狙いはあるが，読み筋上は十分な成果につながらない',

  unknown: '既存の簡易分類では理由を特定できない',
};

const SUGGESTED_STRUCTURES: Record<ExplanationPlanPrimaryReason, string[]> = {
  correct_attack_continues: [
    'この手の狙いを述べる',
    '相手が無視できない理由や次の手を述べる',
    '攻めが続く，または優勢になるとまとめる',
  ],
  correct_defense_works: [
    'この手で受けている相手の狙いを述べる',
    '玉の安全や自陣の安定につながる点を述べる',
    '受けながら局面を良くできるとまとめる',
  ],
  correct_material_gain: [
    'この手で得られる駒得や交換の得を述べる',
    'その得が局面で生きる理由を述べる',
    '駒得を主張できる手だとまとめる',
  ],
  correct_forcing_sequence: [
    '相手の応手が限られていることを述べる',
    '読み筋上こちらの狙いが通る理由を述べる',
    '主導権を保てる手だとまとめる',
  ],
  correct_tactical_gain: [
    'この手で生じる戦術的な狙いを述べる',
    '駒得や攻めの成果につながる理由を述べる',
    '局面を良くできる手だとまとめる',
  ],

  wrong_attack_disappears: [
    '候補手の狙いを一言で述べる',
    '相手の応手でその狙いが消えることを述べる',
    '攻め味がなくなる，または悪手になるとまとめる',
  ],
  wrong_opponent_escapes: [
    '一見よさそうに見える理由を述べる',
    '相手に逃げられる，またはかわされることを述べる',
    '狙いが残らないことをまとめる',
  ],
  wrong_opponent_blocks_line: [
    '候補手の狙いを述べる',
    '相手に角道や利きを止められることを述べる',
    '攻め筋が成立しないとまとめる',
  ],
  wrong_no_threat: [
    '候補手の意図を短く述べる',
    '相手にとって厳しい狙いがないことを述べる',
    '主張が弱い手だとまとめる',
  ],
  wrong_too_slow: [
    '候補手の狙いを短く述べる',
    '局面の速度に間に合っていないことを述べる',
    '遅い手または一手パスに近いとまとめる',
  ],
  wrong_material_loss: [
    '候補手で起きる交換や取り合いを述べる',
    'その交換で損をすることを述べる',
    '駒損が響くため選びにくいとまとめる',
  ],
  wrong_gives_pieces: [
    '候補手の狙いを短く述べる',
    '駒を渡すことで相手の攻めが厳しくなる点を述べる',
    '自玉の危険が増えるため選びにくいとまとめる',
  ],
  wrong_king_safety_risk: [
    '候補手の狙いまたは自然さを述べる',
    '自玉の薄さ，駒を渡す危険，相手の攻めを述べる',
    '安全度の問題で選びにくいとまとめる',
  ],
  wrong_bad_move_short: [
    '短く悪い手だと示す',
    '可能なら評価を落とす主因を補う',
    '断定しすぎず疑問手としてまとめる',
  ],
  wrong_natural_but_worse: [
    '一見自然に見える理由を述べる',
    'しかし相手の応手や読み筋で成果が出にくいことを述べる',
    '疑問手または選びにくい手としてまとめる',
  ],

  unknown: [
    '候補手または正解手の読み筋を事実ベースで述べる',
    '評価値差や読み筋から言える範囲に限定する',
    '詰みや必至など断定が必要な表現は避ける',
  ],
};

const ALLOWED_PHRASES: Record<ExplanationPlanPrimaryReason, string[]> = {
  correct_attack_continues: ['狙いがある', '攻めが続く', '無視できない', '好手'],
  correct_defense_works: ['受けられる', '安全にする', '守りながら', '好手'],
  correct_material_gain: ['駒得', '一歩得', '交換で得', '得を主張できる'],
  correct_forcing_sequence: ['応手が限られる', '受からない', '狙いが通る', '好手'],
  correct_tactical_gain: ['王手飛車', '両取り', '馬を作る', '成り込む'],

  wrong_attack_disappears: ['狙いはあるが', '攻め筋が消える', '攻め味がなくなる', '手が続かない'],
  wrong_opponent_escapes: ['逃げられる', 'かわされる', '狙いが残らない', '終わる'],
  wrong_opponent_blocks_line: ['角道を止められる', '利きがなくなる', '攻め筋を止められる', '狙いが成立しない'],
  wrong_no_threat: ['厳しい狙いがない', '主張が弱い', '何もない', '狙いがない'],
  wrong_too_slow: ['遅い', '一手パス', '間に合わない', '攻められる'],
  wrong_material_loss: ['駒損', '交換で損', '精算される', '損をする'],
  wrong_gives_pieces: ['駒を渡す', '相手の攻めが厳しくなる', '自玉が危ない'],
  wrong_king_safety_risk: ['玉が薄い', '自玉が危ない', '少しのミスで負けになる', '受けにくい'],
  wrong_bad_move_short: ['悪手', '疑問手', '選びにくい'],
  wrong_natural_but_worse: ['一見自然だが', '狙いはあるが', '成果につながりにくい', '選びにくい', '疑問手'],

  unknown: ['読み筋では', '評価としては', '慎重に見る必要がある'],
};

const CORRECT_FORCING_SEQUENCE_TERMS = [
  '取るしかない',
  '受からない',
  'つかまっている',
  '打たざるを得ない',
  '無視できない',
  '耐えられる',
  '耐える',
  '打たざるをえない',
];

const CORRECT_TACTICAL_GAIN_TERMS = [
  '王手飛車',
  '両取り',
  '両狙い',
  '成桂が残る',
  '馬を作る',
  '成り込む',
  '二枚替え',
];

const CORRECT_DEFENSE_TERMS = [
  '受けきれる',
  '受けられる',
  '耐えられる',
  '守り',
  '守る',
  'カバー',
  '安全',
  '固く',
  '手厚く',
  '先受け',
  '防ぐ',
  '止めて',
];

const CORRECT_ATTACK_TERMS = [
  '狙い',
  '攻め',
  '迫る',
  '主導権',
  '積極的',
  '角道を開く',
  '好手',
  'ぴったり',
];

const EXPLICIT_LINE_BLOCK_TERMS = [
  '角道',
  '利き',
  '効き',
  'ライン',
  '筋を止',
  '止めら',
  '止ま',
  '塞',
  '消させてしまう',
  '攻め筋を消させてしまう',
  '角を止め',
  '飛車筋',
];

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

function hasPattern(choice: ExistingChoiceAnalysis, pattern: SuspectedExplanationPattern): boolean {
  return choice.suspectedPatterns.includes(pattern);
}

function explanationIncludesAny(choice: ExistingChoiceAnalysis, terms: string[]): boolean {
  return terms.some((term) => choice.explanation.includes(term));
}

function hasExplicitLineBlockSignal(choice: ExistingChoiceAnalysis): boolean {
  return hasPattern(choice, 'opponent_blocks_line') && explanationIncludesAny(choice, EXPLICIT_LINE_BLOCK_TERMS);
}

function correctPrimaryReason(choice: ExistingChoiceAnalysis): ExplanationPlanPrimaryReason {
  if (hasPattern(choice, 'attack_continues')) return 'correct_attack_continues';
  if (hasPattern(choice, 'defense_works')) return 'correct_defense_works';
  if (hasPattern(choice, 'material_gain')) return 'correct_material_gain';

  if (explanationIncludesAny(choice, CORRECT_FORCING_SEQUENCE_TERMS)) return 'correct_forcing_sequence';
  if (explanationIncludesAny(choice, CORRECT_TACTICAL_GAIN_TERMS)) return 'correct_tactical_gain';

  if (explanationIncludesAny(choice, CORRECT_DEFENSE_TERMS)) return 'correct_defense_works';
  if (explanationIncludesAny(choice, CORRECT_ATTACK_TERMS)) return 'correct_attack_continues';

  return 'unknown';
}

function wrongPrimaryReason(choice: ExistingChoiceAnalysis): ExplanationPlanPrimaryReason {
  if (hasPattern(choice, 'gives_pieces')) return 'wrong_gives_pieces';
  if (hasPattern(choice, 'material_loss')) return 'wrong_material_loss';

  if (hasExplicitLineBlockSignal(choice)) return 'wrong_opponent_blocks_line';

  if (hasPattern(choice, 'opponent_escapes')) return 'wrong_opponent_escapes';
  if (hasPattern(choice, 'attack_disappears')) return 'wrong_attack_disappears';
  if (hasPattern(choice, 'no_threat')) return 'wrong_no_threat';
  if (hasPattern(choice, 'too_slow')) return 'wrong_too_slow';
  if (hasPattern(choice, 'king_safety_risk')) return 'wrong_king_safety_risk';
  if (hasPattern(choice, 'bad_move_short')) return 'wrong_bad_move_short';
  if (hasPattern(choice, 'natural_but_worse')) return 'wrong_natural_but_worse';

  return 'unknown';
}

function allReasons(choice: ExistingChoiceAnalysis): ExplanationPlanPrimaryReason[] {
  const reasons: ExplanationPlanPrimaryReason[] = [];

  if (choice.isCorrect) {
    if (hasPattern(choice, 'attack_continues') || explanationIncludesAny(choice, CORRECT_ATTACK_TERMS)) {
      reasons.push('correct_attack_continues');
    }

    if (hasPattern(choice, 'defense_works') || explanationIncludesAny(choice, CORRECT_DEFENSE_TERMS)) {
      reasons.push('correct_defense_works');
    }

    if (hasPattern(choice, 'material_gain')) {
      reasons.push('correct_material_gain');
    }

    if (explanationIncludesAny(choice, CORRECT_FORCING_SEQUENCE_TERMS)) {
      reasons.push('correct_forcing_sequence');
    }

    if (explanationIncludesAny(choice, CORRECT_TACTICAL_GAIN_TERMS)) {
      reasons.push('correct_tactical_gain');
    }
  } else {
    if (hasPattern(choice, 'gives_pieces')) reasons.push('wrong_gives_pieces');
    if (hasPattern(choice, 'material_loss')) reasons.push('wrong_material_loss');
    if (hasExplicitLineBlockSignal(choice)) reasons.push('wrong_opponent_blocks_line');
    if (hasPattern(choice, 'opponent_escapes')) reasons.push('wrong_opponent_escapes');
    if (hasPattern(choice, 'attack_disappears')) reasons.push('wrong_attack_disappears');
    if (hasPattern(choice, 'no_threat')) reasons.push('wrong_no_threat');
    if (hasPattern(choice, 'too_slow')) reasons.push('wrong_too_slow');
    if (hasPattern(choice, 'king_safety_risk')) reasons.push('wrong_king_safety_risk');
    if (hasPattern(choice, 'bad_move_short')) reasons.push('wrong_bad_move_short');
    if (hasPattern(choice, 'natural_but_worse')) reasons.push('wrong_natural_but_worse');
  }

  return Array.from(new Set(reasons));
}

function planTone(choice: ExistingChoiceAnalysis): ExplanationPlanTone {
  const absGapPercent = choice.eval.absGapPercent;

  if (choice.isCorrect) {
    return absGapPercent !== null && absGapPercent <= 5 ? 'mild_positive' : 'positive';
  }

  if (absGapPercent === null || absGapPercent <= 5) return 'mild_negative';
  if (absGapPercent <= 25) return 'clear_negative';
  return 'severe_negative';
}

function planConfidence(primaryReason: ExplanationPlanPrimaryReason, choice: ExistingChoiceAnalysis): 'high' | 'medium' | 'low' {
  if (primaryReason === 'unknown' || primaryReason === 'wrong_bad_move_short') return 'low';

  const nonUnknownPatternCount = choice.suspectedPatterns.filter((pattern) => pattern !== 'unknown').length;

  if (nonUnknownPatternCount >= 2) return 'high';
  return 'medium';
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

export function buildExplanationPlan(choice: ExistingChoiceAnalysis): ExplanationPlan {
  const primaryReason = choice.isCorrect ? correctPrimaryReason(choice) : wrongPrimaryReason(choice);
  const secondaryReasons = allReasons(choice).filter((reason) => reason !== primaryReason);

  return {
    problemId: choice.problemId,
    displayNo: choice.displayNo,
    choiceId: choice.choiceId,
    isCorrect: choice.isCorrect,
    label: choice.label,
    usi: choice.usi,

    primaryReason,
    secondaryReasons,

    reasonDetail: REASON_DETAILS[primaryReason],
    tone: planTone(choice),

    confidence: planConfidence(primaryReason, choice),

    suggestedStructure: SUGGESTED_STRUCTURES[primaryReason],
    allowedPhrases: ALLOWED_PHRASES[primaryReason],
    avoidPhrases: AVOID_PHRASES,

    sourceSignals: {
      suspectedPatterns: choice.suspectedPatterns,
      textLabelsSummary: textLabelsSummary(choice),
      lineFactsSummary: lineFactsSummary(choice),
      absGapCp: choice.eval.absGapCp,
      absGapPercent: choice.eval.absGapPercent,
      firstResponse: choice.lineFacts.firstResponse,
      sharedLineMoves: choice.comparisonToCorrect?.sharedLineMoves ?? [],
    },
  };
}