/**
 * 画面遷移マップの永続化フォーマット (スキーマの単一情報源)。
 *
 * データの作成方法は問わない — 手書き / collector (実験的 Playwright スクリプト) /
 * 将来の静的解析など、この形式の JSON を出力できればビューアで閲覧できる。
 * 拡張は optional フィールドの追加で行い、破壊的変更時は version を上げる。
 */
export interface ScreenMapDocument {
  version: 1;
  meta?: {
    /** 対象アプリ名 */
    title?: string;
    /** 生成日時 (ISO 8601) */
    generatedAt?: string;
    /** 生成手段 (open union: 独自ツール名も可) */
    generator?: "manual" | "collector" | (string & {});
  };
  screens: Screen[];
  transitions: Transition[];
  wordings: Wording[];
}

export interface Screen {
  /** 一意キー。Transition / Wording から参照される */
  id: string;
  /** 表示名 (例: "ログイン") */
  name: string;
  /** URL パス (例: "/login")。collector のマージキー */
  path: string;
  description?: string;
  /** キャプチャ画像。ビューア公開ルート相対 ("screenshots/login.png") か絶対 URL */
  screenshot?: string;
}

export type ActionType = "click" | "submit" | "navigation" | "auto" | "other";

export interface Transition {
  id: string;
  /** 遷移元 (呼び出し元) Screen.id */
  from: string;
  /** 遷移先 (呼び出し先) Screen.id */
  to: string;
  /** 画面間の操作方法 */
  operation: {
    actionType: ActionType;
    /** 起点要素の data-op 値 */
    dataOp?: string;
    /** 再現用 CSS セレクタ。通常 `[data-op="..."]` */
    selector?: string;
    /** 表示用ラベル (例: "「ログイン」ボタンをクリック") */
    label?: string;
  };
  description?: string;
}

/** 文言。同じ id を複数画面で使うと usages が複数になり「同一文言」として集約される */
export interface Wording {
  /** data-wording 値 */
  id: string;
  /** 実際の表示文言 */
  text: string;
  usages: WordingUsage[];
}

export interface WordingUsage {
  screenId: string;
  /** 通常 `[data-wording="..."]` */
  selector?: string;
  note?: string;
}

/** 操作の表示用ラベルを決める (label > actionType: dataOp > actionType) */
export function operationLabel(op: Transition["operation"]): string {
  if (op.label) return op.label;
  if (op.dataOp) return `${op.actionType}: ${op.dataOp}`;
  return op.actionType;
}
