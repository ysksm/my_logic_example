# React Ghost Click POC

タッチパネル環境で **canvas 上のパーツをタップ → ダイアログを表示 → そのダイアログ内のボタンが勝手に click される**
（いわゆる ghost click / phantom click）現象を React で再現し、複数の解決案を実装して比較する POC です。

- 再現・各対策の動作は Playwright（`hasTouch` なモバイルプロファイル）で自動検証しています
- 対策はプルダウンで切り替えられ、右側に **window capture で観測した生イベントログ** が出るので、何がどこに落ちたかを目で追えます

## 起動

```bash
cd react-ghost-click-poc
npm install
npm run dev        # http://localhost:5174
npm test           # Playwright (touch / mouse の 2 プロファイル)
```

ブラウザで確認する場合は DevTools のデバイスモード（タッチエミュレーション）か、実機のスマホ / タブレットで開いてください。
マウスではこの現象は起きません（後述）。

URL クエリ `?strategy=<id>` で対策を指定できます（例: `/?strategy=none`）。

解説スライド: [docs/ghost-click.slides.html](../docs/ghost-click.slides.html)（ブラウザで開いて ← → キー、またはスワイプで移動）

## 現象の仕組み

タッチ端末で 1 回タップすると、ブラウザは次の順でイベントを投げます。

```
pointerdown → touchstart → pointerup → touchend → (互換マウスイベント) mousedown → mouseup → click
```

`mousedown / mouseup / click` は「タッチ非対応のページを動かすための互換イベント」で、
**touchend の後に、タッチ座標を改めてヒットテストして** 送り先が決まります。

したがって、`pointerup`（または `touchend`）のハンドラで **同期的に** ダイアログを開き、
その中のボタンが指の真下に来ると、後から生成される `click` はキャンバスではなく **ボタン** に落ちます。
マウスの場合は `click` のターゲットが「mousedown と mouseup の共通祖先」に固定されるためこの現象は起きません。

対策なし（`strategy=none`）で実際に観測したログ:

```
    0.0ms pointerdown touch → canvas
    2.5ms touchstart → canvas
   10.5ms pointerup touch → canvas
   12.3ms note ダイアログを開く (パーツ A, touch)
   20.0ms touchend → canvas
   27.9ms mousedown → dialog-delete
   29.9ms mouseup → dialog-delete
   30.9ms click touch → dialog-delete 👻 ghost click
   34.4ms note 「削除」ハンドラ実行: パーツ A を削除
```

ユーザーはパーツを 1 回タップしただけなのに「削除」が実行されています。

### この POC の再現条件

- `<canvas>` の `onPointerUp` でヒットテストし、`<dialog>` を `showModal()` で開く（`useLayoutEffect` で同期）
- ダイアログはタップ位置に出るコンテキストメニュー風で、先頭の「削除」ボタンの中心をタップ座標に合わせている
  - 実務では「画面中央のモーダルでたまたまボタンが指の下にあった」でも同じことが起きます。再現を確実にするためこの配置にしています
- `<meta name="viewport" content="width=device-width">` + `touch-action: manipulation` で、旧来の 300ms click 遅延は無い状態（現代ブラウザ標準）

## 解決案（全部実装済み・切り替え可能）

| # | id | 考え方 | ghost click の発生 | 変更箇所 | 主なトレードオフ |
|---|---|---|---|---|---|
| 1 | `touchend-preventdefault` | 開いたタップの `touchend` で `preventDefault()` | **発生しない** | canvas | 非 passive リスナー必須。全 touchend で呼ぶと既定動作を潰すので「開いた時だけ」呼ぶ |
| 2 | `click-trigger` | `pointerup` ではなく `click` で開く | 発生するが canvas に落ちる | canvas | ドラッグ系 UI では pointerup に寄せたいことが多い |
| 3 | `defer-timeout` | `setTimeout(400ms)` 後に開く | 発生するが canvas に落ちる | 開く側 | 体感遅延。マウスでも待たされる |
| 4 | `defer-after-click` | window の `click` (capture) を 1 回待ってから開く（タイムアウト付き） | 発生するが canvas に落ちる | 開く側 | 3 の改良。マウスなら遅延ほぼゼロ。実装がやや複雑 |
| 5 | `time-guard` | ダイアログ側で開いて 500ms 以内の `click` を capture で握りつぶす | 発生してダイアログに落ちるが **ブロック** | ダイアログ | 本物の高速な 2 タップ目も無視される |
| 6 | `shield` | 透明な全画面要素を最前面に置き最初の `click` を吸収 | 発生してシールドに落ちる（**吸収**） | ダイアログ | `<dialog>` は top layer なのでシールドは dialog の子に置く必要あり |
| 7 | `global-filter` | window capture で「pointerdown ターゲットの祖先ではない click」を捨てる | 発生してダイアログに落ちるが **ブロック** | アプリ全体 1 箇所 | pointerdown 後に DOM が差し替わる UI で誤検知しうる |

### 1. `touchend` で `preventDefault()` — [`src/components/PartsCanvas.tsx`](src/components/PartsCanvas.tsx)

Touch Events 仕様で定められた正攻法。`touchend` を `preventDefault()` すると互換マウスイベント（`mousedown / mouseup / click`）が生成されません。

```tsx
const onPointerUp = (e) => {
  if (hit) { onActivate(...); openedDuringTouch.current = true; }
};
const onTouchEnd = (e) => {
  if (openedDuringTouch.current) e.preventDefault(); // このタップの互換 click を生成させない
  openedDuringTouch.current = false;
};
```

- React の `onTouchEnd` は非 passive で登録されるので `preventDefault()` が効きます（`touchstart / touchmove / wheel` は passive）
- `pointerup` の `preventDefault()` では click は止まらない（止まるのは `pointerdown` → mousedown/mouseup のみ）ので注意

### 2. `click` で開く — [`src/components/PartsCanvas.tsx`](src/components/PartsCanvas.tsx)

`click` はタップのイベント列の最後なので、`click` でダイアログを開けば後続の ghost はありません。
canvas 側がドラッグ等で `pointerup` に依存していないなら最も簡単です。

### 3 / 4. 開くのを遅らせる — [`src/lib/deferOpen.ts`](src/lib/deferOpen.ts)

`pointerup` で「開く」判断だけ行い、実際に開くのを互換 click の後にずらします。

- `openAfterTimeout(open, 400)` — 単純なタイマー
- `openAfterCompatClick(open, 400)` — window の `click` を capture で 1 回待ち、そのディスパッチ完了後（`setTimeout(0)`）に開く。click が来ないケース（`touchcancel` 等）のためにフォールバックタイマーも持つ

観測ログ（4）:

```
    2.5ms pointerup touch → canvas
    3.4ms note 開くのを遅延 (互換 click 待ち)
    4.0ms touchend → canvas
    7.6ms click touch → canvas       ← 先に canvas に落ちきる
   19.9ms note ダイアログを開く
```

### 5. ダイアログ側の時間ガード — [`src/hooks/useGhostClickGuard.ts`](src/hooks/useGhostClickGuard.ts)

```tsx
useGhostClickGuard(dialogRef, true, { windowMs: 500 });
```

要素に capture 段階のネイティブ `click` リスナーを付け、マウント後 N ms 以内なら `stopPropagation() + preventDefault()`。
React の `onClick` は root で bubble を待ち受けているので届きません。共通ダイアログ / ポップオーバーに 1 行足すだけで済みます。

### 6. 透明シールド — [`src/components/ClickShield.tsx`](src/components/ClickShield.tsx)

ダイアログと同時に `position: fixed; inset: 0` の透明要素を描画し、最初の `click` を吸収して自身を消します（タイムアウト付き）。
ghost がどこに落ちても安全なのが利点。`showModal()` した `<dialog>` は top layer にあり通常の `z-index` では上に置けないため、**dialog の子として** 描画しています。

### 7. アプリ全体の整合性フィルタ — [`src/lib/ghostClickFilter.ts`](src/lib/ghostClickFilter.ts)

```ts
useEffect(() => installGhostClickFilter(), []);
```

「正しい click のターゲットは pointerdown ターゲットの祖先（または同一）である」というマウスの規則をタッチにも適用します。
window capture で直前の `pointerdown` ターゲットを覚えておき、`click` のターゲットがそれを `contains()` しなければ ghost とみなして `stopImmediatePropagation() + preventDefault()`。

- `detail === 0`（キーボード / `element.click()`）は素通し
- pointerdown ターゲットが DOM から外れていれば判定不能として素通し
- 個々のキャンバスやダイアログを触らずに済む反面、pointerdown 直後に要素を差し替える UI では誤検知の可能性があります

## どれを選ぶか

- **新規に書けるなら 1（`touchend` で `preventDefault`）か 2（`click` で開く）。** 現象の原因そのものを断つので副作用が最も少ない
- ダイアログが共通コンポーネントで、開く側が多数ある → **5（time-guard）** か **6（shield）** をダイアログ側に入れる
- 既存アプリに横断的に入れたい / 開く側もダイアログも触りたくない → **7（global-filter）**
- 遅延型（3 / 4）は仕組みが分かりやすい反面、体感に影響するため最後の手段

## テスト

`e2e/ghost-click.spec.ts` は `src/strategies/index.ts` の一覧を走査して全戦略を検証します。

- **mobile-touch**（Pixel 7 プロファイル、`hasTouch`）
  - 対策なし: タップ 1 回で「削除」が実行される（= 再現の固定）
  - 各対策: タップ後に「削除」が実行されないこと、その後の本物のタップで「削除」「キャンセル」が動くこと
- **desktop-mouse**: 全戦略でマウス操作が壊れていないこと

```
30 passed (mobile-touch 22, desktop-mouse 8)
```

## 構成

```
src/
  strategies/index.ts        対策の定義（UI とテストの共通ソース）
  components/PartsCanvas.tsx  パーツを描く canvas。trigger (pointerup/click) と対策 1
  components/PartDialog.tsx   タップ位置に出る <dialog>。対策 5 / 6 を組み込み
  components/ClickShield.tsx  対策 6
  hooks/useGhostClickGuard.ts 対策 5
  lib/deferOpen.ts            対策 3 / 4
  lib/ghostClickFilter.ts     対策 7
  lib/eventLog.ts             window capture のイベントログ (観測用、対策ではない)
e2e/ghost-click.spec.ts       Playwright テスト
```

## 技術スタック

- React 18 + TypeScript + Vite
- Playwright 1.56（`@playwright/test`）
