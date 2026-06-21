import type { ExplanationTextLabels } from './types.js';

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function matchAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function extractExplanationTextLabels(explanation: string): ExplanationTextLabels {
  const text = explanation ?? '';
  const mentionedMoves = unique(text.match(/[▲△][１２３４５６７８９1-9一二三四五六七八九同][一二三四五六七八九１２３４５６７８９1-9]?[歩香桂銀金角飛王玉と成打不]*/g) ?? []);

  const saysMaterialGain = includesAny(text, ['駒得', '桂得', '銀得', '金得', '一歩得', '得を主張', '駒を得', '取れる']);
  const saysMaterialLoss = includesAny(text, ['駒損', '損をする', '交換では損', '交換で損', '角銀交換は損', '飛車金交換ではこちらが損', '損になる', '取られる']);
  const saysGivesPieces = includesAny(text, ['駒を渡す', '桂馬を渡す', '銀を渡す', '金を渡す', '角を渡す', '飛車を渡す', '持ち駒を与える'])
    || matchAny(text, [/[歩香桂銀金角飛][^。、「」]{0,8}渡す/, /渡す[^。、「」]{0,8}[歩香桂銀金角飛]/]);

  return {
    mentionedMoves,

    mentionsAttack: includesAny(text, [
      '攻め',
      '攻め筋',
      '攻め味',
      '攻める',
      '攻められる',
      '攻めが続く',
      '攻めが繋がる',
      '攻めが切れる',
      '攻め切れる',
      '攻め急ぐ',
      '狙い',
      '手筋',
      '仕掛け',
      '仕掛ける',
      '手番',
      '先手を取る',
      '主張',
      '拠点',
      '垂らす',
      '取り込む',
      '成り込む',
      '成る',
      '突く',
      '突き捨て',
      '叩く',
      '打ち込む',
      '迫る',
      '突っ込む',
      '飛車成',
      '角成',
      '両狙い',
      '無視できない',
    ]),
    mentionsDefense: includesAny(text, ['受け', '受ける', '受けき', '守る', '守り', '守って', '固い', '固く', '安全', '耐える', 'かわす', '防ぐ', '防ぎ', '備え', 'カバー']),
    mentionsKingSafety: includesAny(text, ['玉', '自玉', '相手玉', '薄い', '固い', '詰めろ', '詰み', '危ない']),
    mentionsMaterial: includesAny(text, ['駒得', '駒損', '桂得', '銀得', '金得', '交換', '精算', '駒を渡す', '取られる', '取れる']),
    mentionsLineControl: includesAny(text, ['角道', '利き', '効き', '睨み', '睨んで', 'ライン', '筋', '止められる']),

    saysIntentWorks: includesAny(text, ['成立', '成り立つ', '通る', '狙いがある', '好手', '厳しい', '急所', '最善', '正解', '無視できない', '成功', 'ぴったり']),
    saysIntentFails: includesAny(text, [
      '狙いがなくなる',
      '攻め筋が消える',
      '攻め味がなくなる',
      '何もない',
      '終わる',
      '意味がない',
      '主張がない',
      '攻めが切れる',
      '攻めが続かない',
      '攻めが繋がらない',
      '攻め筋がない',
      '攻め味がない',
      '狙いが薄い',
      '狙いが消える',
      '狙いもなくなる',
      '手が続かない',
      '続かない',
      '空振り',
      '終わってしまう',
      '間に合わない',
      '成立しない',
    ]),
    saysOpponentCanEscape: includesAny(text, ['逃げられる', '逃げる', 'かわされる', 'かわす', '避けられる', '引かれる', '引かれて', '上がられる', 'あがられ', '寄られる', '躱される']),
    saysOpponentCanBlock: includesAny(text, ['角道を止め', '角道が止まる', '角道を塞ぐ', '利きが止まる', '効きがなくなる', 'ラインが止まる', '筋を止め']),
    saysOpponentCanDefend: includesAny(text, ['受けられる', '受け止められる', '対応される', '守られる', '守られて', '防がれる', '防ぐ', '消される', '消させてしまう', '止められる', '止まる', '止める', '塞がれる', '塞ぐ', 'カバーされる']),

    saysTooSlow: includesAny(text, ['遅い', '遅れる', '間に合わない', '重い', '重たい', '重たく', 'ぬるい', '悠長', '一手遅い'])
      || matchAny(text, [/相手に先に/, /先に攻められる/, /先に成られる/]),
    saysNoThreat: includesAny(text, ['何もない', '何もなし', '特にない', '厳しくない', '厳しい攻めがない', '怖くない', '痛くない', 'あまり痛くない', '意味がない', '主張がない', '狙いがない']),
    saysOneMovePass: includesAny(text, ['一手パス']),

    saysMaterialGain,
    saysMaterialLoss,
    saysGivesPieces,

    saysGoodMove: includesAny(text, ['好手', '良い', '良し', '優勢', '勝勢', '指しやすい', '成功', '成立', '十分', '大きい', '厳しい']),
    saysBadMove: includesAny(text, ['悪手', '悪い', '疑問手', '危ない', '痛い', '痛く', '激痛', '失敗', '無理', '難しい', '指し辛い', '指しづらい', '良くない', '損', '苦しい', '辛い', '劣勢', '不利', '不満', '残念', 'もったいない', '勿体無い']),
    saysQuestionable: includesAny(text, ['疑問手']),
    saysNaturalBut: includesAny(text, ['自然に見える', '一見', '見えるが', '狙いがあるが', '狙いはあるが', 'ものの', 'しかし', 'ただ'])
      || matchAny(text, [/だが/, /ですが/]),

    hasAiPrefix: text.includes('【AI解説'),
  };
}
