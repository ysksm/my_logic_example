/** 月境界はすべて UTC。 */

export function toMonth(iso: string): string {
  return iso.slice(0, 7);
}

export function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  let [y, m] = splitMonth(from);
  const [ty, tm] = splitMonth(to);
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

function splitMonth(value: string): [number, number] {
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    throw new Error(`月の書式が不正です: ${value}`);
  }
  return [y, m];
}

/** 月末（排他）の UTC 時刻。月末未解決数の判定に使う。 */
export function monthEndExclusive(month: string): string {
  const [y, m] = splitMonth(month);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return `${next}-01T00:00:00Z`;
}

export function monthStart(month: string): string {
  return `${month}-01T00:00:00Z`;
}

/** 差分取得の重複窓（既定 48 時間）を差し引いた起点を返す。 */
export function overlapStart(cursorAt: string, overlapHours: number): string {
  const t = Date.parse(cursorAt);
  if (Number.isNaN(t)) throw new Error(`日時の書式が不正です: ${cursorAt}`);
  return new Date(t - overlapHours * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
