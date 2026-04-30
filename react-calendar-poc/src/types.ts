export type ViewMode = "day" | "5day" | "week" | "month";

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO string */
  start: string;
  /** ISO string */
  end: string;
  /** 工数 (時間) - 未指定の場合は start/end の差分から自動計算 */
  workHours?: number;
  description?: string;
  color?: string;
}

export const EVENT_COLORS: { value: string; label: string }[] = [
  { value: "#1a73e8", label: "青" },
  { value: "#33b679", label: "緑" },
  { value: "#f4511e", label: "オレンジ" },
  { value: "#8e24aa", label: "紫" },
  { value: "#e67c73", label: "赤" },
  { value: "#f6bf26", label: "黄" },
  { value: "#616161", label: "グレー" },
];
