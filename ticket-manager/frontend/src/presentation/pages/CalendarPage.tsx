import { useMemo, useState } from "react";
import { useCalendarRange, useEvents } from "@/application/hooks/useCalendar";
import { useTimeEntries } from "@/application/hooks/useTimeEntries";
import { useTickets } from "@/application/hooks/useTickets";
import type { CalendarItem } from "@/domain/types";

type View = "week" | "month";

// ===== date helpers =====
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay()); // Sunday
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoWithZone(d: Date) {
  // RFC3339 in UTC. DuckDB stores naked TIMESTAMP; the server parses Go's
  // default RFC3339 (Z suffix). Round-trips back as the same instant; the UI
  // converts to local time for display.
  return d.toISOString();
}

// ===== week view layout constants =====
const SLOT_MIN = 15;          // each clickable slot is 15 minutes
const SLOT_PX = 12;           // visual height of a 15-min slot
const HOUR_PX = SLOT_PX * 4;  // = 48
const DAY_PX = HOUR_PX * 24;  // = 1152

export default function CalendarPage() {
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState<Date>(() => new Date());

  return (
    <>
      <h1>カレンダー</h1>
      <div className="panel row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <button
            className={view === "week" ? "" : "secondary"}
            onClick={() => setView("week")}
          >週</button>
          <button
            className={view === "month" ? "" : "secondary"}
            onClick={() => setView("month")}
          >月</button>
        </div>
        <div className="row">
          {view === "week" ? (
            <>
              <button className="secondary" onClick={() => setCursor(addDays(cursor, -7))}>← 前週</button>
              <strong>{fmtRange(startOfWeek(cursor))}</strong>
              <button className="secondary" onClick={() => setCursor(addDays(cursor, 7))}>次週 →</button>
              <button className="secondary" onClick={() => setCursor(new Date())}>今週</button>
            </>
          ) : (
            <>
              <button className="secondary" onClick={() => setCursor(addMonths(cursor, -1))}>← 前月</button>
              <strong>{cursor.getFullYear()}年 {cursor.getMonth() + 1}月</strong>
              <button className="secondary" onClick={() => setCursor(addMonths(cursor, 1))}>次月 →</button>
              <button className="secondary" onClick={() => setCursor(new Date())}>今月</button>
            </>
          )}
        </div>
      </div>

      {view === "week" ? <WeekView cursor={cursor} /> : <MonthView cursor={cursor} />}
    </>
  );
}

function fmtRange(weekStart: Date) {
  const end = addDays(weekStart, 6);
  return `${weekStart.getFullYear()}/${weekStart.getMonth() + 1}/${weekStart.getDate()} – ${end.getMonth() + 1}/${end.getDate()}`;
}

// ===== Month view (existing behaviour) =====
function MonthView({ cursor }: { cursor: Date }) {
  const monthStart = startOfMonth(cursor);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());
  const gridEnd = new Date(monthEnd);
  gridEnd.setDate(monthEnd.getDate() + (6 - monthEnd.getDay()));

  const { items } = useCalendarRange(fmtDate(gridStart), fmtDate(gridEnd));

  const byDate = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of items) {
      const arr = m.get(it.date) ?? [];
      arr.push(it);
      m.set(it.date, arr);
    }
    return m;
  }, [items]);

  const days: Date[] = [];
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }
  const today = fmtDate(new Date());

  return (
    <div className="calendar">
      {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
        <div key={d} className="cell" style={{ minHeight: "auto", textAlign: "center", fontWeight: 600 }}>{d}</div>
      ))}
      {days.map((d) => {
        const ds = fmtDate(d);
        const outside = d.getMonth() !== monthStart.getMonth();
        const isToday = ds === today;
        const dayItems = byDate.get(ds) ?? [];
        return (
          <div key={ds} className={`cell ${outside ? "outside" : ""} ${isToday ? "today" : ""}`}>
            <div className="date">{d.getDate()}</div>
            {dayItems.map((it, idx) => {
              const cls = it.kind === "EVENT" ? "event" : it.kind === "TIME_ENTRY" ? "time" : "";
              const text = it.kind === "TIME_ENTRY" ? `${it.hours}h: ${it.title}` : it.title;
              return (
                <div key={idx} className={`item ${cls}`} title={text}>
                  {text}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ===== Week view with 15-min slots =====
interface AddSlot {
  date: Date;       // local date+time at the click point (15-min snapped)
  durationMin: number;
}

function WeekView({ cursor }: { cursor: Date }) {
  const weekStart = useMemo(() => startOfWeek(cursor), [cursor]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const from = fmtDate(days[0]);
  const to = fmtDate(days[6]);

  const { items, refresh: refreshItems } = useCalendarRange(from, to);
  const { create: createEvent } = useEvents();
  const { create: createTime } = useTimeEntries({ from, to });
  const { tickets } = useTickets();

  const [slot, setSlot] = useState<AddSlot | null>(null);

  const onSlotClick = (day: Date, slotIndex: number) => {
    const d = new Date(day);
    d.setHours(0, slotIndex * SLOT_MIN, 0, 0);
    setSlot({ date: d, durationMin: 30 });
  };

  async function submitEvent(title: string, description: string) {
    if (!slot || !title.trim()) return;
    const start = slot.date;
    const end = new Date(start.getTime() + slot.durationMin * 60 * 1000);
    await createEvent({
      title,
      description,
      start_date: fmtDate(start),
      start_at: isoWithZone(start),
      end_at: isoWithZone(end),
    });
    setSlot(null);
    await refreshItems();
  }

  async function submitTime(ticketId: string, note: string) {
    if (!slot || !ticketId) return;
    const start = slot.date;
    const end = new Date(start.getTime() + slot.durationMin * 60 * 1000);
    const hours = slot.durationMin / 60;
    await createTime({
      ticket_id: ticketId,
      hours,
      work_date: fmtDate(start),
      start_at: isoWithZone(start),
      end_at: isoWithZone(end),
      note,
    });
    setSlot(null);
    await refreshItems();
  }

  // Group items by date string for the week
  const itemsByDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of items) {
      const arr = m.get(it.date) ?? [];
      arr.push(it);
      m.set(it.date, arr);
    }
    return m;
  }, [items]);

  const todayStr = fmtDate(new Date());
  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];

  return (
    <>
      <div className="week-view panel" style={{ padding: 0 }}>
        <div className="week-grid">
          {/* header row: blank gutter + 7 day headers */}
          <div className="week-gutter week-header" />
          {days.map((d) => {
            const isToday = fmtDate(d) === todayStr;
            return (
              <div key={d.toISOString()} className={`week-header ${isToday ? "today" : ""}`}>
                <div className="muted">{dayNames[d.getDay()]}</div>
                <div style={{ fontWeight: 600 }}>{d.getMonth() + 1}/{d.getDate()}</div>
              </div>
            );
          })}

          {/* All-day strip: items without start_at (TICKET_DUE, legacy) */}
          <div className="week-gutter all-day-label muted">all-day</div>
          {days.map((d) => {
            const ds = fmtDate(d);
            const all = (itemsByDay.get(ds) ?? []).filter((it) => !it.start_at);
            return (
              <div key={"ad-" + ds} className="all-day-cell">
                {all.map((it, i) => (
                  <div
                    key={i}
                    className={`item ${it.kind === "EVENT" ? "event" : it.kind === "TIME_ENTRY" ? "time" : "due"}`}
                    title={it.title}
                  >
                    {it.kind === "TICKET_DUE" ? "📌 " : ""}
                    {it.kind === "TIME_ENTRY" ? `${it.hours}h: ${it.title}` : it.title}
                  </div>
                ))}
              </div>
            );
          })}

          {/* Hour gutter (24 rows) */}
          <div className="week-gutter time-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="hour-label">{String(h).padStart(2, "0")}:00</div>
            ))}
          </div>

          {/* 7 day columns */}
          {days.map((d) => {
            const ds = fmtDate(d);
            const timed = (itemsByDay.get(ds) ?? []).filter((it) => !!it.start_at);
            return (
              <div key={"col-" + ds} className="day-col" style={{ height: DAY_PX }}>
                {/* 15-min clickable slots: 24 * 4 = 96 */}
                {Array.from({ length: 24 * 4 }, (_, i) => (
                  <div
                    key={i}
                    className={`slot ${i % 4 === 0 ? "hour-start" : ""}`}
                    style={{ height: SLOT_PX }}
                    onClick={() => onSlotClick(d, i)}
                  />
                ))}
                {/* Positioned items */}
                {timed.map((it, idx) => <PositionedItem key={idx} item={it} />)}
              </div>
            );
          })}
        </div>
      </div>

      {slot && (
        <SlotForm
          slot={slot}
          tickets={tickets}
          onChangeDuration={(min) => setSlot({ ...slot, durationMin: min })}
          onCancel={() => setSlot(null)}
          onSubmitEvent={submitEvent}
          onSubmitTime={submitTime}
        />
      )}
    </>
  );
}

function PositionedItem({ item }: { item: CalendarItem }) {
  const start = new Date(item.start_at!);
  const end = item.end_at ? new Date(item.end_at) : new Date(start.getTime() + 30 * 60 * 1000);
  const startMin = start.getHours() * 60 + start.getMinutes();
  const durMin = Math.max(15, (end.getTime() - start.getTime()) / 60000);
  const top = (startMin / SLOT_MIN) * SLOT_PX;
  const height = (durMin / SLOT_MIN) * SLOT_PX;
  const cls = item.kind === "EVENT" ? "event" : "time";
  const time = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const label = item.kind === "TIME_ENTRY"
    ? `${time} · ${item.hours}h · ${item.title}`
    : `${time} · ${item.title}`;
  return (
    <div className={`positioned-item ${cls}`} style={{ top, height }} title={label}>
      <div className="ttl">{label}</div>
    </div>
  );
}
function pad(n: number) { return String(n).padStart(2, "0"); }

// ===== Slot form (event or time entry) =====
function SlotForm({
  slot,
  tickets,
  onChangeDuration,
  onCancel,
  onSubmitEvent,
  onSubmitTime,
}: {
  slot: AddSlot;
  tickets: { id: string; title: string; type: string }[];
  onChangeDuration: (min: number) => void;
  onCancel: () => void;
  onSubmitEvent: (title: string, description: string) => Promise<void>;
  onSubmitTime: (ticketId: string, note: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<"EVENT" | "TIME_ENTRY">("EVENT");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [note, setNote] = useState("");

  const slotLabel = `${fmtDate(slot.date)} ${pad(slot.date.getHours())}:${pad(slot.date.getMinutes())}`;

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>{slotLabel} に追加</h3>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className={kind === "EVENT" ? "" : "secondary"} onClick={() => setKind("EVENT")}>予定</button>
        <button className={kind === "TIME_ENTRY" ? "" : "secondary"} onClick={() => setKind("TIME_ENTRY")}>工数</button>
        <span className="muted">所要時間:</span>
        <select value={slot.durationMin} onChange={(e) => onChangeDuration(Number(e.target.value))}>
          {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
            <option key={m} value={m}>{m < 60 ? `${m} 分` : `${m / 60} 時間`}</option>
          ))}
        </select>
      </div>

      {kind === "EVENT" ? (
        <div>
          <div className="row">
            <input
              placeholder="タイトル"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ flex: 1 }}
              autoFocus
            />
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <input
              placeholder="メモ (任意)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => onSubmitEvent(title, description)}>追加</button>
            <button className="secondary" onClick={onCancel}>キャンセル</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="row">
            <select value={ticketId} onChange={(e) => setTicketId(e.target.value)} style={{ minWidth: 280 }} autoFocus>
              <option value="">(チケット選択)</option>
              {tickets.map((t) => (
                <option key={t.id} value={t.id}>[{t.type}] {t.title}</option>
              ))}
            </select>
            <input
              placeholder="メモ (任意)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => onSubmitTime(ticketId, note)}>追加</button>
            <button className="secondary" onClick={onCancel}>キャンセル</button>
          </div>
        </div>
      )}
    </div>
  );
}
