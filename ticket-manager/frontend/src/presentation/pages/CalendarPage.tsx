import { useEffect, useMemo, useRef, useState } from "react";
import { useCalendarRange, useEvents } from "@/application/hooks/useCalendar";
import { useTimeEntries } from "@/application/hooks/useTimeEntries";
import { useTickets } from "@/application/hooks/useTickets";
import type { CalendarItem } from "@/domain/types";

type View = "week" | "month";
type Kind = "EVENT" | "TIME_ENTRY";

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
  return d.toISOString();
}
function pad(n: number) { return String(n).padStart(2, "0"); }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// ===== week view layout constants =====
const SLOT_MIN = 15;
const SLOT_PX = 12;
const HOUR_PX = SLOT_PX * 4;
const SLOTS_PER_DAY = 24 * 4;
const DAY_PX = HOUR_PX * 24;

export default function CalendarPage() {
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState<Date>(() => new Date());

  return (
    <>
      <h1>カレンダー</h1>
      <div className="panel row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <button className={view === "week" ? "" : "secondary"} onClick={() => setView("week")}>週</button>
          <button className={view === "month" ? "" : "secondary"} onClick={() => setView("month")}>月</button>
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
      {view === "week" && (
        <p className="muted" style={{ marginTop: 8 }}>
          ヒント: 左半分=予定 / 右半分=工数。空きスロットをドラッグして新規作成、
          既存の枠は本体ドラッグで移動 / 下端ドラッグでリサイズできます。
        </p>
      )}
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

// ===== Week view =====
interface DragState {
  dayIdx: number;
  anchorSlot: number;
  currentSlot: number;
  side: Kind;
}

interface Selection {
  date: Date;
  startMin: number;
  endMin: number;
  kind: Kind;
}

interface ItemDrag {
  itemKey: string;
  kind: Kind;
  mode: "move" | "resize";
  originalDayIdx: number;
  originalStartSlot: number;
  originalEndSlot: number;
  // For move: where the cursor first grabbed the item, in slots from item start
  grabOffsetSlot: number;
  ghostDayIdx: number;
  ghostStartSlot: number;
  ghostEndSlot: number;
}

function WeekView({ cursor }: { cursor: Date }) {
  const weekStart = useMemo(() => startOfWeek(cursor), [cursor]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const from = fmtDate(days[0]);
  const to = fmtDate(days[6]);

  const { items, refresh: refreshItems } = useCalendarRange(from, to);
  const { events, create: createEvent, update: updateEvent } = useEvents();
  const { entries, create: createTime, update: updateTimeEntry } = useTimeEntries({ from, to });
  const { tickets } = useTickets();

  const [drag, setDrag] = useState<DragState | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [itemDrag, setItemDrag] = useState<ItemDrag | null>(null);

  // Current time, refreshed every minute, drives the "now" line.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);
  const nowDateStr = fmtDate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Commit "drag to create" on global mouseup
  useEffect(() => {
    if (!drag) return;
    const onUp = () => {
      const startSlot = Math.min(drag.anchorSlot, drag.currentSlot);
      const endSlot = Math.max(drag.anchorSlot, drag.currentSlot) + 1;
      setSelection({
        date: days[drag.dayIdx],
        startMin: startSlot * SLOT_MIN,
        endMin: endSlot * SLOT_MIN,
        kind: drag.side,
      });
      setDrag(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrag(null);
    };
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [drag, days]);

  // Item drag handlers (move / resize existing items)
  useEffect(() => {
    if (!itemDrag) return;
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!el) return;
      const slotEl = el.closest<HTMLElement>("[data-slot][data-day-idx]");
      if (!slotEl) return;
      const dayIdx = Number(slotEl.dataset.dayIdx);
      const slot = Number(slotEl.dataset.slot);
      setItemDrag((prev) => {
        if (!prev) return prev;
        if (prev.mode === "resize") {
          // Resize end only; end >= start + 1
          const newEnd = clamp(slot + 1, prev.ghostStartSlot + 1, SLOTS_PER_DAY);
          return { ...prev, ghostEndSlot: newEnd };
        }
        // Move: keep duration; cursor stays at original grab offset
        const dur = prev.originalEndSlot - prev.originalStartSlot;
        let newStart = slot - prev.grabOffsetSlot;
        newStart = clamp(newStart, 0, SLOTS_PER_DAY - dur);
        return {
          ...prev,
          ghostDayIdx: dayIdx,
          ghostStartSlot: newStart,
          ghostEndSlot: newStart + dur,
        };
      });
    };
    const onUp = async () => {
      const d = itemDrag;
      setItemDrag(null);
      if (!d) return;
      const startDate = new Date(days[d.ghostDayIdx]);
      startDate.setHours(0, d.ghostStartSlot * SLOT_MIN, 0, 0);
      const endDate = new Date(days[d.ghostDayIdx]);
      endDate.setHours(0, d.ghostEndSlot * SLOT_MIN, 0, 0);

      // No-op if unchanged
      if (
        d.originalDayIdx === d.ghostDayIdx &&
        d.originalStartSlot === d.ghostStartSlot &&
        d.originalEndSlot === d.ghostEndSlot
      ) {
        return;
      }

      try {
        if (d.kind === "EVENT") {
          const orig = events.find((e) => e.id === d.itemKey);
          if (!orig) return;
          await updateEvent(d.itemKey, {
            ...orig,
            start_date: fmtDate(startDate),
            start_at: isoWithZone(startDate),
            end_at: isoWithZone(endDate),
          });
        } else {
          const orig = entries.find((e) => e.id === d.itemKey);
          if (!orig) return;
          await updateTimeEntry(d.itemKey, {
            ...orig,
            work_date: fmtDate(startDate),
            start_at: isoWithZone(startDate),
            end_at: isoWithZone(endDate),
            hours: (endDate.getTime() - startDate.getTime()) / 3600000,
          });
        }
        await refreshItems();
      } catch (err) {
        console.error("item drag commit failed", err);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setItemDrag(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [itemDrag, days, events, entries, updateEvent, updateTimeEntry, refreshItems]);

  async function submitEvent(
    title: string,
    description: string,
    ticketId: string | null,
    start: Date,
    end: Date,
  ) {
    if (!title.trim()) return;
    await createEvent({
      title,
      description,
      start_date: fmtDate(start),
      start_at: isoWithZone(start),
      end_at: isoWithZone(end),
      ticket_id: ticketId,
    });
    setSelection(null);
    await refreshItems();
  }

  async function submitTime(ticketId: string | null, note: string, start: Date, end: Date) {
    const hours = (end.getTime() - start.getTime()) / 3600000;
    await createTime({
      ticket_id: ticketId,
      hours,
      work_date: fmtDate(start),
      start_at: isoWithZone(start),
      end_at: isoWithZone(end),
      note,
    });
    setSelection(null);
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

  function startItemDrag(
    item: CalendarItem,
    mode: "move" | "resize",
    e: React.MouseEvent,
    dayIdx: number,
  ) {
    e.preventDefault();
    e.stopPropagation();
    if (!item.start_at) return;
    const itemKey = item.kind === "EVENT" ? item.event_id : item.entry_id;
    if (!itemKey) return;
    const start = new Date(item.start_at);
    const end = item.end_at ? new Date(item.end_at) : new Date(start.getTime() + 30 * 60000);
    const startSlot = Math.floor((start.getHours() * 60 + start.getMinutes()) / SLOT_MIN);
    const endSlot = Math.ceil((end.getHours() * 60 + end.getMinutes()) / SLOT_MIN);
    // Compute grab offset by mouse y within the item rect
    const rect = (e.currentTarget as HTMLElement).closest<HTMLElement>(".positioned-item")!.getBoundingClientRect();
    const offsetPx = e.clientY - rect.top;
    const grabOffsetSlot = clamp(Math.floor(offsetPx / SLOT_PX), 0, endSlot - startSlot - 1);
    setItemDrag({
      itemKey,
      kind: item.kind === "EVENT" ? "EVENT" : "TIME_ENTRY",
      mode,
      originalDayIdx: dayIdx,
      originalStartSlot: startSlot,
      originalEndSlot: endSlot,
      grabOffsetSlot,
      ghostDayIdx: dayIdx,
      ghostStartSlot: startSlot,
      ghostEndSlot: endSlot,
    });
  }

  const todayStr = fmtDate(new Date());
  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];

  return (
    <>
      <div className={`week-view panel ${drag || itemDrag ? "dragging" : ""}`} style={{ padding: 0 }}>
        <div className="week-grid">
          <div className="week-gutter week-header" />
          {days.map((d) => {
            const isToday = fmtDate(d) === todayStr;
            return (
              <div key={d.toISOString()} className={`week-header ${isToday ? "today" : ""}`}>
                <div className="muted">{dayNames[d.getDay()]}</div>
                <div style={{ fontWeight: 600 }}>{d.getMonth() + 1}/{d.getDate()}</div>
                <div className="muted col-split-label">予定 | 工数</div>
              </div>
            );
          })}

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

          <div className="week-gutter time-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="hour-label">{pad(h)}:00</div>
            ))}
          </div>

          {days.map((d, dayIdx) => {
            const ds = fmtDate(d);
            const timed = (itemsByDay.get(ds) ?? []).filter((it) => !!it.start_at);
            return (
              <div key={"col-" + ds} className="day-col" style={{ height: DAY_PX }}>
                {Array.from({ length: SLOTS_PER_DAY }, (_, i) => (
                  <div
                    key={i}
                    className={`slot ${i % 4 === 3 ? "hour-end" : ""}`}
                    style={{ height: SLOT_PX }}
                    data-slot={i}
                    data-day-idx={dayIdx}
                    onMouseDown={(e) => {
                      if (itemDrag) return;
                      e.preventDefault();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const side: Kind = e.clientX - r.left < r.width / 2 ? "EVENT" : "TIME_ENTRY";
                      setDrag({ dayIdx, anchorSlot: i, currentSlot: i, side });
                    }}
                    onMouseEnter={() => {
                      if (drag && drag.dayIdx === dayIdx) {
                        setDrag({ ...drag, currentSlot: i });
                      }
                    }}
                  />
                ))}

                {drag && drag.dayIdx === dayIdx && <DragPreview drag={drag} />}

                {ds === nowDateStr && (
                  <div
                    className="now-line"
                    style={{ top: (nowMinutes / SLOT_MIN) * SLOT_PX }}
                    title={`現在: ${pad(now.getHours())}:${pad(now.getMinutes())}`}
                  >
                    <span className="now-dot" />
                  </div>
                )}

                {timed.map((it) => {
                  const key = (it.kind === "EVENT" ? it.event_id : it.entry_id) ?? "";
                  if (itemDrag && itemDrag.itemKey === key && itemDrag.ghostDayIdx !== dayIdx) {
                    return null; // moved to another day
                  }
                  return (
                    <PositionedItem
                      key={key}
                      item={it}
                      ghosted={Boolean(itemDrag && itemDrag.itemKey === key)}
                      ghost={
                        itemDrag && itemDrag.itemKey === key && itemDrag.ghostDayIdx === dayIdx
                          ? { startSlot: itemDrag.ghostStartSlot, endSlot: itemDrag.ghostEndSlot }
                          : null
                      }
                      onMoveStart={(e) => startItemDrag(it, "move", e, dayIdx)}
                      onResizeStart={(e) => startItemDrag(it, "resize", e, dayIdx)}
                    />
                  );
                })}

                {/* Render ghost preview when item moved here from another day */}
                {itemDrag && itemDrag.ghostDayIdx === dayIdx && itemDrag.originalDayIdx !== dayIdx && (
                  <GhostBlock
                    kind={itemDrag.kind}
                    startSlot={itemDrag.ghostStartSlot}
                    endSlot={itemDrag.ghostEndSlot}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selection && (
        <SelectionDialog
          selection={selection}
          tickets={tickets}
          onChange={setSelection}
          onCancel={() => setSelection(null)}
          onSubmitEvent={submitEvent}
          onSubmitTime={submitTime}
        />
      )}
    </>
  );
}

function DragPreview({ drag }: { drag: DragState }) {
  const start = Math.min(drag.anchorSlot, drag.currentSlot);
  const end = Math.max(drag.anchorSlot, drag.currentSlot) + 1;
  const top = start * SLOT_PX;
  const height = (end - start) * SLOT_PX;
  const startMin = start * SLOT_MIN;
  const endMin = end * SLOT_MIN;
  const sideStyle = drag.side === "EVENT"
    ? { left: 2, right: "calc(50% + 1px)" }
    : { left: "calc(50% + 1px)", right: 2 };
  return (
    <div className={`drag-preview ${drag.side === "EVENT" ? "ev" : "tm"}`} style={{ top, height, ...sideStyle }}>
      <div className="drag-preview-label">
        {pad(Math.floor(startMin / 60))}:{pad(startMin % 60)}
        {" – "}
        {pad(Math.floor(endMin / 60))}:{pad(endMin % 60)}
      </div>
    </div>
  );
}

function GhostBlock({
  kind, startSlot, endSlot,
}: { kind: Kind; startSlot: number; endSlot: number }) {
  const top = startSlot * SLOT_PX;
  const height = (endSlot - startSlot) * SLOT_PX;
  const sideStyle: React.CSSProperties = kind === "EVENT"
    ? { left: 2, right: "calc(50% + 1px)" }
    : { left: "calc(50% + 1px)", right: 2 };
  return <div className={`ghost-block ${kind === "EVENT" ? "ev" : "tm"}`} style={{ top, height, ...sideStyle }} />;
}

interface PositionedProps {
  item: CalendarItem;
  ghosted: boolean;
  ghost: { startSlot: number; endSlot: number } | null;
  onMoveStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent) => void;
}

function PositionedItem({ item, ghosted, ghost, onMoveStart, onResizeStart }: PositionedProps) {
  const ref = useRef<HTMLDivElement>(null);
  const start = new Date(item.start_at!);
  const end = item.end_at ? new Date(item.end_at) : new Date(start.getTime() + 30 * 60 * 1000);
  const startMin = start.getHours() * 60 + start.getMinutes();
  const durMin = Math.max(15, (end.getTime() - start.getTime()) / 60000);
  let top = (startMin / SLOT_MIN) * SLOT_PX;
  let height = (durMin / SLOT_MIN) * SLOT_PX;
  if (ghost) {
    top = ghost.startSlot * SLOT_PX;
    height = (ghost.endSlot - ghost.startSlot) * SLOT_PX;
  }
  const cls = item.kind === "EVENT" ? "event" : "time";
  const sideStyle: React.CSSProperties = item.kind === "EVENT"
    ? { left: 2, right: "calc(50% + 1px)" }
    : { left: "calc(50% + 1px)", right: 2 };
  const time = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const label = item.kind === "TIME_ENTRY"
    ? `${time} · ${item.hours}h · ${item.title}`
    : `${time} · ${item.title}`;
  return (
    <div
      ref={ref}
      className={`positioned-item ${cls} ${ghosted ? "ghosted" : ""}`}
      style={{ top, height, ...sideStyle }}
      title={label + " (ドラッグで移動 / 下端でリサイズ)"}
      onMouseDown={onMoveStart}
    >
      <div className="ttl">{label}</div>
      <div className="resize-handle" onMouseDown={onResizeStart} title="ドラッグでリサイズ" />
    </div>
  );
}

// ===== Modal dialog =====
function SelectionDialog({
  selection,
  tickets,
  onChange,
  onCancel,
  onSubmitEvent,
  onSubmitTime,
}: {
  selection: Selection;
  tickets: { id: string; title: string; type: string }[];
  onChange: (s: Selection) => void;
  onCancel: () => void;
  onSubmitEvent: (title: string, description: string, ticketId: string | null, start: Date, end: Date) => Promise<void>;
  onSubmitTime: (ticketId: string | null, note: string, start: Date, end: Date) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [eventTicketId, setEventTicketId] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const startDate = useMemo(() => {
    const d = new Date(selection.date);
    d.setHours(0, selection.startMin, 0, 0);
    return d;
  }, [selection]);
  const endDate = useMemo(() => {
    const d = new Date(selection.date);
    d.setHours(0, selection.endMin, 0, 0);
    return d;
  }, [selection]);
  const durationMin = selection.endMin - selection.startMin;

  function fmtDayHeader() {
    const d = selection.date;
    const wn = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} (${wn})`;
  }

  async function onAdd() {
    if (selection.kind === "EVENT") {
      await onSubmitEvent(title, description, eventTicketId || null, startDate, endDate);
    } else {
      await onSubmitTime(ticketId || null, note, startDate, endDate);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 style={{ margin: 0 }}>新規追加</h3>
          <button className="secondary modal-close" onClick={onCancel} aria-label="閉じる">×</button>
        </div>

        <div className="modal-body">
          <div className="row" style={{ marginBottom: 8 }}>
            <button
              className={selection.kind === "EVENT" ? "" : "secondary"}
              onClick={() => onChange({ ...selection, kind: "EVENT" })}
            >予定</button>
            <button
              className={selection.kind === "TIME_ENTRY" ? "" : "secondary"}
              onClick={() => onChange({ ...selection, kind: "TIME_ENTRY" })}
            >工数</button>
          </div>

          <div className="muted" style={{ marginBottom: 8 }}>{fmtDayHeader()}</div>

          <div className="row" style={{ marginBottom: 12 }}>
            <label className="muted" style={{ width: 50 }}>開始</label>
            <TimeSelect
              minutes={selection.startMin}
              onChange={(m) => onChange({ ...selection, startMin: Math.min(m, selection.endMin - SLOT_MIN) })}
            />
            <label className="muted" style={{ width: 30, textAlign: "right" }}>終了</label>
            <TimeSelect
              minutes={selection.endMin}
              onChange={(m) => onChange({ ...selection, endMin: Math.max(m, selection.startMin + SLOT_MIN) })}
            />
            <span className="muted">
              ({durationMin < 60 ? `${durationMin}分` : `${(durationMin / 60).toFixed(durationMin % 60 === 0 ? 0 : 2)}時間`})
            </span>
          </div>

          {selection.kind === "EVENT" ? (
            <>
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
                <select
                  value={eventTicketId}
                  onChange={(e) => setEventTicketId(e.target.value)}
                  style={{ flex: 1, minWidth: 280 }}
                >
                  <option value="">(関連チケットなし)</option>
                  {tickets.map((t) => (
                    <option key={t.id} value={t.id}>[{t.type}] {t.title}</option>
                  ))}
                </select>
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <input
                  placeholder="メモ (任意)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={{ flex: 1 }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="row">
                <select
                  value={ticketId}
                  onChange={(e) => setTicketId(e.target.value)}
                  style={{ flex: 1, minWidth: 280 }}
                  autoFocus
                >
                  <option value="">(チケット紐付けなし)</option>
                  {tickets.map((t) => (
                    <option key={t.id} value={t.id}>[{t.type}] {t.title}</option>
                  ))}
                </select>
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <input
                  placeholder="メモ (任意)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ flex: 1 }}
                />
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="secondary" onClick={onCancel}>キャンセル</button>
          <button onClick={onAdd}>追加</button>
        </div>
      </div>
    </div>
  );
}

function TimeSelect({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const options = useMemo(() => {
    const opts: { v: number; label: string }[] = [];
    for (let m = 0; m <= 24 * 60; m += SLOT_MIN) {
      opts.push({ v: m, label: `${pad(Math.floor(m / 60))}:${pad(m % 60)}` });
    }
    return opts;
  }, []);
  return (
    <select value={minutes} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map((o) => (
        <option key={o.v} value={o.v}>{o.label}</option>
      ))}
    </select>
  );
}
