import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const app = express();
const PORT = parseInt(process.env.AI_PORT ?? process.env.PORT ?? '8766', 10);
const HOST = process.env.AI_HOST ?? process.env.HOST ?? '0.0.0.0';
const MODEL = process.env.OPENAI_EXPLANATION_MODEL ?? 'gpt-4o';

app.use(cors());
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

type SideToMove = 'sente' | 'gote';

type TrainingExample = {
  label: string;
  eval_percent: number;
  line_labels: string;
  explanation: string;
};

type TrainingExamplesBySide = Record<SideToMove, TrainingExample[]>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRAINING_EXAMPLES_PATH = path.join(__dirname, 'explanation-training-examples.json');

function loadTrainingExamples(): TrainingExamplesBySide {
  const raw = fs.readFileSync(TRAINING_EXAMPLES_PATH, 'utf8');
  const parsed = JSON.parse(raw) as Partial<TrainingExamplesBySide>;
  return {
    sente: Array.isArray(parsed.sente) ? parsed.sente : [],
    gote: Array.isArray(parsed.gote) ? parsed.gote : [],
  };
}

const TRAINING_EXAMPLES = loadTrainingExamples();

type ExplanationChoice = {
  label: string;
  eval_percent: number | null;
  line_labels: string;
  is_correct: boolean;
};

function inferExampleSide(sideToMove: SideToMove, choices: ExplanationChoice[]): SideToMove {
  const senteLabels = choices.filter((choice) => choice.label.trim().startsWith('▲')).length;
  const goteLabels = choices.filter((choice) => choice.label.trim().startsWith('△')).length;

  if (senteLabels > goteLabels) return 'sente';
  if (goteLabels > senteLabels) return 'gote';
  return sideToMove;
}

function buildPrompt(sfen: string, sideToMove: SideToMove, choices: ExplanationChoice[]): string {
  const exampleSide = inferExampleSide(sideToMove, choices);
  const examples = TRAINING_EXAMPLES[exampleSide];
  const examplesText = examples.map(
    (ex) =>
      `指し手: ${ex.label} | 勝率: ${ex.eval_percent}% | 読み筋: ${ex.line_labels || 'なし'}\n解説: ${ex.explanation}`,
  ).join('\n\n');

  const choicesList = choices
    .map(
      (c, i) =>
        `${i + 1}. 指し手: ${c.label} | 勝率: ${c.eval_percent ?? '不明'}% | 読み筋: ${c.line_labels || 'なし'}${c.is_correct ? ' [正解手]' : ''}`,
    )
    .join('\n');

  const sideLabel = exampleSide === 'sente' ? '先手' : '後手';
  const sideMarker = exampleSide === 'sente' ? '▲' : '△';
  const opponentMarker = exampleSide === 'sente' ? '△' : '▲';
  const styleExamplesText = examples
    .slice(0, 16)
    .map((ex, i) => `${i + 1}. ${ex.explanation}`)
    .join('\n');

  return `あなたは将棋の解説者です。次の一手問題の各選択肢に対して、簡潔な解説文を生成してください。

以下の点を守ってください：
- 今回の問題は${sideLabel}目線で解説する。${sideLabel}側を「こちら」、相手側を「相手」として扱う
- 今回の選択肢は${sideMarker}の手である。解説の主語・評価・攻め筋は${sideLabel}側から見たものにする
- ${opponentMarker}側の狙いを説明するときは「相手からの」「相手に」など、相手側の手として書く
- 入出力例は${sideLabel}番の例だけを使用している。反対側の目線や言い回しに引っ張られない
- 読み筋の具体的な手順に言及しながら、なぜその手が良い/悪いのかを説明する
- 1〜3文程度の簡潔な解説にする
- 勝率を参考にして、その手の優劣を伝える
- 正解手は「なぜ良いか」、不正解手は「なぜダメか」を中心に書く
- 将棋ファンに向けた自然な口語調で書く
- 文体は常体（だ・である調）に統一し、「です」「ます」「でしょう」「のようです」などの敬体は使わない
- 文末は「〜である」「〜となる」「〜が有効」「〜が厳しい」などで簡潔に締める
- 符号を解説に入れるときは「△２九飛成」「▲３一角打」のように、先手は▲、後手は△、全角数字＋漢数字＋駒名の形式にすること
- 文頭で「▲５六歩は」「△２九飛成は」のように、選択肢の手を主語にしないこと（局面の狙い・形勢判断から書き始める）
- 「一方的に攻められる」のような強い断定は多用せず、同程度の意味なら「攻めの主導権を握られる」を優先すること
- 断定の強さは勝率差で調整すること（各候補の勝率を比較して判断）:
  - 差が小さい（目安 0〜5%）: 「やや」「少し」「互角に近い」など穏やかな表現
  - 中差（目安 6〜15%）: 「指しにくい」「主導権を握られる」など中程度の表現
  - 大差（目安 16〜30%）: 「悪手寄り」「形勢を損ねる」など強めの表現
  - 極大差（目安 31%以上）: 「敗勢」「決定的」など明確な表現

## 入出力の例

${examplesText}

## 解説のスタイル参考

以下は解説のトーンや語彙、表現の参考例です。このような口調・語彙で書いてください。

${styleExamplesText}

## 今回の問題

局面 (SFEN): ${sfen}
手番: ${sideLabel}

選択肢:
${choicesList}

上記の各選択肢に対して以下のJSON形式で解説を返してください。他の文章は不要です。
[{"index": 0, "explanation": "..."}, {"index": 1, "explanation": "..."}, ...]`;
}

app.post('/api/generate-explanations', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
    return;
  }

  const { sfen, sideToMove, choices } = req.body as {
    sfen?: unknown;
    sideToMove?: unknown;
    choices?: unknown;
  };

  if (typeof sfen !== 'string' || !Array.isArray(choices) || choices.length === 0) {
    res.status(400).json({ error: 'sfen and choices are required' });
    return;
  }
  if (sideToMove !== 'sente' && sideToMove !== 'gote') {
    res.status(400).json({ error: 'sideToMove must be sente or gote' });
    return;
  }

  for (const choice of choices) {
    if (!choice || typeof choice !== 'object' || typeof (choice as ExplanationChoice).label !== 'string') {
      res.status(400).json({ error: 'each choice must have a label' });
      return;
    }
  }

  try {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: buildPrompt(sfen, sideToMove, choices as ExplanationChoice[]) }],
    });

    const text = completion.choices[0]?.message?.content ?? '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      res.status(500).json({ error: 'Failed to parse AI response', raw: text });
      return;
    }

    const explanations = JSON.parse(jsonMatch[0]) as Array<{
      index: number;
      explanation: string;
    }>;

    res.json({ explanations });
  } catch (error: any) {
    console.error('OpenAI API error:', error);
    res.status(500).json({ error: error?.message ?? 'failed to generate explanations' });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`AI explanation server running on http://${HOST}:${PORT}`);
});
