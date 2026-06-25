import { getStyleExamplesForPlans } from './explanationStyleExamples.js';
import type { ChoiceEvalFeature, DraftEvidenceChain, DraftProblem, DraftProblemChoice, ExplanationPlan } from './types.js';

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

function sortedEvidenceChains(plan: ExplanationPlan): DraftEvidenceChain[] {
  return [...(plan.sourceSignals.lineTrajectoryFeatures?.evidenceChains ?? [])]
    .sort((a, b) => b.priority - a.priority);
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
      const evidenceChains = sortedEvidenceChains(plan);

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
        line_trajectory_features: plan.sourceSignals.lineTrajectoryFeatures
          ? {
              materialTrend: plan.sourceSignals.lineTrajectoryFeatures.materialTrend,
              pieceActivityTrend: plan.sourceSignals.lineTrajectoryFeatures.pieceActivityTrend,
              kingSafetyTrend: plan.sourceSignals.lineTrajectoryFeatures.kingSafetyTrend,
              usableEvidence: plan.sourceSignals.lineTrajectoryFeatures.usableEvidence,
              evidenceChains,
              correctAttackContinuationEvidence: plan.sourceSignals.lineTrajectoryFeatures.correctAttackContinuationEvidence,
            }
          : null,
        evidence_chains: evidenceChains,
        contrast_features: plan.sourceSignals.contrastFeatures
          ? {
              choiceId: plan.sourceSignals.contrastFeatures.choiceId,
              comparedToCorrectChoiceId: plan.sourceSignals.contrastFeatures.comparedToCorrectChoiceId,
              correctStrengths: plan.sourceSignals.contrastFeatures.correctStrengths,
              ownStrengths: plan.sourceSignals.contrastFeatures.ownStrengths,
              missingComparedToCorrect: plan.sourceSignals.contrastFeatures.missingComparedToCorrect,
              missingCorrectEvidence: plan.sourceSignals.contrastFeatures.missingCorrectEvidence,
              ownCompensatingEvidence: plan.sourceSignals.contrastFeatures.ownCompensatingEvidence,
              contrastUsablePhrases: plan.sourceSignals.contrastFeatures.contrastUsablePhrases,
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
    '- 解説に使う材料は evidence_chains と line_trajectory_features.usableEvidence を優先する',
    '- evidence_chains がある場合，結果だけでなく手順ラベルを使って説明してよい',
    '- evidence_chains は priority が高い順に並んでいる',
    '- confidence が high/medium の evidence_chains がある場合，自然に本文へ入るものだけ使う',
    '- usablePhrase / resultPhrase は本文候補。説明として不自然なら無理に使わない',
    '- usablePhrase に手順ラベルが含まれる場合，自然ならそのまま使ってよい',
    '- 1つの explanation では必要な材料を1つ選べばよい',
    '- evidence_chains は line上で確認できる手順だけ。line外の応手は作らない',
    '- evidence_chains の limitations に注意する',
    '- evidence_chains の confidence が high/medium のものを優先する',
    '- evidence_chains を使う場合は usablePhrase / resultPhrase のうち自然な方を本文候補にする',
    '- priority が高い medium/high の evidence_chain でも，本文に入れる価値が低い小さな駒取りなら省いてよい',
    '- evidence_chains が使える場合も長くしすぎず，1〜2文に収める',
    '- choice.label / candidate move label は内部識別用。原則として本文に書かない',
    '- choice.label は選択肢の識別用であり，本文の主語にしない',
    '- 「▲９五角は」「△４二銀は」「銀を４二に動かすと」「歩を９四に突くのは」のように，選択肢そのものを説明し始めない',
    '- candidate_move の step.label は，candidateLabelAllowedInText が true の時だけ本文に使う',
    '- candidate move の label を使うのは，「同金」「同銀」など，ラベルなしでは意味が崩れる場合だけ',
    '- 本文に使ってよいlabelは，evidence_chains.steps の opponent_response / next_own_move / defense / threat / material_gain など，line上の手順ラベル',
    '- opponent_response / next_own_move / defense / threat / material_gain の step.label は，読み筋上の根拠として自然なら使ってよい',
    '- evidence_chains の usablePhrase に line label が含まれる場合も，本文として自然な場合だけ使う',
    '- lineLabelsPreferred が true の step.label は，強制ではなく本文候補として扱う',
    '- 使うべきなのは選択肢ラベルではなく，line上の応手・次の自分の手・受け・狙いのラベル',
    '- 例: 「△同飛成には▲８八歩打がある」',
    '- 例: 「▲６八金と逃げても△５八金打が残る」',
    '- 例: 「△８一飛には▲７三角成が残る」',
    '- 断定の強い評価語や終局語は使わない',
    '- usableEvidence の evidenceLevel が direct または line_observed のものは本文に使ってよい',
    '- usableEvidence の heuristic は断定を弱める',
    '- usableEvidence の eval_supported は単独では使わず，盤面特徴と組み合わせる',
    '- usableEvidence の weak は，ほかに材料がない場合だけ使う',
    '- evalSupport は全体評価の補助情報であり，単独の理由として使わない',
    '- 評価値だけを根拠に，駒得・玉の固さ・攻めが続くとは断定しない',
    '- 正解手を書くときは，まず line_trajectory_features.correctAttackContinuationEvidence を見る',
    '- correctAttackContinuationEvidence がある正解手では，usablePhrase から具体的な狙い・成り・駒取り・大駒当たりを1つ入れる',
    '- 次に evidence_chains の textUsefulness が must_use / useful のものを見る',
    '- 次に usableEvidence の line_observed / direct を見る',
    '- 正解手の correct_attack_continues では，「攻めが続く」だけで終わらせず，具体材料と一緒に書く',
    '- 正解手で lineContinuation / threat / promotion / pieceActivity の evidence がある場合は，一般表現よりそれを優先する',
    '- 正解手で line上の応手と次の自分の手が自然に短く入る場合だけ，その line label を使ってよい',
    '- まず move_facts.factPhrases を見る',
    '- 次に line_continuation_features.continuationPhrases を見る',
    '- 次に position_features.summaryPhrases を見る',
    '- 不正解手を書くときは，できるだけ contrast_features.ownCompensatingEvidence / ownStrengths を先に見る',
    '- ownCompensatingEvidence や ownStrengths がある場合は，その手に一応ある良さを1つ本文に入れる',
    '- 次に contrast_features.missingCorrectEvidence を見る。正解手にだけある具体材料を，不正解手との差分として使う',
    '- 次に contrast_features.contrastUsablePhrases を優先する。contrastPhrases は補助として扱う',
    '- primaryReason が wrong_natural_but_worse の不正解手では，必ず「{その手の良さ}が，{正解手との差}」を第一候補にする',
    '- wrong_natural_but_worse では，ownCompensatingEvidence の具体factを1つ選び，正解手との差まで1文で書く',
    '- 不正解手は「一応あるもの + 正解手にだけある具体材料が足りない理由」を基本形にする',
    '- 例: 「一歩取れるが，正解手のような角成は残らない」',
    '- 例: 「飛車取りにはなるが，正解手ほど大きな当たりではない」',
    '- 「正解手ほど攻めが続かない」だけで終わらせない。その手固有の良さ，または正解手にだけある具体材料を1つ入れる',
    '- 正解手の line label は毎回入れなくてよい。入れる場合は evidence_chains または missingCorrectEvidence.source=correct_evidenceChain の phrase にあるものだけ使う',
    '- contrast_features.confidence が medium の場合は，ownCompensatingEvidence / missingCorrectEvidence / contrastUsablePhrases を主材料にしてよい',
    '- contrast_features.confidence が low の場合は，断定を弱めて短く書く',
    '- ownStrengths が空なら move_facts.factPhrases や position_features の具体phraseを使う',
    '- 具体phraseも contrastPhrases もない場合だけ，「正解手ほど攻めが続かない」に留める',
    '- 正解手で line_continuation_features.continuationPhrases がある場合は，必ず1つ本文に入れる',
    '- continuationPhrases は短文としてそのまま使いやすい形なので，不自然に「〜と」でつなげない',
    '- 正解手で move_facts.factPhrases がある場合は，できるだけ1文目に入れる',
    '- 正解手は continuationPhrases，factPhrases，summaryPhrases の順で具体材料を使う',
    '- 正解手を「攻めが続く」だけで終わらせない',
    '- 正解手でも「展開」「印象」「見込める」のようなまとめ語を使わず，factPhrases / continuationPhrases の事実だけで書く',
    '- materialPhrases / activityPhrases は具体的な駒名がある場合だけ使う',
    '- 駒得を書く場合は，「一歩取れる」「角を取れる」のような具体factに寄せる',
    '- kingSafety は confidence が medium の時だけ使う',
    '- explanation_plan は補助情報。reasonMemo をそのまま本文に写さない',
    '- allowedPhrases は使ってよい語彙。全部入れる必要はない',
    '- line_continuation_features は line 上で確認できる事実なので，本文に使ってよい',
    '- canUseEscapePhrase が false の choice では，「逃げられる」「かわされる」「逃げてしまう」「逃げてしまい」を使わない',
    '- primaryReason が wrong_opponent_escapes でも，canUseEscapePhrase が false なら「正解手ほど攻めが続かない」と書く',
    '- factPhrases がある正解手では，1文目に factPhrases の具体事実を入れる',
    '- reasonMemo は内部メモなので，本文にそのまま写さない',
    '- line と firstResponse から具体手を拾える場合は，抽象語より具体手を優先する',
    '- move_facts にない内容を勝手に作らない',
    '- 「成銀が角に当たる」「飛車取りになる」のような具体事実を優先する',
    '- confidence が low の玉の危険は断定しない',
    '- 抽出された特徴量にない内容を作らない',
    '- lineにない変化を作らない',
    '- primaryReasonだけを根拠に，逃走・切り返し・危険を表す語を書かない',
    '',
    '文体ルール:',
    '- 常体寄りの短文にする',
    '- 原則35〜90字',
    '- 基本は1文。どうしても材料が2つ必要な時だけ2文',
    '- 長い一般説明にしない',
    '- ラベルから始める必要はない',
    '- choice.label / candidate move label から始めない',
    '- choice.label は内部識別用なので，本文では原則使わない',
    '- 「▲９五角は」「△４二銀は」のように，選択肢そのものを主語にしない',
    '- 「銀を４二に動かすと」「２六に歩を打つと」「歩を９四に突くのは」のような候補手の説明調にしない',
    '- ただし「同金」「同銀」など，ラベルなしでは意味が分からない場合だけ短く使ってよい',
    '- factPhrases / continuationPhrases が自然に使える場合は，それを文頭にする',
    '- 相手の反応を一般論で書かず，具体的な駒名・手順を優先する',
    '- 「飛車取りになり，攻めが続く」のようにつなげず，「飛車取りになる。角成が残る。」のように短く切る',
    '- 不正解手が複数ある場合，同じ文型を繰り返さない',
    '- 不正解手は「正解手ほど攻めが続かない。攻め味が弱い。」だけで終わらせない',
    '- 不正解手で具体factを書いた後の2文目を「攻め味が弱い」「攻め味が薄い」だけにしない',
    '- 不正解手で confidence が low の場合は，1文にまとめる',
    '- 不正解手は「具体fact。一般評価。」の2文に分けず，「具体factが，正解手との差」の1文にする',
    '- 具体factがある不正解手は，「手が遅い」「厳しい狙いがない」「後続の攻めが弱い」のように理由を具体化する',
    '- 「攻め味が弱い」「攻め味が薄い」は，他に具体phraseがない最後の場合だけ使う',
    '- 攻めが完全に消えるという強い断定は使わず，「後続の攻めが弱い」にする',
    '- 根拠が弱い場合は，「後続の攻めが弱い」「正解手ほど攻めが続かない」に留める',
    '- 曖昧な期待表現は使わない',
    '- 「大きな得ではない」ではなく，根拠が弱い場合は「正解手ほど大きな当たりではない」と書く',
    '- 比較表現は使ってよいが，できれば各手の具体factを1つ入れる',
    '- 狙い，攻め味，駒損，受けなどを短く言い切る',
    '- 冒頭を「この手は」にしない',
    '- 抽象的な一般論ではなく，この選択肢と読み筋に即して書く',
    '- 根拠が弱い不正解手は「正解手ほど攻めが続かない」「攻め味が弱い」に留める',
    '',
    '禁止事項:',
    '- 出力前に必ず validation 禁止語チェックをする。抽象的な褒め語，評価断定，曖昧な期待表現，攻めが完全に消える断定，候補順位語，「展開」「印象」「見込める」を本文に含めない',
    '- 「逃げられる」「逃げられず」は canUseEscapePhrase が true の choice だけで使う。false または不明なら「後続の攻めが弱い」「正解手ほど攻めが続かない」に置き換える',
    '- 出力前に候補手主語チェックをする。駒をどこへ動かす/打つ/突くという操作説明で文を始めない',
    '- 候補手の操作説明になった場合は，盤面factから始める形に直してから出す',
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
    '- 評価断定は使わない。正解手でも具体factだけを書く',
    '- 不正解手を褒め語で呼ばない',
    '- 正解手でも褒め語だけで説明を終えない',
    '- 褒め語でまとめず，具体factを書く',
    '- 評価をまとめるより，「飛車取りになる」「角成が残る」「攻めが続く」のような具体factを書く',
    '- 「逃げられる」「かわされる」「逃げてしまう」「逃げてしまい」は，move_facts.firstResponseFacts や factPhrases で確認できる場合だけ使う',
    '- primaryReason が wrong_opponent_escapes でも，line上で逃げた駒が確認できない場合は「逃げられる」と書かない',
    '- position_features や line に根拠がない場合は，切り返しや危険を表す語を書かない',
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
    '将棋の次の一手問題について、各選択肢の解説文を作成してください。',
    '',
    ...instructions,
    '',
    '入力データ:',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}
