import { getStyleExamplesForPlans } from './explanationStyleExamples.js';
import type { ChoiceEvalFeature, DraftProblem, DraftProblemChoice, ExplanationPlan } from './types.js';

function featureByChoiceId(features: ChoiceEvalFeature[], choiceId: number): ChoiceEvalFeature {
  const feature = features.find((item) => item.choice_id === choiceId);
  if (!feature) {
    throw new Error(`missing eval feature for choice_id=${choiceId}`);
  }
  return feature;
}

function planByChoiceId(plans: ExplanationPlan[], choiceId: number): ExplanationPlan {
  const plan = plans.find((item) => item.choiceId === choiceId);
  if (!plan) {
    throw new Error(`missing explanation plan for choice_id=${choiceId}`);
  }
  return plan;
}

function canUseEscapePhrase(plan: ExplanationPlan): boolean {
  return [
    ...(plan.sourceSignals.moveFacts?.firstResponseFacts ?? []),
    ...(plan.sourceSignals.moveFacts?.factPhrases ?? []),
    ...(plan.sourceSignals.lineContinuationFeatures?.continuationPhrases ?? []),
  ].some((phrase) =>
    phrase.includes('逃げられる') ||
    phrase.includes('逃げる') ||
    phrase.includes('逃げても') ||
    phrase.includes('かわされる')
  );
}

export function buildExplanationPrompt(
  problem: DraftProblem,
  choices: DraftProblemChoice[],
  features: ChoiceEvalFeature[],
  plans: ExplanationPlan[],
): string {
  const styleExamples = getStyleExamplesForPlans(plans);

  const payload = {
    problem: {
      id: problem.id,
      root_sfen: problem.root_sfen,
      intro_moves_usi: problem.intro_moves_usi,
      correct_choice_id: problem.correct_choice_id,
    },
    style_examples: styleExamples,
    choices: choices.map((choice) => {
      const feature = featureByChoiceId(features, choice.choice_id);
      const plan = planByChoiceId(plans, choice.choice_id);

      return {
        choice_id: choice.choice_id,
        label: choice.label,
        usi: choice.usi,
        eval_cp: choice.eval_cp,
        eval_percent: choice.eval_percent,
        line: choice.line,
        is_correct: feature.isCorrect,
        eval_rank: feature.rank,
        gapFromBest: feature.gapFromBest,
        quality: feature.quality,
        canUseEscapePhrase: canUseEscapePhrase(plan),
        move_facts: plan.sourceSignals.moveFacts
          ? {
              movedPiece: plan.sourceSignals.moveFacts.movedPiece,
              from: plan.sourceSignals.moveFacts.from,
              to: plan.sourceSignals.moveFacts.to,
              isDrop: plan.sourceSignals.moveFacts.isDrop,
              isPromotion: plan.sourceSignals.moveFacts.isPromotion,
              promotedPiece: plan.sourceSignals.moveFacts.promotedPiece,
              capturedPiece: plan.sourceSignals.moveFacts.capturedPiece,
              attacksAfterMove: plan.sourceSignals.moveFacts.attacksAfterMove,
              attacksHighValuePiece: plan.sourceSignals.moveFacts.attacksHighValuePiece,
              givesCheck: plan.sourceSignals.moveFacts.givesCheck,
              factPhrases: plan.sourceSignals.moveFacts.factPhrases,
              firstResponse: plan.sourceSignals.moveFacts.firstResponse,
              firstResponseLabel: plan.sourceSignals.moveFacts.firstResponseLabel,
              firstResponseFacts: plan.sourceSignals.moveFacts.firstResponseFacts,
              lineFirstMoves: plan.sourceSignals.moveFacts.lineFirstMoves,
            }
          : null,
        position_features: plan.sourceSignals.positionFeatures
          ? {
              material: plan.sourceSignals.positionFeatures.material,
              pieceActivity: plan.sourceSignals.positionFeatures.pieceActivity,
              kingSafety: plan.sourceSignals.positionFeatures.kingSafety,
              summaryPhrases: plan.sourceSignals.positionFeatures.summaryPhrases,
            }
          : null,
        line_continuation_features: plan.sourceSignals.lineContinuationFeatures
          ? {
              lineFirstMoves: plan.sourceSignals.lineContinuationFeatures.lineFirstMoves,
              firstResponse: plan.sourceSignals.lineContinuationFeatures.firstResponse,
              firstResponseLabel: plan.sourceSignals.lineContinuationFeatures.firstResponseLabel,
              nextOwnMove: plan.sourceSignals.lineContinuationFeatures.nextOwnMove,
              nextOwnMoveLabel: plan.sourceSignals.lineContinuationFeatures.nextOwnMoveLabel,
              nextOwnMoveFacts: plan.sourceSignals.lineContinuationFeatures.nextOwnMoveFacts,
              continuationPhrases: plan.sourceSignals.lineContinuationFeatures.continuationPhrases,
              movedPieceContinuesAfterResponse: plan.sourceSignals.lineContinuationFeatures.movedPieceContinuesAfterResponse,
              movedPiecePromotesAfterResponse: plan.sourceSignals.lineContinuationFeatures.movedPiecePromotesAfterResponse,
              movedPieceCapturesAfterResponse: plan.sourceSignals.lineContinuationFeatures.movedPieceCapturesAfterResponse,
            }
          : null,
        contrast_features: plan.sourceSignals.contrastFeatures
          ? {
              choiceId: plan.sourceSignals.contrastFeatures.choiceId,
              comparedToCorrectChoiceId: plan.sourceSignals.contrastFeatures.comparedToCorrectChoiceId,
              correctStrengths: plan.sourceSignals.contrastFeatures.correctStrengths,
              ownStrengths: plan.sourceSignals.contrastFeatures.ownStrengths,
              missingComparedToCorrect: plan.sourceSignals.contrastFeatures.missingComparedToCorrect,
              contrastPhrases: plan.sourceSignals.contrastFeatures.contrastPhrases,
              diagnosis: plan.sourceSignals.contrastFeatures.diagnosis,
              confidence: plan.sourceSignals.contrastFeatures.confidence,
            }
          : null,

        explanation_plan: {
          primaryReason: plan.primaryReason,
          secondaryReasons: plan.secondaryReasons,
          reasonMemo: plan.reasonDetail,
          tone: plan.tone,
          confidence: plan.confidence,
          allowedPhrases: plan.allowedPhrases,
          avoidPhrases: plan.avoidPhrases,
          sourceSignals: {
            firstResponse: plan.sourceSignals.firstResponse,
            lineFactsSummary: plan.sourceSignals.lineFactsSummary,
            sharedLineMoves: plan.sourceSignals.sharedLineMoves,
          },
        },
      };
    }),
  };

  const instructions = [
    '特徴量の使い方:',
    '- style_examples の短さ，語尾，直接さに寄せる',
    '- まず move_facts.factPhrases を見る',
    '- 次に line_continuation_features.continuationPhrases を見る',
    '- 次に position_features.summaryPhrases を見る',
    '- 不正解手を書くときは，まず contrast_features.contrastPhrases を見る',
    '- contrastPhrases がある場合は，それを主材料にする',
    '- contrast_features.confidence が medium の場合は，contrastPhrases を主材料にしてよい',
    '- contrast_features.confidence が low の場合は，断定を弱めて短く書く',
    '- contrastPhrases がない場合だけ，move_facts や position_features に戻る',
    '- 正解手で line_continuation_features.continuationPhrases がある場合は，必ず1つ本文に入れる',
    '- continuationPhrases は短文としてそのまま使いやすい形なので，不自然に「〜と」でつなげない',
    '- 正解手で move_facts.factPhrases がある場合は，できるだけ1文目に入れる',
    '- materialPhrases / activityPhrases は具体的な駒名がある場合だけ使う',
    '- 「駒得を主張できる」は materialPhrases や capturedPiece などの根拠がある場合だけ使う',
    '- kingSafety は confidence が medium の時だけ使う',
    '- explanation_plan は補助情報。reasonMemo をそのまま本文に写さない',
    '- allowedPhrases は使ってよい語彙。全部入れる必要はない',
    '- line_continuation_features は line 上で確認できる事実なので，本文に使ってよい',
    '- canUseEscapePhrase が false の choice では，「逃げられる」「かわされる」を使わない',
    '- primaryReason が wrong_opponent_escapes でも，canUseEscapePhrase が false なら「正解手ほど攻めが続かない」と書く',
    '- factPhrases がある正解手では，1文目に factPhrases の具体事実を入れる',
    '- reasonMemo は内部メモなので，本文にそのまま写さない',
    '- line と firstResponse から具体手を拾える場合は，抽象語より具体手を優先する',
    '- move_facts にない内容を勝手に作らない',
    '- 「成銀が角に当たる」「飛車取りになる」のような具体事実を優先する',
    '- confidence が low の玉の危険は断定しない',
    '- 抽出された特徴量にない内容を作らない',
    '- lineにない変化を作らない',
    '- primaryReasonだけを根拠に「逃げられる」「反撃」「危険」などを書かない',
    '',
    '文体ルール:',
    '- 常体寄りの短文にする',
    '- 原則35〜90字',
    '- 1〜2文',
    '- 長い一般説明にしない',
    '- ラベルから始める必要はない',
    '- factPhrases / continuationPhrases が自然に使える場合は，それを文頭にする',
    '- 「角を９五に打つと」のような説明調を避け，必要な場合だけ「９五角打ちは」「▲９五角は」のように短く書く',
    '- 相手の反応を一般論で書かず，具体的な駒名・手順を優先する',
    '- 「飛車取りになり，攻めが続く」のようにつなげず，「飛車取りになる。角成が残る。」のように短く切る',
    '- 不正解手が複数ある場合，同じ文型を繰り返さない',
    '- 比較表現は使ってよいが，できれば各手の具体factを1つ入れる',
    '- 狙い，攻め味，駒損，受けなどを短く言い切る',
    '- 冒頭を「この手は」にしない',
    '- 抽象的な一般論ではなく，この選択肢と読み筋に即して書く',
    '- 根拠が弱い不正解手は「正解手ほど攻めが続かない」「攻め味が弱い」に留める',
    '',
    '禁止事項:',
    '- 評価値や勝率の数字を本文に直接出さない',
    '- position_features の value や score などの数字を本文に出さない',
    '- 詰み、必至、詰めろは、明確な根拠がない限り書かない',
    '- 読み筋にない変化を作らない',
    '- continuationPhrases がない場合は，無理に数手先の説明をしない',
    '- 盤面から断定できない駒得、玉の危険度、受けの成否を書かない',
    '- 丁寧すぎる説明文や一般的なAI説明にしない',
    '- tone が severe_negative でも、強すぎる断定表現は使わない',
    '- avoidPhrases にある表現は使わない',
    '- 一般的なAI説明の褒め言葉や，抽象的な比較語でごまかさない',
    '- 「優勢」「有利」「形勢」「評価が良い」「保てる」「勝ちやすい」のような形勢断定は使わない',
    '- 形勢をまとめるより，「飛車取りになる」「角成が残る」「攻めが続く」のような具体factを書く',
    '- 「逃げられる」「かわされる」は，move_facts.firstResponseFacts や factPhrases で確認できる場合だけ使う',
    '- primaryReason が wrong_opponent_escapes でも，line上で逃げた駒が確認できない場合は「逃げられる」と書かない',
    '- position_features や line に根拠がない場合は「反撃」「危険」と書かない',
    '- line と矛盾する説明をしない',
    '- 何が逃げたか分からない場合は，「正解手ほど攻めが続かない」「攻め味が弱い」のように控えめに書く',
    '',
    '出力ルール:',
    '- 各選択肢ごとに explanation を作る',
    '- 正解手はなぜ正解なのかを書く',
    '- 不正解手はなぜ正解手に劣るのかを書く',
    '- 1つの explanation は1〜2文程度',
    '- 出力は必ずJSONにする',
    '',
    '出力形式:',
    '{',
    '  "choices": [',
    '    { "choice_id": 1, "explanation": "..." },',
    '    { "choice_id": 2, "explanation": "..." },',
    '    { "choice_id": 3, "explanation": "..." }',
    '  ]',
    '}',
  ];

  return [
    '将棋の次の一手問題について、各選択肢の短い解説文を作成してください。',
    '',
    ...instructions,
    '',
    '入力データ:',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}
