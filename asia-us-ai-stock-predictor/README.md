# Asia→US AI Stock Predictor

日本・韓国・欧州市場の取引結果から、米国市場の AI 関連銘柄の値動きを予測・分析するツール。
株価データの取得 → ラグ付き相関分析 → 当日の売買シグナル提案（統計的根拠の提示）までを一気通貫で行う。

> 投資判断は最終的に人間が行う前提。本ツールは推奨ではなく統計的根拠の提示に徹する。

## 構成

- `backend/` — Python (FastAPI)。データ取得（yfinance + SQLite キャッシュ差分更新）、
  ラグ付き相関・条件付き分析・織り込み度判定・ベータ分解、シグナルエンジン
- `frontend/` — React + TypeScript + Vite のダッシュボード
  （相関ヒートマップ / ペア重ね合わせチャート / 当日シグナル一覧）
- `config/watchlist.json` — レイヤー別 × 市場別ウォッチリストと分析パラメータ（編集可能）
- `docs/ARCHITECTURE.md` — 設計の詳細
- `docs/VALIDATION.md` — 3ペア検証結果（SK hynix↔MU、SBG↔ARM、ASML↔AMAT、過去2年）

## セットアップ

### バックエンド

```bash
cd backend
pip install -e ".[dev]"        # または: pip install yfinance pandas numpy fastapi "uvicorn[standard]" pytest httpx

python scripts/fetch_all.py            # 全銘柄を取得して SQLite にキャッシュ（差分更新）
python scripts/validate_pairs.py       # 3ペア検証レポート
python scripts/daily_signal.py         # 日次シグナル（アジア・欧州引け後に実行）
python -m uvicorn app.api.main:app --port 8000   # API サーバ

pytest                                  # テスト（既知データのスナップショット含む）
```

### フロントエンド

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173 （/api は :8000 にプロキシ）
npm test         # Vitest
```

## 日々の運用フロー

1. アジア・欧州市場の引け後（JST 夕方〜夜、米国寄り付き前）に `daily_signal.py` を実行
2. ±2σ 以上動いたアジア/欧州銘柄と対応する米国銘柄、過去の条件付きヒット率・
   平均残余リターン・サンプル数、プレマーケットでの織り込み状況が表示される
3. `priced_in_ratio`（プレマーケット織り込み比率）が 100% を超えている場合、
   期待変動は時間外で概ね消化済み
4. 売買の最終判断はユーザー自身が行う

## シグナルの読み方

| 強度 | 意味 |
|------|------|
| strong | 条件付きヒット率 ≥ 65%、サンプル ≥ 10、織り込み未完 |
| moderate | ヒット率 ≥ 55%、サンプル ≥ 10 |
| weak | 統計的優位性が薄い |
| none | サンプル数不足 |

重要な指標:

- **ヒット率**: アジア銘柄のトリガー日に米国銘柄が同方向に動いた割合（ベースラインと比較すること）
- **ギャップ**: 前日終値→寄り。時間外・先物で織り込まれた分
- **残余リターン**: 寄り→引け。シグナルを見てから米国寄りで入った場合に取れた分
- **固有リターン**: S&P 500 ベータを除去したペア固有の動き

## 検証結果の要点（詳細は docs/VALIDATION.md）

- 無条件の相関は「米国→アジア」方向（lag=−1）が支配的。SBG↔ARM は ARM→SBG の
  逆因果が特に強い（ARM が SBG の NAV に直結するため）
- ±2σ トリガー日に限定すると、3ペアすべてでヒット率がベースラインを上回った
  （ASML→AMAT: 95% / SBG→ARM: 78% / SK hynix→MU: 上昇方向のみ 69%）
- ただし残余リターンの過半はギャップで消えるため、プレマーケット織り込みの確認が実用上の要

## 既知の制限

- stooq フォールバックは 2026-06 時点でサーバーサイドから利用不可（PoW チャレンジ）。
  実装は残してあり、ローカル環境では動く可能性がある
- JSR (4185.T)・新光電気 (6967.T) は上場廃止のためデータ取得不可（ウォッチリストに注記済み）
- 韓国銘柄は yfinance で欠損が出ることがある。取得失敗時はキャッシュで分析を継続し
  `stale: true` を返す
