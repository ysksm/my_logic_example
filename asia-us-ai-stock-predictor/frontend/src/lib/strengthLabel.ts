import type { Strength } from "../api/types";

export interface StrengthBadge {
  /** 日本語ラベル */
  label: string;
  /** バッジ背景色 */
  bg: string;
  /** バッジ文字色 */
  fg: string;
}

const BADGES: Record<Strength, StrengthBadge> = {
  strong: { label: "強", bg: "#d32f2f", fg: "#ffffff" },
  moderate: { label: "中", bg: "#ef6c00", fg: "#ffffff" },
  weak: { label: "弱", bg: "#9e9e9e", fg: "#ffffff" },
  none: { label: "なし", bg: "#e0e0e0", fg: "#616161" },
};

/**
 * シグナル強度 ("strong"|"moderate"|"weak"|"none") を日本語ラベルとバッジ色に変換する。
 * 未知の値は "none" 相当として扱う。
 */
export function strengthLabel(strength: string): StrengthBadge {
  return BADGES[strength as Strength] ?? BADGES.none;
}
