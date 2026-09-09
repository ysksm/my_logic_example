# mindmap-tool

話した内容(発話テキスト)をAIでマインドマップ構造(YAML)にまとめ、WebページでSVGマインドマップとして表示・編集・書き出しできるツール。Bun + TypeScript 製。

## シナリオ

1. ユーザーが考えていることを話す(ブラウザの音声入力、またはテキスト入力)
2. AI(Claude)が発話を整理し、カスケード構造のYAMLを生成する
3. YAMLをもとにSVGマインドマップを描画する
4. YAMLは手で編集して再描画でき、スタンドアロンHTMLとして書き出せる
5. 追加で話すと、既存マップに追記する形でAIが更新する(インクリメンタル更新)

## アーキテクチャ

```
ブラウザ (public/index.html)
  ├─ 音声入力: Web Speech API (ja-JP, Chrome推奨)
  ├─ テキスト入力 / YAML編集
  └─ fetch ──→ Bun HTTPサーバー (src/server.ts)
                 ├─ POST /api/generate  発話テキスト(+既存YAML) → Claude API → YAML + SVG
                 ├─ POST /api/preview   YAML → SVG
                 ├─ POST /api/export    YAML → スタンドアロンHTML
                 ├─ GET  /api/maps      保存済み一覧
                 └─ GET/PUT /api/maps/:name  data/*.yaml の読み書き
```

| モジュール | 役割 |
|---|---|
| `src/types.ts` | `MindMap` / `MindMapNode` 型定義 |
| `src/mindmap-yaml.ts` | YAMLの解析・スキーマ検証・シリアライズ |
| `src/ai.ts` | Claude API(`claude-opus-5`)で発話→YAML生成。APIキー無し時は文分割のフォールバック |
| `src/layout.ts` | ツリーレイアウト計算(左→右)とSVG描画 |
| `src/render.ts` | スタンドアロンHTML生成 |
| `src/server.ts` | Bun.serve によるHTTP API + 静的配信 |
| `src/cli.ts` | CLI: YAML → HTML 変換 |

## YAMLスキーマ

```yaml
title: マップのタイトル
root:
  text: 中心テーマ
  children:
    - text: 枝のラベル
      note: 補足メモ(任意)
      children:            # 任意、ネスト自由
        - text: 孫ノード
```

`examples/sample.yaml` に実例があります。

## 使い方

```bash
bun install

# Webアプリ起動 (http://localhost:3000)
export ANTHROPIC_API_KEY=sk-ant-...   # 未設定でも起動可(AI生成はフォールバック動作)
bun start

# CLI: YAML → スタンドアロンHTML
bun run src/cli.ts render examples/sample.yaml -o sample.html

# テスト
bun test
```

## AI生成について

- モデル: `claude-opus-5`(`@anthropic-ai/sdk` 経由)
- システムプロンプトで「YAMLのみを出力」「ノードは短く」「発話に無い内容は足さない」「既存YAMLがあれば追記・整理」を指示
- 応答はサーバー側で必ずスキーマ検証してから返す(コードフェンス付き応答も剥がして解析)
- `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` が無い環境では、句点・改行で文を分割して枝にする簡易フォールバックで動作(UI上に engine 表示あり)

## 今後の拡張候補

- ノードのクリック編集・折りたたみ(インタラクティブSVG)
- 左右両側に枝を広げる本格的なマインドマップレイアウト
- リアルタイム文字起こし(サーバー側STT)との連携
- 生成の差分プレビュー(AIが何を足したか表示)
