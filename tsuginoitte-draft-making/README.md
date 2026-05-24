# shogi-problem-generator

将棋の定跡DBから問題データを自動生成するMVPです。やねうら王形式の定跡DBを1局面ずつ読み、条件を満たす局面だけを選別し、AobaNNUEで読み筋を取得して、JSON / TSV / SQL を出力できます。`--insert` を付けたときだけ Supabase の `workspaces` テーブルへ insert します。

## セットアップ

Python 3.11以上を想定しています。Windows では PowerShell から実行してください。

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

`.env` を用意します。

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_TABLE=workspaces
```

`SUPABASE_SERVICE_ROLE_KEY` はログに出しません。

Windows で AobaNNUE の AVX2 版が起動しない場合は、SSE4.2 版を試してください。

```powershell
--engine ".\engines\AobaNNUE\AobaNNUE_SSE42.exe"
```

## 実行例

複数の定跡ファイルに対応しています。各 book type ごとに独立した state ファイルと book index ファイルを管理します。

### PetaShock 定跡（user_book1.db）

まず book 全体の位置インデックスを作る例です。

```powershell
python -m src.main `
  --book ".\data\user_book1.db" `
  --book-type petashock `
  --build-book-index
```

dry-run では `outputs/petashock_generated.json`、`outputs/petashock_generated.tsv`、`outputs/petashock_generated_insert.sql` を書き出します。

```powershell
python -m src.main `
  --book ".\data\user_book1.db" `
  --book-type petashock `
  --engine ".\engines\AobaNNUE\AobaNNUE_AVX2.exe" `
  --count 3 `
  --depth 22 `
  --name-prefix "ペタショック_問題" `
  --max-line-moves 12 `
  --min-line-moves 4 `
  --incorrect-selection mixed `
  --dry-run
```

ランダムスキャンモード（事前に `outputs/petashock_book_index.jsonl` を作成）：

```powershell
python -m src.main `
  --book ".\data\user_book1.db" `
  --book-type petashock `
  --engine ".\engines\AobaNNUE\AobaNNUE_AVX2.exe" `
  --count 10 `
  --depth 22 `
  --name-prefix "ペタショック_問題" `
  --max-line-moves 12 `
  --min-line-moves 4 `
  --scan-mode random `
  --state-file ".\outputs\petashock_state.json" `
  --insert
```

### Qhapaq 定跡（standard_book_alora.db）

Qhapaq 定跡は **legal モード**を使用し、合法手から不正解候補を生成します。各 book type で独立した state と book index を管理します。

#### Qhapaq legal モード（推奨）

正解は book 候補から決定し（count が最大のもの）、不正解は root sfen の合法手から生成します：

```powershell
# Book index 作成
python -m src.main `
  --book ".\data\standard_book_alora.db" `
  --book-type qhapaq `
  --build-book-index

# Dry-run (例: min-diff=100, max-diff=600)
python -m src.main `
  --book ".\data\standard_book_alora.db" `
  --book-type qhapaq `
  --engine ".\engines\AobaNNUE\AobaNNUE_AVX2.exe" `
  --count 10 `
  --depth 22 `
  --name-prefix "Qhapaq_問題" `
  --max-line-moves 12 `
  --min-line-moves 4 `
  --incorrect-source legal `
  --incorrect-selection mixed `
  --min-diff 100 `
  --max-diff 600 `
  --scan-mode random `
  --book-index-file ".\outputs\qhapaq_book_index.jsonl" `
  --state-file ".\outputs\qhapaq_state.json" `
  --dry-run

# Insert
python -m src.main `
  --book ".\data\standard_book_alora.db" `
  --book-type qhapaq `
  --engine ".\engines\AobaNNUE\AobaNNUE_AVX2.exe" `
  --count 100 `
  --depth 22 `
  --name-prefix "Qhapaq_問題" `
  --max-line-moves 12 `
  --min-line-moves 4 `
  --incorrect-source legal `
  --incorrect-selection mixed `
  --min-diff 100 `
  --max-diff 600 `
  --batch-size 10 `
  --scan-mode random `
  --book-index-file ".\outputs\qhapaq_book_index.jsonl" `
  --state-file ".\outputs\qhapaq_state.json" `
  --insert
```

#### Qhapaq book モード（従来のbook 候補から選択）

必要に応じて book 候補から選択することもできます：

```powershell
python -m src.main `
  --book ".\data\standard_book_alora.db" `
  --book-type qhapaq `
  --engine ".\engines\AobaNNUE\AobaNNUE_AVX2.exe" `
  --count 10 `
  --depth 22 `
  --name-prefix "Qhapaq_問題" `
  --max-line-moves 12 `
  --min-line-moves 4 `
  --incorrect-source book `
  --incorrect-selection mixed `
  --min-diff 70 `
  --state-file ".\outputs\qhapaq_state.json" `
  --dry-run
```

## CLI オプション

- `--book`: 定跡DBファイルパス
- `--book-type`: 定跡の種類。`petashock` / `qhapaq`。既定は `petashock`
- `--book-index-file`: book index ファイルパス。未指定時は book-type に応じて自動決定（petashock: `outputs/petashock_book_index.jsonl`、qhapaq: `outputs/qhapaq_book_index.jsonl`）
- `--engine`: USIエンジンexeパス。`--build-book-index` 時は不要
- `--count`: 作成する問題数。`--build-book-index` 時は不要
- `--depth`: 1回の解析深さ。既定は22
- `--name-prefix`: workspace name の prefix。問題名は `[R{problemRating}] {name-prefix}_{sequential-number}` の形式で生成されます。例: `[R1600] ペタショック_問題_001`、`[R1500] Qhapaq_問題_202`。`--build-book-index` 時は不要
- `--name-start`: workspace name の連番開始番号。未指定時は state の generatedCount から自動決定
- `--dry-run`: Supabaseに insert せず outputs に出力
- `--insert`: Supabaseに insert
- `--build-book-index`: book index ファイルを作成して終了
- `--scan-mode`: `sequential` / `random`。random は book index を使って未使用の局面をランダム抽出
- `--min-diff`: 正解手と不正解手の最低評価値差。既定は70
- `--incorrect-selection`: 不正解候補の選び方。`top` / `bottom` / `random` / `mixed`。既定は`top`
- `--incorrect-source`: 不正解候補の出所。`book` / `legal`。既定は`book`。qhapaq では通常 `legal` を使用
- `--max-diff`: 不正解候補の最大評価値差。未指定時は上限なし。`--incorrect-source legal` で使用
- `--random-seed`: random scan と不正解候補選択に使う乱数シード。既定は未指定
- `--max-line-moves`: 保存する読み筋の最大手数。既定は12
- `--min-line-moves`: 問題として採用する読み筋の最小手数。既定は4
- `--batch-size`: Supabase insert 時の分割件数。既定は50
- `--state-file`: state ファイルパス。未指定時は book-type に応じて自動決定（petashock: `outputs/petashock_state.json`、qhapaq: `outputs/qhapaq_state.json`）
- `--update-state`: dry-run 時でも state ファイルを更新
- `--limit-scan`: デバッグ用に読む局面数を制限

`--dry-run` と `--insert` の両方がない場合は、安全のため dry-run 扱いです。
`--scan-mode random` では state ファイルの `usedPositionIndexes` を参照し、`lastScannedPositionIndex` は使いません。

## テスト

```powershell
python -m pytest
```

Mac では `.exe` は動かないため、AobaNNUE 本体の実行検証は Windows 側で行ってください。Mac 側では `pytest` とモックエンジンを使った dry-run のみを確認します。

## 補足

- やねうら王形式の `sfen` ブロックをストリーミングで読みます。
- AobaNNUE は 1 回だけ起動して使い回します。
- Windows パスをそのまま扱えるようにしています。
- `--insert` 時の重複 name はスキップしてログ出力します。
