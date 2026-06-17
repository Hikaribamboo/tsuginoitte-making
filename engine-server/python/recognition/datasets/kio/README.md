# 棋桜 画像認識データセット

棋桜の対局スクリーンショット専用モデル用の教師データ置き場です。

## 入れる場所

- `raw/`: 元スクリーンショット。例: `001.png`, `002.png`
- `labels/`: 同じ ID の正解 SFEN。例: `001.sfen`, `002.sfen`
- `metadata/`: 盤面の切り出し設定。全スクショで同じ描画位置なら `001.json` を基準にして一括適用します。

`labels/*.sfen` は局面だけでも、通常の SFEN でも構いません。

```text
lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1
```

## 最初に調整するファイル

`metadata/001.json` の `cropRect` を、棋桜スクショ内の盤面を囲む矩形に合わせてください。

添付画像と同じ 945x2048 系のスクショなら初期値は近いはずですが、必ずプレビューで確認してください。

```bash
cd engine-server/python/recognition
python scripts/preview_crop_rect.py --dataset-root datasets/kio --id 001
```

出力:

- `datasets/kio/reports/001_crop_rect_preview.png`

## 教師データ生成

例として `001.png` から `050.png` まで入れた場合:

```bash
cd engine-server/python/recognition
python scripts/build_dataset_batch.py --dataset-root datasets/kio --from-id 001 --to-id 050 --source-id 001
```

生成される主なファイル:

- `board_crops/`: 盤面だけに切り出した画像
- `cells/`: 81マスを駒クラス別に切り出した学習画像
- `manifests/cells.csv`: 学習用 manifest
- `reports/*_cells_preview.png`: ラベルと切り出しの確認画像

## 学習

```bash
cd engine-server/python/recognition
python scripts/train_classifier.py \
  --dataset-root datasets/kio \
  --output-model models/resnet18_shogi_piece_classifier_kio.pt \
  --epochs 20
```

フロントの「画像から局面作成」で「棋桜」を選ぶと、このモデルを使います。

## 推論だけ試す

```bash
cd engine-server/python/recognition
python scripts/predict_sfen.py \
  --dataset-root datasets/kio \
  --image datasets/kio/raw/001.png \
  --model models/resnet18_shogi_piece_classifier_kio.pt \
  --fallback-source-id 001 \
  --write-artifacts
```
