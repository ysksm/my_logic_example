/**
 * Ghost click 対策の戦略定義。
 *
 * それぞれの戦略は「キャンバスのどのイベントでダイアログを開くか」と
 * 「ダイアログを守るためにどの仕組みを併用するか」の組み合わせで表現する。
 * UI / E2E テストはこの配列を走査して全戦略を検証する。
 */

export type StrategyId =
  | "none"
  | "touchend-preventdefault"
  | "click-trigger"
  | "defer-timeout"
  | "defer-after-click"
  | "time-guard"
  | "shield"
  | "global-filter";

/** キャンバスでパーツを「操作した」とみなすイベント */
export type TriggerEvent = "pointerup" | "click";

/** ダイアログを開くタイミングをずらす方法 */
export type DeferMode = "none" | "timeout" | "afterClick";

/** ダイアログ側で ghost click を無害化する方法 */
export type DialogGuard = "none" | "timeGuard" | "shield";

export interface Strategy {
  id: StrategyId;
  label: string;
  /** どういう考え方の対策か（UI に表示） */
  summary: string;
  /** 注意点・トレードオフ（UI に表示） */
  caveat: string;
  trigger: TriggerEvent;
  /** パーツをタップした touchend で preventDefault() を呼び、互換マウスイベント + click を抑止する */
  preventDefaultTouchEnd: boolean;
  defer: DeferMode;
  guard: DialogGuard;
  /** window レベルで pointerdown と click のターゲットを突き合わせ、矛盾する click を捨てる */
  globalFilter: boolean;
}

export const DEFER_TIMEOUT_MS = 400;
export const TIME_GUARD_MS = 500;
export const SHIELD_TIMEOUT_MS = 500;

export const STRATEGIES: Strategy[] = [
  {
    id: "none",
    label: "0. 対策なし（再現）",
    summary:
      "canvas の pointerup でダイアログを同期的に開く。touchend 後にブラウザが生成する互換 click が、指の真下に現れたダイアログのボタンに命中する。",
    caveat: "「削除」ボタンがユーザーの意図なく押される。",
    trigger: "pointerup",
    preventDefaultTouchEnd: false,
    defer: "none",
    guard: "none",
    globalFilter: false,
  },
  {
    id: "touchend-preventdefault",
    label: "1. touchend で preventDefault()",
    summary:
      "ダイアログを開いたタップの touchend で preventDefault() を呼ぶ。仕様上、互換マウスイベント (mousedown/mouseup/click) の生成が抑止されるので ghost click 自体が発生しない。",
    caveat:
      "touchend のリスナーが passive だと効かない（React の onTouchEnd は非 passive）。全 touchend で呼ぶとフォーカス等の既定動作も潰すので、開いた時だけ呼ぶこと。",
    trigger: "pointerup",
    preventDefaultTouchEnd: true,
    defer: "none",
    guard: "none",
    globalFilter: false,
  },
  {
    id: "click-trigger",
    label: "2. pointerup ではなく click で開く",
    summary:
      "click はタップのイベント列（pointerdown → touchstart → pointerup → touchend → mousedown → mouseup → click）の最後なので、click で開けば後続の ghost は存在しない。",
    caveat:
      "ドラッグ操作を持つ canvas では pointerup で状態を確定させたいことが多く、click に寄せられない場合がある。古い環境では 300ms 遅延が付く。",
    trigger: "click",
    preventDefaultTouchEnd: false,
    defer: "none",
    guard: "none",
    globalFilter: false,
  },
  {
    id: "defer-timeout",
    label: `3. setTimeout(${DEFER_TIMEOUT_MS}ms) で開くのを遅らせる`,
    summary:
      "pointerup で開く判断だけ行い、実際に開くのは一定時間後。互換 click が先に（canvas に対して）発火し終わってからダイアログが現れる。",
    caveat:
      "体感の遅延が出る。マウス操作でも同じだけ待たされる。時間は経験則（旧来の 300ms 遅延 + α）。",
    trigger: "pointerup",
    preventDefaultTouchEnd: false,
    defer: "timeout",
    guard: "none",
    globalFilter: false,
  },
  {
    id: "defer-after-click",
    label: "4. 互換 click を待ってから開く",
    summary:
      "pointerup で開く判断を行い、window の click (capture) を 1 回待ってから開く。click が来ないケース (touchcancel 等) はタイムアウトで開く。3 の改良版でマウスなら遅延ゼロ。",
    caveat: "実装がやや複雑。タイムアウト値の管理が必要。",
    trigger: "pointerup",
    preventDefaultTouchEnd: false,
    defer: "afterClick",
    guard: "none",
    globalFilter: false,
  },
  {
    id: "time-guard",
    label: `5. ダイアログ側で開いて ${TIME_GUARD_MS}ms 以内の click を無視`,
    summary:
      "ダイアログの要素に capture リスナーを付け、開いた直後の click を stopPropagation + preventDefault で握りつぶす。ダイアログ (共通コンポーネント) 側だけで完結する。",
    caveat:
      "本物の高速な 2 タップ目も一定時間無視される。閾値はヒューリスティック。",
    trigger: "pointerup",
    preventDefaultTouchEnd: false,
    defer: "none",
    guard: "timeGuard",
    globalFilter: false,
  },
  {
    id: "shield",
    label: "6. 透明シールドで最初の click を吸収",
    summary:
      "ダイアログを開くと同時に全画面の透明な要素を最前面に置き、最初の click を吸収して自身を消す（タイムアウト付き）。どこに ghost が落ちても安全。",
    caveat:
      "マウスでは ghost が来ないためタイムアウトまでシールドが残る（pointerType で出し分けると改善）。top layer の <dialog> の場合はシールドを dialog 内に置く必要がある。",
    trigger: "pointerup",
    preventDefaultTouchEnd: false,
    defer: "none",
    guard: "shield",
    globalFilter: false,
  },
  {
    id: "global-filter",
    label: "7. pointerdown と click のターゲット整合性チェック（アプリ全体）",
    summary:
      "window capture で直前の pointerdown ターゲットを記録し、click のターゲットがその祖先でなければ「指を下ろした場所と違う要素への click」= ghost と判定して捨てる。ダイアログにもキャンバスにも手を入れない。",
    caveat:
      "pointerdown 後に DOM が差し替わる UI では誤検知の可能性（ターゲットが DOM から外れた場合は許可して緩和）。キーボード/プログラム的 click は detail===0 で素通し。",
    trigger: "pointerup",
    preventDefaultTouchEnd: false,
    defer: "none",
    guard: "none",
    globalFilter: true,
  },
];

export function findStrategy(id: string | null | undefined): Strategy {
  return STRATEGIES.find((s) => s.id === id) ?? STRATEGIES[0];
}
