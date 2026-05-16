#!/usr/bin/env node
/**
 * Extract high-quality explanation examples from training data
 * Usage: node extract-examples.js
 */

// 提供されたデータを貼り付けて処理
const rawData = [
  {"idx":0,"problem_id":206,"choice_id":3,"usi":"3b2b","label":"△２二玉","eval":null,"explanation":"▲5四角打に備えてあらかじめ玉を逃げている。歩を突かれ，陣形を乱される。","line":["3e3d","4c3d","4e4d","3c4d","6h7g","4b3c","P*3b","P*4b","1f1e","1d1e","4g4f","6d6e"],"eval_cp":304,"eval_percent":41},
  {"idx":1,"problem_id":206,"choice_id":2,"usi":"P*5c","label":"△５三歩打","eval":null,"explanation":"将来的な▲5四角打を警戒した手。玉頭に迫る歩を取り返す時に4三の銀を動かせないのを打開する。","line":["6h7g","4d4e","1f1e","1d1e","4g3f","N*4d","5e5d","5c5d","5f5e","B*5f","2i5i","P*7e"],"eval_cp":170,"eval_percent":45},
  {"idx":2,"problem_id":206,"choice_id":1,"usi":"4b5c","label":"△５三金","eval":null,"explanation":"5四の地点に効かせる手で悪くないが，せっかく固い玉が少し薄くなり残念。","line":["3e3d","3c3d","6h7g","4d4e","4g5f","N*4d","5e5d","5c5d","5f5e","B*5f","2i5i","P*7e"],"eval_cp":252,"eval_percent":42},
  {"idx":4,"problem_id":205,"choice_id":1,"usi":"P*7b","label":"△７二歩打","eval":null,"explanation":"これは後に8三や6三などに金を逃げた時に▲７二角打を喰らわないようにしている。","line":["8i7g","3b4b","2e2d","2c2d","3f3e","3d3e","P*3f","3e3f","4g3f","P*3d","P*3e","3d3e"],"eval_cp":83,"eval_percent":47},
  {"idx":12,"problem_id":202,"choice_id":1,"usi":"8d7d","label":"△７四金","eval":null,"explanation":"相手に歩がないのがポイント。飛車先を通しつつ，歩成を促す。飛車にと金が当たるが，△8四飛がぴったりで，銀を守るために▲8七金には△8三飛で次に△8六歩打を狙った手が抜群に厳しい。","line":["7c7b+","8a8f","7b6b","8f7f","6b6c","7f6f","B*6a","4c3b","6c5b","4b4c","6a8c+","5d6c"],"eval_cp":175,"eval_percent":45},
  {"idx":24,"problem_id":191,"choice_id":3,"usi":"8a6a","label":"△６一飛","eval":null,"explanation":"相手の攻めを急かして角を手に入れる。飛車銀両取りをかけられるが無視。陣形は飛車に強い形。拠点と持ち駒を使って一気に攻め込む","line":["6b7c+","7b7c","G*7b","8i8h","7h8h","B*9b","7b6a","9b5f","2i5i","P*5h","5i5h","S*4g"],"eval_cp":65,"eval_percent":48},
  {"idx":30,"problem_id":189,"choice_id":3,"usi":"P*7f","label":"△７六歩打","eval":null,"explanation":"桂馬が跳ねると自分の金に当たってしまい一見良くない攻めに見える。しかし，手順に自分の桂馬を跳ねることができ，７六の拠点を永久に残し続けることができる。自玉が広いからできる攻め。","line":["7g8e","7c8d","P*8b","8a7a","7e8d","7b8d","B*6b","S*7g","6h5i","7a6a","6b8d+","7g7h"],"eval_cp":78,"eval_percent":48},
  {"idx":35,"problem_id":188,"choice_id":1,"usi":"2f6b","label":"△６二角","eval":null,"explanation":"少しの差で△６二角が最善手。角を自分から交換すると相手の金が玉に自然に近づいてしまい相手の駒のバランスが良くなるという意味合いがある。","line":["P*2f","2e3f","4g3f","2a3c","2i2g","9d9e","6g7e","6c7d","2f2e","2d2e","3f2e","P*2f"],"eval_cp":163,"eval_percent":45},
  {"idx":45,"problem_id":180,"choice_id":3,"usi":"4b5b","label":"△５二金","eval":null,"explanation":"守っているように見えて遊んでいる42の金を連結させた手。\nこれ以外の手は攻め潰される。","line":["5e5d","6c5d","8b8c+","B*6c","N*5e","B*7f","N*6g","5d5e","5f5e","P*5g","5h4g","S*7b"],"eval_cp":142,"eval_percent":46},
  {"idx":48,"problem_id":179,"choice_id":2,"usi":"P*8f","label":"▲８六歩打","eval":null,"explanation":"後の88歩に対し97桂、85桂と飛ぶ為の土台になっている。\n88歩がなければ先手も満足な展開。","line":["7b6c","5g5f","5e5f","6g5f","P*5d","P*7f","N*5e","4g5h","7e7f","7g7f","8a8f","P*7e"],"eval_cp":121,"eval_percent":54},
  {"idx":51,"problem_id":176,"choice_id":1,"usi":"7h8g","label":"▲８七金","eval":null,"explanation":"87金が好手。玉がいる為78飛成はできず、79角打も29の飛車が効いており同飛と取られてしまう。なので75か74に逃げるしかないが、75飛には金で追われ、74飛には同馬同金で勝勢。後の飛車打ちや79飛が痛く先手が一方的に攻める展開になる。","line":["7f7e","8g8f","7e7d","N*7e","B*9b","7e6c+","5c6c","6f6e","6c5b","2i7i","7d7i+","6h7i"],"eval_cp":1068,"eval_percent":79},
  {"idx":62,"problem_id":172,"choice_id":1,"usi":"P*5d","label":"▲５四歩打","eval":null,"explanation":"ダンスの歩。△同金には▲５四歩→△５二金→▲６三歩成でなんと金がつかまっている。なので相手は△同金と取るしかない。","line":["6c6d","5e6d","1d1e","P*4c","4b4c","G*6a","1e1f","6a6b","8h7h","S*5b","1f1g+","2h3i"],"eval_cp":512,"eval_percent":65},
  {"idx":71,"problem_id":169,"choice_id":2,"usi":"5e2b+","label":"▲２二角成","eval":null,"explanation":"△同玉は▲６六角打で王手飛車，△同金は▲３一金打ちで割打ちの銀＋王手飛車の筋があるのでほぼ勝ち。","line":["3a2b","S*3a","B*5g","6h6g","5g3i+","4i3i","8d8b","6g6d","G*5a","3a4b+","8b4b","6d8d"],"eval_cp":1586,"eval_percent":88},
  {"idx":78,"problem_id":164,"choice_id":2,"usi":"B*4g","label":"▲４七角打","eval":null,"explanation":"後手からの△６五歩を防ぎつつ、△４七銀打も防いでいる。相手の桂頭を睨んでおり、将来的に桂頭攻めも期待できる。更に自分の桂頭も守っている一石四鳥の美しい手。","line":["4c4d","6h7i","5b4c","7i8h","4c5c","8h7i","5c5d","4g3h","5d5c","3h4g"],"eval_cp":-2,"eval_percent":50},
  {"idx":82,"problem_id":162,"choice_id":2,"usi":"2a3c","label":"△３三桂","eval":null,"explanation":"▲２三角打には２一飛で後手勝勢。▲２三歩打には△２一歩打で我慢すればどの変化も互角です。なので△３五歩に期待して桂馬を跳ねましょう。跳ねるときっといい事があります。","line":["2d2i","5d5e","5f6g","P*2h","2i2h","3d3e","3f3e","4d3e","B*1g","3e4d","2h2g","B*2c"],"eval_cp":0,"eval_percent":50},
  {"idx":94,"problem_id":155,"choice_id":1,"usi":"3b8g+","label":"△８七角成","eval":null,"explanation":"すべて交換した後に王手飛車をかけられるわかりやすい好手。相手の陣形が打ち込みに弱い形なので迷いなく交換できる。相手が△３六飛としたところに目をつけられるか。","line":["8h8g","8d8g+","7h8g","B*5d","8g7h","5d3f","P*4g","3f2g+","4i5i","2g5d","4f5e","5d4c"],"eval_cp":-254,"eval_percent":58},
  {"idx":111,"problem_id":148,"choice_id":2,"usi":"3f3g+","label":"△３七歩成","eval":null,"explanation":"▲３五銀を打ち飛車が逃げた後に桂馬をとるねらいがある。しかし，桂馬をとると▲５五角と打って銀香両取りがかかるため相手は桂馬をとれない。","line":["2i3g","S*3e","2f2e","3e4f","2e4e","B*2d","P*2e","4c4d","4e4d","3b4c","4d4c+","4f5g"],"eval_cp":130,"eval_percent":46},
  {"idx":154,"problem_id":123,"choice_id":3,"usi":"8f6d","label":"▲６四角","eval":null,"explanation":"銀を取った手が飛車に当たるので相手は無視できない。最後に▲６四飛とした手が銀取りと飛車なりの両狙いがあり，狭かったこちらの飛車が大活躍する。","line":["8b7b","6d5e","4c4d","3d3e","3c2d","S*3b","4a4b","3b2a+","2d3e"],"eval_cp":1581,"eval_percent":88},
  {"idx":157,"problem_id":120,"choice_id":2,"usi":"P*5c","label":"▲５三歩打","eval":null,"explanation":"と金や銀で突っ込むと精算されて相手の方がスッキリしてしまう。ここは攻め急ぐのをじっと我慢して歩を垂らすのが好手。","line":["3d3e","5c5b+","3e3f","5b4b","4c4b","6c5c","3f3g+","4g3g","7a5c","6d5c","4b5c","B*9g"],"eval_cp":853,"eval_percent":74},
];

// 評価値差でグループ分けして、各グループから代表例を選ぶ
const categorized = {
  small: [],     // 0-150cp
  medium: [],    // 151-400cp  
  large: [],     // 401-900cp
  extreme: [],   // 901cp以上
};

rawData.forEach(item => {
  if (!item.eval_cp) return;
  const cp = Math.abs(item.eval_cp);
  
  if (cp <= 150) categorized.small.push(item);
  else if (cp <= 400) categorized.medium.push(item);
  else if (cp <= 900) categorized.large.push(item);
  else categorized.extreme.push(item);
});

// 各カテゴリから複数例を選ぶ
const selected = [];

// 小差の例（3-4個）
categorized.small.slice(0, 4).forEach(item => {
  selected.push(item);
});

// 中差の例（4-5個）
categorized.medium.slice(0, 5).forEach(item => {
  selected.push(item);
});

// 大差の例（3-4個）
categorized.large.slice(0, 4).forEach(item => {
  selected.push(item);
});

// 極大差の例（3-4個）
categorized.extreme.slice(0, 4).forEach(item => {
  selected.push(item);
});

// ソートして出力
const sorted = selected.sort((a, b) => Math.abs(a.eval_cp) - Math.abs(b.eval_cp));

console.log('// ユーザー提供データから抽出した高品質な解説例');
console.log('const FEW_SHOT_EXAMPLES = [');
sorted.forEach((item, idx) => {
  const isCorrect = idx % 3 === 0;
  const symbol = isCorrect ? '△' : '▲';
  const lineLabels = item.line ? item.line.slice(0, 5).join(' ') : 'なし';
  
  console.log(`  { label: '${item.label}', eval_cp: ${item.eval_cp}, eval_percent: ${item.eval_percent}, line_labels: '${lineLabels}', explanation: '${item.explanation.replace(/'/g, "\\'")}' },`);
});
console.log('];');
