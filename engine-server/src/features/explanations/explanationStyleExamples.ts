import type { ExplanationPlan, ExplanationPlanPrimaryReason } from './types.js';

type StyleExampleGroup = {
  reason: ExplanationPlanPrimaryReason;
  examples: string[];
};

const STYLE_EXAMPLES_BY_REASON: Record<ExplanationPlanPrimaryReason, string[]> = {
  correct_attack_continues: [
    '△同銀の後の▲５五歩が狙い。角が睨んでおり△同歩とは取れない。',
    '銀を取った手が飛車に当たる。',
    'ここは攻め急ぐのをじっと我慢して歩を垂らすのが好手。',
    '飛車取りも残りつつ，馬で左上部の陣地を広げる。',
  ],

  correct_defense_works: [
    '馬にあてながら玉を固くする好手。',
    '飛車と４六の歩の両方を狙っているため，打った銀を幅広く使える。',
    '歩成をされても受けきれるため純粋な駒得を選ぶ。',
  ],

  correct_material_gain: [
    '相手より飛車に強い形なので飛車交換を選ぶ。',
    '相手が飛車交換を拒んできても一歩得を主張できる。',
    '歩成をされても受けきれるため純粋な駒得を選ぶ。',
  ],

  correct_forcing_sequence: [
    '相手は取るしかない。',
    '△５三金には▲５四歩から▲６三歩成で金がつかまっている。',
    '受けても攻めが続く。',
  ],

  correct_tactical_gain: [
    '王手飛車をかけられるわかりやすい好手。',
    '両狙いがあり，駒が大活躍する。',
    '最後に成桂が残るので厳しい。',
  ],

  wrong_attack_disappears: [
    '６四に銀を引かれ５五歩の狙いもなくなる為悪手。',
    '銀を逃げられると攻め味がなくなる。',
    '飛車周りによって６四に歩を打つ攻め筋を消させてしまうので疑問手。',
    '桂頭を守られてしまいもったいない。',
  ],

  wrong_opponent_escapes: [
    '銀を逃げられると攻め味がなくなる。',
    '飛車を逃げられて終わる。',
    '飛車を冷静に逃げられると苦しい。',
  ],

  wrong_opponent_blocks_line: [
    '飛車周りによって６四に歩を打つ攻め筋を消させてしまうので疑問手。',
    '角道を止められると狙いが成立しない。',
    '利きがなくなり，攻めが続かない。',
  ],

  wrong_no_threat: [
    '何もない。',
    '厳しい攻めが特にない。',
    '主張が弱く，手として物足りない。',
  ],

  wrong_too_slow: [
    '同金で厳しい攻めが特にないので少し重たくて遅い。',
    'ここで桂馬を逃げるのは遅い。',
    'そこの歩を取るのは一手パスでもったいない。',
    '結果的に一手パスになっている。',
  ],

  wrong_material_loss: [
    '単純な飛車金交換ではこちらが損をする。',
    '序盤の角銀交換は損をすることが多い。',
    '純粋な駒損で中盤に差し掛かる場面では痛い。',
  ],

  wrong_gives_pieces: [
    '飛車を渡すと一方的に攻められてしまうため悪い。',
    '駒をたくさん渡すのは危ない。',
    '飛車をタダで渡すのは辛い。',
  ],

  wrong_king_safety_risk: [
    '自玉は安全そうに見えるが，駒をたくさん渡すのは危ない。',
    '玉が薄く少しのミスで負けになる。',
    '相手からの攻めが止まらない。',
  ],

  wrong_bad_move_short: [
    '悪手。',
    '疑問手。',
    '選びにくい。',
  ],

  wrong_natural_but_worse: [
    '狙いはあるが，攻め味がなくなる。',
    '一つの狙いしかないので厳しい手ではない。',
    '読み筋では難解な展開になる。',
  ],

  unknown: [
    'lineだけでは理由を断定しすぎない。',
    '正解手と比べると少し指しにくい。',
    '読み筋では少し難しい。',
  ],
};

function uniqueReasons(plans: ExplanationPlan[]): ExplanationPlanPrimaryReason[] {
  const result: ExplanationPlanPrimaryReason[] = [];
  const seen = new Set<ExplanationPlanPrimaryReason>();

  for (const plan of plans) {
    const reasons = [plan.primaryReason, ...plan.secondaryReasons];

    for (const reason of reasons) {
      if (seen.has(reason)) continue;
      seen.add(reason);
      result.push(reason);
    }
  }

  return result;
}

export function getStyleExamplesForPlans(
  plans: ExplanationPlan[],
  maxExamplesPerReason = 2,
  maxReasonCount = 6,
): StyleExampleGroup[] {
  return uniqueReasons(plans)
    .slice(0, maxReasonCount)
    .map((reason) => ({
      reason,
      examples: STYLE_EXAMPLES_BY_REASON[reason].slice(0, maxExamplesPerReason),
    }))
    .filter((group) => group.examples.length > 0);
}
