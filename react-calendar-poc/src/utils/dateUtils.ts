import type { CalendarEvent, ViewMode } from "../types";

export const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
export const HOURS = Array.from({ length: 24 }, (_, i) => i);
export const SLOT_MINUTES = 30;
export const SLOT_HEIGHT = 24; // px per 30min slot
export const HOUR_HEIGHT = SLOT_HEIGHT * 2;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}

/** 週の開始日 (日曜) */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

/** 5日 (営業日) ビューの開始日 (月曜) */
export function startOfBusinessWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  // 日曜=0 -> 翌月曜, 月曜=1 -> 当日, ... 土曜=6 -> 前月曜から週開始
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

export function startOfMonth(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfMonth(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function formatDateInput(d: Date): string {
  // yyyy-mm-dd (ローカル)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatTimeInput(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function parseDateTime(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

export function formatJpDate(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${
    DAY_LABELS[d.getDay()]
  })`;
}

export function formatRangeLabel(date: Date, view: ViewMode): string {
  if (view === "day") return formatJpDate(date);
  if (view === "month") {
    return `${date.getFullYear()}年${date.getMonth() + 1}月`;
  }
  const start = view === "5day" ? startOfBusinessWeek(date) : startOfWeek(date);
  const days = view === "5day" ? 5 : 7;
  const end = addDays(start, days - 1);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.getFullYear()}年${
      start.getMonth() + 1
    }月${start.getDate()}日 〜 ${end.getDate()}日`;
  }
  if (sameYear) {
    return `${start.getFullYear()}年${
      start.getMonth() + 1
    }月${start.getDate()}日 〜 ${end.getMonth() + 1}月${end.getDate()}日`;
  }
  return `${start.getFullYear()}/${
    start.getMonth() + 1
  }/${start.getDate()} 〜 ${end.getFullYear()}/${
    end.getMonth() + 1
  }/${end.getDate()}`;
}

export function getDaysForView(date: Date, view: ViewMode): Date[] {
  if (view === "day") return [startOfDay(date)];
  if (view === "5day") {
    const s = startOfBusinessWeek(date);
    return Array.from({ length: 5 }, (_, i) => addDays(s, i));
  }
  if (view === "week") {
    const s = startOfWeek(date);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }
  // month: 6週間グリッド (日曜始まり)
  const first = startOfMonth(date);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export function getNavigationStep(view: ViewMode): {
  unit: "day" | "month";
  amount: number;
} {
  switch (view) {
    case "day":
      return { unit: "day", amount: 1 };
    case "5day":
      return { unit: "day", amount: 7 };
    case "week":
      return { unit: "day", amount: 7 };
    case "month":
      return { unit: "month", amount: 1 };
  }
}

export function navigate(date: Date, view: ViewMode, dir: 1 | -1): Date {
  const step = getNavigationStep(view);
  if (step.unit === "month") return addMonths(date, dir * step.amount);
  return addDays(date, dir * step.amount);
}

export function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return events
    .filter((ev) => {
      const s = new Date(ev.start);
      const e = new Date(ev.end);
      const dayStart = startOfDay(day);
      const dayEnd = addDays(dayStart, 1);
      return s < dayEnd && e > dayStart;
    })
    .sort(
      (a, b) =>
        new Date(a.start).getTime() - new Date(b.start).getTime()
    );
}

/** 工数 (h) を返す。明示指定があればそれを優先 */
export function getEventHours(ev: CalendarEvent): number {
  if (typeof ev.workHours === "number") return ev.workHours;
  const s = new Date(ev.start);
  const e = new Date(ev.end);
  return Math.max(0, (e.getTime() - s.getTime()) / 1000 / 60 / 60);
}

export function totalHoursOnDay(events: CalendarEvent[], day: Date): number {
  return eventsOnDay(events, day).reduce(
    (sum, ev) => sum + getEventHours(ev),
    0
  );
}

/** タイムグリッド上の絶対 px 位置 */
export function timeToOffset(date: Date): number {
  return (date.getHours() * 60 + date.getMinutes()) * (HOUR_HEIGHT / 60);
}

export function durationToHeight(start: Date, end: Date): number {
  const minutes = (end.getTime() - start.getTime()) / 1000 / 60;
  return Math.max(SLOT_HEIGHT * 0.6, minutes * (HOUR_HEIGHT / 60));
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
