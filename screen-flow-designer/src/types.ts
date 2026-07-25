import type { Edge, Node } from "@xyflow/react";

/**
 * 画面遷移図の永続化フォーマット。
 * エクスポート/インポートおよび Playwright クローラーとの連携に使う。
 * playwright/crawl.mjs もこのフォーマットで出力する。
 */
export interface ScreenFlowDocument {
  version: 1;
  screens: ScreenDef[];
  transitions: TransitionDef[];
}

export type DiscoveredBy = "manual" | "playwright";

export interface ScreenDef {
  id: string;
  name: string;
  /** URL またはパス。Playwright インポート時のマージキーになる */
  url?: string;
  description?: string;
  /** レイアウト情報。未指定なら自動レイアウトで配置する */
  position?: { x: number; y: number };
  discoveredBy?: DiscoveredBy;
  /** 最後に実測(クロール)で確認された日時 (ISO 8601) */
  lastSeenAt?: string;
}

export type TriggerType = "click" | "submit" | "navigation" | "auto" | "other";

export interface TransitionDef {
  id: string;
  /** 遷移元画面の id */
  source: string;
  /** 遷移先画面の id */
  target: string;
  trigger?: {
    type: TriggerType;
    /** 遷移を起こす要素の CSS セレクタ (Playwright で再現可能にする) */
    selector?: string;
    /** 表示用ラベル (例: 「ログインボタン」) */
    label?: string;
  };
  discoveredBy?: DiscoveredBy;
  lastSeenAt?: string;
}

/** React Flow ノードに載せるデータ */
export type ScreenNodeData = {
  name: string;
  url: string;
  description: string;
  discoveredBy: DiscoveredBy;
  lastSeenAt?: string;
};

/** React Flow エッジに載せるデータ */
export type TransitionEdgeData = {
  triggerType: TriggerType;
  selector: string;
  label: string;
  discoveredBy: DiscoveredBy;
  lastSeenAt?: string;
};

export type ScreenFlowNode = Node<ScreenNodeData, "screen">;
export type TransitionFlowEdge = Edge<TransitionEdgeData>;

export function edgeDisplayLabel(data: TransitionEdgeData): string {
  if (data.label) return data.label;
  if (data.selector) return `${data.triggerType}: ${data.selector}`;
  return data.triggerType;
}
