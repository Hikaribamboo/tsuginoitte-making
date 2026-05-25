import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import OpenAI from 'openai';

const app = express();
const PORT = parseInt(process.env.PORT ?? '8766', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const FEW_SHOT_EXAMPLES = [
  {
    label: '△３三金',
    eval_cp: 1254,
    eval_percent: 17,
    line_labels: '▲２二銀不成 △４一玉 ▲３三銀成',
    explanation: '▲２二銀不成が厳しい。金を逃げても助からない。',
  },
  {
    label: '▲７四歩',
    eval_cp: 46,
    eval_percent: 51,
    line_labels: '△７四同飛 ▲７五歩打',
    explanation: '相手の飛車が自然に良い位置に行くので良くない。',
  },
  {
    label: '▲５四歩打',
    eval_cp: 512,
    eval_percent: 65,
    line_labels: '▲６四歩 ▲６三歩成',
    explanation: 'ダンスの歩。△同金には歩を垂らすのが厳しい。',
  },
];

app.post('/api/generate-explanations', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
    return;
  }

  const { sfen, sideToMove, choices } = req.body;
  if (!sfen || !Array.isArray(choices) || choices.length === 0) {
    res.status(400).json({ error: 'sfen and choices are required' });
    return;
  }

  for (const choice of choices) {
    if (!choice || typeof choice.label !== 'string') {
      res.status(400).json({ error: 'each choice must have a label' });
      return;
    }
  }

  const client = new OpenAI({ apiKey });
  const examplesText = FEW_SHOT_EXAMPLES.map(
    (example) =>
      `指し手: ${example.label} | 評価値: ${example.eval_cp}cp (${example.eval_percent}%) | 読み筋: ${example.line_labels}\n解説: ${example.explanation}`,
  ).join('\n\n');

  const choicesList = choices
    .map(
      (choice: any, index: number) =>
        `${index + 1}. 指し手: ${choice.label} | 評価値: ${choice.eval_cp ?? '不明'}cp (${choice.eval_percent ?? '不明'}%)${choice.is_correct ? ' [正解手]' : ''}`,
    )
    .join('\n');

  const prompt = `あなたは将棋の一手問題の解説者です。2文以内で各選択肢を説明してください。

### 例
${examplesText}

### 局面
SFEN: ${sfen}
手番: ${sideToMove === 'sente' ? '先手' : '後手'}

### 選択肢
${choicesList}

JSON配列のみを返すこと。形式: [{"index":0,"explanation":"..."}]`;

  try {
    const completion = await client.chat.completions.create({
      model: 'o1-2024-12-17',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = completion.choices[0]?.message?.content ?? '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      res.status(500).json({ error: 'Failed to parse AI response', raw: text });
      return;
    }

    const explanations = JSON.parse(jsonMatch[0]) as Array<{ index: number; explanation: string }>;
    res.json({
      explanations: explanations.map((item) => ({
        ...item,
        explanation: item.explanation.startsWith('【AI解説】')
          ? item.explanation
          : `【AI解説】${item.explanation}`,
      })),
    });
  } catch (error: any) {
    console.error('OpenAI API error:', error);
    res.status(500).json({ error: error?.message ?? 'failed to generate explanations' });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`AI explanation server running on http://${HOST}:${PORT}`);
});
