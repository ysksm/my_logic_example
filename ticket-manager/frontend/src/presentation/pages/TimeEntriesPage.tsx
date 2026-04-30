import { useMemo, useState } from "react";
import { useTimeEntries } from "@/application/hooks/useTimeEntries";
import { useTickets } from "@/application/hooks/useTickets";

export default function TimeEntriesPage() {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayStr);
  const [ticketId, setTicketId] = useState("");
  const [hours, setHours] = useState("1");
  const [workDate, setWorkDate] = useState(todayStr);
  const [note, setNote] = useState("");
  const [user, setUser] = useState("");

  const { entries, error, create, remove } = useTimeEntries({ from, to });
  const { tickets } = useTickets();

  const totalHours = useMemo(
    () => entries.reduce((s, e) => s + e.hours, 0),
    [entries],
  );

  return (
    <>
      <h1>工数</h1>

      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!hours || !workDate) return;
          await create({
            ticket_id: ticketId || null,
            hours: Number(hours),
            work_date: workDate,
            note,
            user,
          });
          setHours("1");
          setNote("");
        }}
      >
        <h3 style={{ marginTop: 0 }}>工数登録</h3>
        <div className="row">
          <select value={ticketId} onChange={(e) => setTicketId(e.target.value)} style={{ minWidth: 300 }}>
            <option value="">(チケット紐付けなし)</option>
            {tickets.map((t) => (
              <option key={t.id} value={t.id}>[{t.type}] {t.title}</option>
            ))}
          </select>
          <input type="number" step="0.25" min="0.25" value={hours} onChange={(e) => setHours(e.target.value)} style={{ width: 90 }} />
          <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
          <input placeholder="担当者" value={user} onChange={(e) => setUser(e.target.value)} />
          <input placeholder="メモ" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} />
          <button type="submit">登録</button>
        </div>
      </form>

      <div className="panel">
        <div className="row" style={{ marginBottom: 8 }}>
          <strong>期間:</strong>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span>〜</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <span className="muted">合計: {totalHours.toFixed(2)} h</span>
        </div>
        {error && <p style={{ color: "red" }}>{error}</p>}
        <table>
          <thead>
            <tr><th>日付</th><th>チケット</th><th>担当者</th><th>時間</th><th>メモ</th><th></th></tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{e.work_date}</td>
                <td>{e.ticket_title || e.ticket_id || "-"}</td>
                <td>{e.user || "-"}</td>
                <td>{e.hours.toFixed(2)} h</td>
                <td>{e.note}</td>
                <td><button className="danger" onClick={() => remove(e.id)}>削除</button></td>
              </tr>
            ))}
            {entries.length === 0 && <tr><td colSpan={6} className="muted">なし</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
