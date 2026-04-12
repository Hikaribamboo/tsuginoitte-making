import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';
import OpenAI from 'openai';
import { ShogiEngine } from './engine.js';
import type { AnalysisLine } from './engine.js';
import type { AnalysisTuning, DepthBenchmarkResult } from './engine.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '8765', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

app.use(cors());
app.use(express.json());

const engine = new ShogiEngine(
  process.env.ENGINE_PATH,
  process.env.EVAL_DIR,
);
let benchRunning = false;

// API routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/evaluate', async (req, res) => {
  try {
    const { sfen, moves = [], depth = 20, nodes, stable = false, searchMoves = [] } = req.body;

    if (!sfen || typeof sfen !== 'string') {
      res.status(400).json({ error: 'sfen is required' });
      return;
    }

    if (!Array.isArray(moves)) {
      res.status(400).json({ error: 'moves must be an array' });
      return;
    }

    if (!Array.isArray(searchMoves)) {
      res.status(400).json({ error: 'searchMoves must be an array' });
      return;
    }

    if (typeof depth !== 'number' || depth < 1 || depth > 40) {
      res.status(400).json({ error: 'depth must be 1-40' });
      return;
    }

    if (nodes !== undefined && (typeof nodes !== 'number' || nodes < 1000 || nodes > 50000000)) {
      res.status(400).json({ error: 'nodes must be 1000-50000000' });
      return;
    }

    if (typeof stable !== 'boolean') {
      res.status(400).json({ error: 'stable must be boolean' });
      return;
    }

    const result = await engine.evaluate(sfen, moves, {
      depth,
      nodes,
      stable,
      searchMoves,
    });
    res.json({
      eval_cp: result.eval_cp,
      pv: result.pv,
      bestmove: result.bestmove,
    });
  } catch (err: any) {
    console.error('Evaluate error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analyze', (req, res) => {
  const sfen = req.query.sfen as string;
  const multipv = parseInt((req.query.multipv as string) ?? '5', 10);

  if (!sfen) {
    res.status(400).json({ error: 'sfen is required' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const handler = (info: AnalysisLine) => {
    res.write(`data: ${JSON.stringify(info)}\n\n`);
  };

  engine.analysisEmitter.on('info', handler);

  try {
    engine.startAnalysis(sfen, [], multipv);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    engine.analysisEmitter.removeListener('info', handler);
    res.end();
    return;
  }

  req.on('close', async () => {
    engine.analysisEmitter.removeListener('info', handler);
    await engine.stopAnalysis();
  });
});

app.post('/api/analyze/stop', async (_req, res) => {
  try {
    await engine.stopAnalysis();
    res.json({ status: 'stopped' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bench/auto', async (req, res) => {
  if (benchRunning) {
    res.status(409).json({ error: 'benchmark is already running' });
    return;
  }

  const {
    sfen,
    moves = [],
    targetDepth = 20,
    timeoutMs = 20000,
    threads = [3, 4, 5, 6],
    hashMb = [1024, 2048],
    pvIntervalMs = [300],
    multipv = 3,
  } = req.body ?? {};

  if (!sfen || typeof sfen !== 'string') {
    res.status(400).json({ error: 'sfen is required' });
    return;
  }
  if (!Array.isArray(moves)) {
    res.status(400).json({ error: 'moves must be an array' });
    return;
  }
  if (typeof targetDepth !== 'number' || targetDepth < 10 || targetDepth > 40) {
    res.status(400).json({ error: 'targetDepth must be 10-40' });
    return;
  }
  if (typeof timeoutMs !== 'number' || timeoutMs < 3000 || timeoutMs > 120000) {
    res.status(400).json({ error: 'timeoutMs must be 3000-120000' });
    return;
  }

  const isIntArray = (arr: unknown, min: number, max: number) =>
    Array.isArray(arr) && arr.every((v) => Number.isInteger(v) && v >= min && v <= max);

  if (!isIntArray(threads, 1, 32)) {
    res.status(400).json({ error: 'threads must be an integer array (1-32)' });
    return;
  }
  if (!isIntArray(hashMb, 16, 32768)) {
    res.status(400).json({ error: 'hashMb must be an integer array (16-32768)' });
    return;
  }
  if (!isIntArray(pvIntervalMs, 50, 5000)) {
    res.status(400).json({ error: 'pvIntervalMs must be an integer array (50-5000)' });
    return;
  }
  if (!Number.isInteger(multipv) || multipv < 1 || multipv > 10) {
    res.status(400).json({ error: 'multipv must be integer (1-10)' });
    return;
  }

  benchRunning = true;
  try {
    const current = engine.getCurrentTuning();
    const candidates: AnalysisTuning[] = [];
    for (const th of threads) {
      for (const hash of hashMb) {
        for (const pvi of pvIntervalMs) {
          candidates.push({
            hashMb: hash,
            threads: th,
            cores: th,
            pvIntervalMs: pvi,
            multipv,
          });
        }
      }
    }

    const results: DepthBenchmarkResult[] = [];
    for (const tuning of candidates) {
      const result = await engine.benchmarkDepthReach({
        sfen,
        moves,
        targetDepth,
        timeoutMs,
        tuning,
      });
      results.push(result);
    }

    const sorted = [...results].sort((a, b) => {
      if (a.reached !== b.reached) return a.reached ? -1 : 1;
      if (a.reached && b.reached) return a.elapsedMs - b.elapsedMs;
      if (a.maxDepth !== b.maxDepth) return b.maxDepth - a.maxDepth;
      return a.elapsedMs - b.elapsedMs;
    });
    const best = sorted[0];
    await engine.configureAnalysisTuning(best.tuning);

    res.json({
      targetDepth,
      timeoutMs,
      tested: candidates.length,
      previous: current,
      best,
      results: sorted,
    });
  } catch (err: any) {
    console.error('Auto bench error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    benchRunning = false;
  }
});

// ---- Generate explanations via Anthropic Claude ----

const FEW_SHOT_EXAMPLES = [
  { label: '△３三金', eval_cp: 1254, eval_percent: 17, line_labels: '▲２二銀不成 △４一玉 ▲３三銀成 △２一飛 ▲２六飛成', explanation: '▲２二銀不成が厳しい。そこに金を逃げても助からない。' },
  { label: '△４六桂打', eval_cp: 893, eval_percent: 25, line_labels: '▲５九玉 △２五歩 ▲２五同歩 △３八桂成', explanation: '特に強い狙いのない手。同飛車なら２三の銀を取れるが，同歩で何もない。' },
  { label: '△３二金', eval_cp: 312, eval_percent: 40, line_labels: '▲２二歩打 △３三飛 ▲２二歩成 △３一玉', explanation: 'シンプルに金取りに同銀とできる形にするのが最善手。少し意外な手だが，意外とこれで耐えている。' },
  { label: '▲９五角打', eval_cp: 513, eval_percent: 66, line_labels: '△９四飛 ▲７三角成 △７三同銀 ▲３四桂', explanation: '83飛には74歩ととって+1080 最善は94飛だが、角成同銀に34桂と打てば相手の飛車は働かず、一方的に攻めれる。' },
  { label: '▲７四歩', eval_cp: 46, eval_percent: 51, line_labels: '△７四同飛 ▲７五歩打 △９四飛 ▲９六歩', explanation: '相手の飛車が自然に良い位置に行くので良くない。' },
  { label: '▲１五歩', eval_cp: 46, eval_percent: 51, line_labels: '', explanation: 'チャンスを逃している' },
  { label: '▲６四歩', eval_cp: -73, eval_percent: 48, line_labels: '△６四同歩 ▲６四同飛車 △９九角成 ▲６五飛', explanation: '同歩が最善だが、同飛車99角成に飛車まわりが絶品。持ち駒は少ないが互角' },
  { label: '▲８八銀', eval_cp: -1003, eval_percent: 22, line_labels: '△３三飛成 ▲２九飛 △２八歩打 ▲２八同飛', explanation: '相手の手は多いが、こちらは持ち駒が少なく手が少ない。' },
  { label: '▲７三飛成', eval_cp: -413, eval_percent: 37, line_labels: '△９五角打 ▲７三同龍 △６四同歩 ▲６三歩成', explanation: '95角と打たれ龍を逃げても99角なりとされ劣勢。' },
  { label: '▲４九金', eval_cp: 723, eval_percent: 71, line_labels: '△３六歩打 ▲９六角打 △３七桂打 ▲９六同飛', explanation: '悪くはないが、なんの為に将棋を指しているのか分からない。' },
  { label: '▲７四香', eval_cp: 1616, eval_percent: 88, line_labels: '△７四同飛 ▲８三龍 △７四香打 ▲２五歩', explanation: '飛車を逃げると44桂打ちが激痛 詰めろなので香車を取る一択だが、冷静に同銀と取られて下手よし。' },
  { label: '▲７二歩打', eval_cp: 1022, eval_percent: 78, line_labels: '△８一玉 ▲７三桂打 △６二金 ▲７二角打', explanation: '次善手だが、駒を大量に渡してしまうので実践的には危うい。' },
];

// Additional style reference explanations for tone/vocabulary learning
const STYLE_EXAMPLES: string[] = [
  '飛車を取っても敵陣に打つ場所がないので疑問手。',
  '玉頭の歩を伸ばすのが好手。どんどん桂跳ねや銀交換をして攻めをつなぐことができる。',
  '勝勢の局面で自玉頭を弱くする必要がない。',
  '83飛には74歩ととって+1080 最善は94飛だが、角成同銀に34桂と打てば相手の飛車は働かず、一方的に攻めれる。',
  '相手の飛車が自然に良い位置に行くので良くない。',
  'チャンスを逃している',
  '△７八桂成で角が詰み，△１五香からの王手金取りが痛い。',
  '金取りは無視して良い。左側の広さを生かしつつ豊富な持ち駒で攻めれば優勢。',
  '角を取られると△１五香からの王手金取りが痛い。',
  '相手玉は左側を受けづらいが、右側がまだ広い。',
  '相手の△２九飛成が先手となり悪手。',
  '銀と角を捨ててでも自玉を安全にする。どんどん自玉を固め大優勢になる。',
  '桂馬で相手玉を圧迫しつつ金を狙う。相手は金を逃げると狭くなる。',
  '相手の大駒である飛車から逃げる一手だが，自玉の左側は全く安全ではない。▲３七歩成を受けるのが難しいため悪手。',
  '飛車に当てつつ相手の玉を狙っているが，相手は意外と広い。',
  '自玉を固くする一手だが，角銀両取りを狙った相手の桂跳ねの味が良い。六５の地点を継続的に攻められて悪くなる。',
  'ここは相手の弱点の玉頭を狙うのが好手。',
  '相手が桂馬を打つ場所を自ら作りに行く手で悪手。',
  'シンプルに金取りに同銀とできる形にするのが最善手。少し意外な手だが，意外とこれで耐えている。',
  '特に強い狙いのない手。同飛車なら２三の銀を取れるが，同歩で何もない。',
  '▲２二銀不成が厳しい。そこに金を逃げても助からない。',
  '銀が玉頭から離れ少し左側が薄くなる。完封を目指すには甘い手。',
  '相手の玉頭に角を通す筋が抜群に良い。',
  '桂馬がはねて勢いがあるが，角道が止まってしまい自玉も狭くなるため疑問手。',
  '△２八桂成とされ飛車を走られて十字飛車をくらう。',
  '香取りは受けがないので４五の桂馬を自分から精算しに行くのが好手。',
  '相手の端は弱点ではないのでスジが悪い。',
  'たらしの歩が厳しい。次に打ち込む銀を取られても取られなくても相手は歩成りが受けられない。',
  '角を直接打ち込むのは少し重たい。1000点悪くして敗勢となる。',
  '歩を回収されて終わる。',
  '飛車先を通しておく',
  '角出の時２五に飛車を引けないため飛車を止められ攻めが重くなる',
  '馬と飛車の交換では相手が得をする。相手玉が広くなり飛車打ちには強い陣形となる。',
  '馬を引くと相手玉を固められ、攻めもうるさくて不利となる。',
  '歩成から桂馬を捕まえられるのを読み切れば踏み込める。',
  '相手の角は意外と広く，銀を打つのは勿体無い。一歩取られてしまう。',
  '棒銀を狙っているが，攻めが重たく相手にされない。相手の角の位置が良いので先行して攻められる。',
  '持ち駒に香があるため相手の飛車は捕まっている。落ち着いて捕まえに行く。',
  '攻防の角となっているが８四の地点にコマを足しても強い攻めにならない。',
  '先に銀の頭に歩を打つ手が好手。',
  '先手を取られ▲２二歩が後の▲３一角打を狙った手で厳しい。',
  '自分の銀をどかして桂馬を捕まえに行ってよい。銀交換して相手からの△３八銀打は問題ない。',
  '相手の８筋からの攻めが少しうるさくなる。',
  '先手を取られて△２七金とされると一気に厳しくなる。',
  '△１六桂に▲同角とできないので角を打った意味があまりない。香取りは変に受けない方が良い。',
  'ただ銀を交換しても相手は厳しくない。',
  '先に歩を打つが、相手の銀がくっつきいい形になってしまう。',
  '自玉がかなり危険になる。',
  '馬を切っても持ち駒が豊富なため攻めがつながる。相手は浮きゴマが多く、大ゴマを捨てられない。',
  '両取りの桂馬を打たれて後手ペースとなる。',
  '▲２三歩と垂らすのが相手の弱点。△同金には▲４二桂馬成が厳しく，放置すると相手の金が捕まっている。',
  '相手の大駒を狙に行くが，△同飛車とされて飛車を３筋に回られ大悪手となる。',
  '飛車を逃げると44桂打ちが激痛 詰めろなので香車を取る一択だが、冷静に同銀と取られて下手よし。',
  '悪くはないが、なんの為に将棋を指しているのか分からない。',
  '次善手だが、駒を大量に渡してしまうので実践的には危うい。',
  '少し悪いが飛車角交換をして攻めるのが最善手。',
  '桂馬を取られて▲５三桂打が厳しく後手敗勢。',
  '相手の角が狭いので誘導し技をかける。形勢は互角。',
  '先手の角と飛車の位置が良いため，角出を無視すると攻めがうるさい。',
  '桂打から一見危なく見えるが、相手玉は詰まない。',
  '同歩が最善だが、同飛車99角成に飛車まわりが絶品。持ち駒は少ないが互角',
  '95角と打たれ龍を逃げても99角なりとされ劣勢。',
  '相手の手は多いが、こちらは持ち駒が少なく手が少ない。',
  '銀をとられても２六の金を取る手の筋が抜群で先手大優勢。',
  '４五の角が相手の飛車を見ているため、銀をどかしてからの▲５五歩をとれず相手が厳しい。',
  '次の▲２五桂をねらっているが、そこまで厳しい攻めにならない。',
  '自玉の右側が狭いので左に逃げたくなるが、馬に左側も制圧されてしまう。',
  '左右から攻める心意気は良いが，緩手のため無視される。',
  '相手の端が弱いのは確かだが，相手玉に逃げ道がある盤面では少し重たい攻め。',
  'ここは急がず確実な弱点である端を攻める。',
  '５筋のコマの数が負けており，角も詰まされてしまうため厳しくなる。',
  '一手パスすると飛車や桂馬を足され５筋が厳しくなる。',
  '５筋にコマを足し飛車回りに備える好手。',
  '相手の△２九飛成が先手となり悪手。',
  '△６一銀で守られるためここでは緩手。',
  '角を切られて相手が一気に固くなる。',
  '自玉が固くみえるが，意外と弱い。△４五桂打と△５七角成の両方を消す一手。',
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

  // Validate choices structure
  for (const c of choices) {
    if (!c.label || typeof c.label !== 'string') {
      res.status(400).json({ error: 'each choice must have a label' });
      return;
    }
  }

  const examplesText = FEW_SHOT_EXAMPLES.map(
    (ex) =>
      `指し手: ${ex.label} | 評価値: ${ex.eval_cp}cp (${ex.eval_percent}%) | 読み筋: ${ex.line_labels || 'なし'}\n解説: ${ex.explanation}`,
  ).join('\n\n');

  const choicesList = choices
    .map(
      (c: any, i: number) =>
        `${i + 1}. 指し手: ${c.label} | 評価値: ${c.eval_cp ?? '不明'}cp (${c.eval_percent ?? '不明'}%) | 読み筋: ${c.line_labels || 'なし'}${c.is_correct ? ' [正解手]' : ''}`,
    )
    .join('\n');

  const sideLabel = sideToMove === 'sente' ? '先手' : '後手';

  const styleExamplesText = STYLE_EXAMPLES.map((ex, i) => `${i + 1}. ${ex}`).join('\n');

  const prompt = `あなたは将棋の解説者です。次の一手問題の各選択肢に対して、簡潔な解説文を生成してください。

以下の点を守ってください：
- 読み筋の具体的な手順に言及しながら、なぜその手が良い/悪いのかを説明する
- 1〜3文程度の簡潔な解説にする
- 評価値や勝率も参考にして、その手の優劣を伝える
- 正解手は「なぜ良いか」、不正解手は「なぜダメか」を中心に書く
- 将棋ファンに向けた自然な口語調で書く
- 文体は常体（だ・である調）に統一し、「です」「ます」「でしょう」「のようです」などの敬体は使わない
- 文末は「〜である」「〜となる」「〜が有効」「〜が厳しい」などで簡潔に締める
- 符号を解説に入れるときは「△２九飛成」「▲３一角打」のように、先手は▲、後手は△、全角数字＋漢数字＋駒名の形式にすること
- 文頭で「▲５六歩は」「△２九飛成は」のように、選択肢の手を主語にしないこと（局面の狙い・形勢判断から書き始める）
- 「一方的に攻められる」のような強い断定は多用せず、同程度の意味なら「攻めの主導権を握られる」を優先すること
- 断定の強さは評価値差で調整すること（各候補の評価値を比較して判断）:
  - 差が小さい（目安 0〜150cp）: 「やや」「少し」「互角に近い」など穏やかな表現
  - 中差（目安 151〜400cp）: 「指しにくい」「主導権を握られる」など中程度の表現
  - 大差（目安 401〜900cp）: 「悪手寄り」「形勢を損ねる」など強めの表現
  - 極大差（目安 901cp以上）: 「敗勢」「決定的」など明確な表現

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

  try {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = completion.choices[0]?.message?.content ?? '';

    // Extract JSON array from the response
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
  } catch (err: any) {
    console.error('OpenAI API error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve built frontend (web/dist) if available — for ngrok / production sharing.
const distDir = path.resolve(import.meta.dirname, '..', '..', 'web', 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback: any non-API route → index.html
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
  console.log(`Serving frontend from ${distDir}`);
}

// Start server after engine is ready
async function main() {
  try {
    await engine.start();
    app.listen(PORT, HOST, () => {
      console.log(`Engine API server running on http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start engine:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log('Shutting down...');
  engine.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  engine.stop();
  process.exit(0);
});

main();