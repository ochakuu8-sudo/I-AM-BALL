# Rolling Town — 坂道の街

Blenderで作った住宅街をボールで自由に走る、PC・スマートフォン向けのThree.js試作です。
公開URL: https://ochakuu8-sudo.github.io/I-AM-BALL/

リポジトリ: https://github.com/ochakuu8-sudo/I-AM-BALL

## 操作

| 操作 | PC | スマートフォン |
| --- | --- | --- |
| 移動 | WASD / 方向キー | 左のスティック |
| ジャンプ | Space | JUMP |
| ブレーキ | Shiftを押し続ける | BRAKEを押し続ける |
| スタート地点に戻る | R / 右上のリセット | 右上のリセット |
| 一時停止 | P / 右上の一時停止 | 右上の一時停止 |

画面の上方向が坂の下です。画面から離れると自動で一時停止します。縦画面にも対応し、横画面では街を広く見渡せます。
音は初期状態でオフ。音ボタンでジャンプ音を有効にできます。

## 試作の構成

- **TypeScript + Three.js**: 街・ボール・影・追従カメラを描画。
- **Rapier**: 球、坂、家、車、ジャンプ台、動く木箱・コーンの当たり判定。1/60秒固定更新と描画補間。
- **React + Vite**: 画面上の操作パネルと静的ビルド・プレビュー環境。ゲーム本体はクライアントで動作し、ゲーム用バックエンドは不要。
- 配布時は`dist/client`へHTML・JavaScript・GLBを静的出力します。Three.jsと物理処理は`lib/town`に独立させています。
- **Blender 5.2**: 屋根・窓枠・玄関・バルコニー・雨どいなどをモデリング。家の3色の派生から14棟の街区を構成。

球には慣性を残しつつ、加速・旋回を補助しています。カメラの方角を固定することで、ボールの回転に視点が振り回されず、スティックの方向を覚えやすくしています。
建物の当たり判定は簡略化した箱です。装飾の各部には細かな当たり判定を付けていません。

配色は黄・青・コーラルの家、青や赤の屋根、鮮やかな植栽で構成しています。道路は彩度を抑え、赤と白のボールが見つけやすいようにしています。Blenderの色指定はsRGBからリニア値へ変換して書き出し、ブラウザでは白飛びと過度な霧を抑えています。モデルの内容から読み込みURLのバージョンを生成し、更新後に古い色のモデルがキャッシュから残りにくくしています。

## 起動と確認

Node.js 22.13以降とnpmを使用します。

```sh
npm ci
npm run dev -- --host 0.0.0.0
```

表示されたlocalhost URLを開きます。同じLANのスマートフォンではPCのLAN IPアドレスと同じポートを使用します。

```sh
npm run test:physics
npm run lint:game
npx tsc --noEmit
npm run build
```

`scripts/test-physics.mjs`は、坂の接地・加速旋回ブレーキ・ジャンプ・ジャンプ入力の先行受付・高速での家との衝突・木箱・ジャンプ台・リセット・描画頻度の違いを9シナリオで確認します。数値結果は`art/physics-report.json`に保存されます。
ブラウザのWebMCP対応環境では、状態取得・一時停止/再開・リセットも利用できます。未対応環境でもゲームは動作します。

## GitHub Pagesへの公開

`main`にpushすると、GitHub Actionsが型検査・ゲーム部分のlint・物理テスト・静的ビルドを実行し、成功した出力だけをGitHub Pagesに公開します。手動実行はActionsの「Deploy GitHub Pages」から行えます。

ワークフローは`.github/workflows/pages.yml`です。配信ファイルは`dist/client`、ビルド時の`PAGES_BASE_PATH`は`/I-AM-BALL`です。ローカル開発ではこの環境変数を指定せず、ルートURLから動作します。

GitHubリポジトリのSettings → Pages → Build and deploymentは「GitHub Actions」を使用します。追加のサービス用APIキーは不要です。

## Blenderとアセット

| ファイル | 内容 |
| --- | --- |
| `art/hillside-house.blend` | 編集できる家のBlenderシーン |
| `art/rolling-town.blend` | 街全体のBlenderシーン |
| `art/hillside-house.png` | 家のBlenderレンダリング |
| `art/town-overview.png` | 街全体のBlenderレンダリング |
| `art/build_town.py` | 家・街・小物を生成し、GLBを出力するスクリプト |
| `public/models/town.glb` | ゲームが読み込む街。材質単位にまとめた30メッシュ |
| `public/models/house.glb` | 家単体のモデル |
| `public/models/colliders.json` | 地形・建物・車・小物の物理配置 |
| `lib/town/simulation.ts` | 物理、加速、旋回、ジャンプの調整値 |
| `lib/town/game.ts` | Three.js描画とカメラ |

```sh
blender --background --factory-startup --python art/build_town.py
```

Blender実行ファイルがPATHにない場合は、その絶対パスを指定します。実行すると上記モデル・Blenderシーン・確認用画像を再生成します。
家の画像はBlenderのレンダリングであり、ブラウザ画面のスクリーンショットではありません。

## 現時点で評価できること・次に必要なこと

走行、坂、ジャンプ、追従カメラ、建物の立体感を試せます。住宅は細部まで作っていますが、街全体には同じ家の反復が目立ち、塊魂のような日常品の密度や驚きはまだ足りません。次は店舗・公園・路地など、走って見分けられる場所を足す方が効果的です。

破壊、報酬、お金、エリア解放は今回の実装範囲に含めていません。CrazyGames SDK、広告、セーブ、英語UIへの全面切り替え、投稿用パッケージも今後の工程です。
初期ロードを抑えるためテクスチャ画像を使わず材質色で構成し、スマホでは描画解像度を制限しています。街GLBは約9.3MBです。スマートフォン実機のFPS、発熱、Safariでの操作感は未測定です。

検証記録: TypeScript型検査、ゲーム部分のlint、物理の9シナリオ、HTTP経由での初期ページとアセット配信を確認。WebMCPの3ツールは対応ブラウザで正しい状態変化・不正入力の拒否・状態の読み戻しを確認。画面を操作するブラウザテストや実機テストは未実施です。雛形に含まれる未使用のUI部品には既存のlint指摘が残っています。
