# Features

## book-problem-generation

Book filesから問題を作る機能です。Python book-maker を起動するジョブサービスと、book index/problem builder 関連のコードだけを置きます。

## kif-problem-generation

`kifus` テーブルの棋譜から次の一手問題を作る機能です。棋譜生成や self-play はここに置かず、問題候補の scan、選択肢生成、評価値変換、`review_next_move_*` への登録処理だけを置きます。

## kifs-generation

`making_base_positions` の active な base position から self-play で棋譜を生成し、`kifus` への挿入データを作る機能です。base positions loader、self-play 設定、self-play runner、kifu insert row builder はここに置きます。

## recognition

画像から将棋盤面を推論して SFEN に変換する機能です。Python recognition project への bridge と API 用 service を置きます。
