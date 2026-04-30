import { useMemo, useState } from "react";
import { useCalendarRange, useEvents } from "@/application/hooks/useCalendar";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarPage() {
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));

  const monthStart = startOfMonth(cursor);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay()); // Sunday
  const gridEnd = new Date(monthEnd);
  gridEnd.setDate(monthEnd.getDate() + (6 - monthEnd.getDay()));

  const { items } = useCalendarRange(fmt(gridStart), fmt(gridEnd));
  const { events, create, remove } = useEvents();

  const byDate = useMemo(() => {
    const m = new Map<string, typeof items>();
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
  const today = fmt(new Date());

  const [eventTitle, setEventTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventDesc, setEventDesc] = useState("");

  return (
    <>
      <h1>カレンダー</h1>

      <div className="panel row">
        <button className="secondary" onClick={() => setCursor(addMonths(cursor, -1))}>← 前月</button>
        <strong>{cursor.getFullYear()}年 {cursor.getMonth() + 1}月</strong>
        <button className="secondary" onClick={() => setCursor(addMonths(cursor, 1))}>次月 →</button>
        <button className="secondary" onClick={() => setCursor(startOfMonth(new Date()))}>今月</button>
      </div>

      <div className="calendar">
        {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
          <div key={d} className="cell" style={{ minHeight: "auto", textAlign: "center", fontWeight: 600 }}>{d}</div>
        ))}
        {days.map((d) => {
          const ds = fmt(d);
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

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>カレンダーイベント</h3>
        <div className="row" style={{ marginBottom: 12 }}>
          <input
            placeholder="タイトル"
            value={eventTitle}
            onChange={(e) => setEventTitle(e.target.value)}
            style={{ flex: 1 }}
          />
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
          />
          <input
            placeholder="メモ"
            value={eventDesc}
            onChange={(e) => setEventDesc(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            onClick={async () => {
              if (!eventTitle || !eventDate) return;
              await create({ title: eventTitle, start_date: eventDate, description: eventDesc });
              setEventTitle("");
              setEventDate("");
              setEventDesc("");
            }}
          >
            追加
          </button>
        </div>
        <table>
          <thead>
            <tr><th>日付</th><th>タイトル</th><th>メモ</th><th></th></tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{e.start_date}</td>
                <td>{e.title}</td>
                <td>{e.description}</td>
                <td><button className="danger" onClick={() => remove(e.id)}>削除</button></td>
              </tr>
            ))}
            {events.length === 0 && <tr><td colSpan={4} className="muted">なし</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
