# Babylon.js ステップバイステップ学習プロジェクト

Babylon.js を段階的に学ぶための10ステップの学習プロジェクトです。
各ステップは独立した HTML ファイルで、ブラウザで開くだけで動作します（CDN 利用）。

## はじめかた

```bash
# プロジェクトのルートで簡易サーバーを起動（任意の方法でOK）
cd babylon-js-learning
python3 -m http.server 8000
# ブラウザで http://localhost:8000 にアクセス
```

または `index.html` をブラウザで直接開いてください。

## 学習ステップ

| # | テーマ | 学べること |
|---|--------|-----------|
| 01 | Hello World | 最小構成。Engine / Scene / Camera / Light / Mesh |
| 02 | 基本図形 | Box / Sphere / Cylinder / Plane / Ground の作成 |
| 03 | マテリアルとテクスチャ | StandardMaterial / 色 / テクスチャ画像 |
| 04 | ライティング | 4種類のライト（Hemispheric / Directional / Point / Spot） |
| 05 | カメラ | ArcRotate / Universal / Follow カメラの違い |
| 06 | アニメーション | Animation クラスによるキーフレームアニメーション |
| 07 | 物理エンジン | 重力と衝突判定（Built-in collisions） |
| 08 | ユーザー入力 | キーボード / マウスでオブジェクトを操作 |
| 09 | GUI | ボタン / スライダーで Scene を制御 |
| 10 | ミニゲーム | これまでの集大成：簡単な玉転がしゲーム |

## 推奨学習順

01 → 02 → 03 と順番に進めるのがおすすめです。各ステップの HTML 内のコメントを読みながら、値を変えて挙動の変化を観察してください。

## 参考

- [Babylon.js 公式ドキュメント](https://doc.babylonjs.com/)
- [Babylon.js Playground](https://playground.babylonjs.com/)
