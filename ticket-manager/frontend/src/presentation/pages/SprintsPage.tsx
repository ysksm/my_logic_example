import { useMemo, useState } from "react";
import { useSprints } from "@/application/hooks/useSprints";
import { useTickets } from "@/application/hooks/useTickets";
import type { Sprint, SprintState, Ticket } from "@/domain/types";
import { SPRINT_STATES } from "@/domain/types";
import { StatusBadge, TypeBadge } from "@/presentation/components/Badges";
import EditTicketDialog from "@/presentation/components/EditTicketDialog";
import TicketDetailLink from "@/presentation/components/TicketDetailLink";

export default function SprintsPage() {
  const { sprints, create, update, remove } = useSprints();
  const { tickets, update: updateTicket } = useTickets();
  const [editing, setEditing] = useState<Ticket | null>(null);

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const ticketsBySprint = useMemo(() => {
    const m = new Map<string, Ticket[]>();
    for (const t of tickets) {
      const k = t.sprint_id ?? "__backlog__";
      const arr = m.get(k) ?? [];
      arr.push(t);
      m.set(k, arr);
    }
    return m;
  }, [tickets]);

  const backlog = ticketsBySprint.get("__backlog__") ?? [];

  async function moveTicket(ticketId: string, sprintId: string | null) {
    const t = tickets.find((x) => x.id === ticketId);
    if (!t) return;
    if (t.sprint_id === sprintId) return;
    await updateTicket(ticketId, {
      ...t,
      sprint_id: sprintId,
    });
  }

  return (
    <>
      <h1>スプリント / バックログ</h1>

      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name) return;
          await create({
            name,
            goal,
            state: "PLANNED",
            start_date: startDate || null,
            end_date: endDate || null,
          });
          setName("");
          setGoal("");
          setStartDate("");
          setEndDate("");
        }}
      >
        <h3 style={{ marginTop: 0 }}>新規スプリント</h3>
        <div className="row">
          <input
            placeholder="名前 (Sprint 1 など)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1, minWidth: 220 }}
            required
          />
          <input
            placeholder="ゴール (任意)"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <span>〜</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <button type="submit">作成</button>
        </div>
      </form>

      {sprints.map((s) => (
        <SprintBlock
          key={s.id}
          sprint={s}
          tickets={ticketsBySprint.get(s.id) ?? []}
          onUpdate={(patch) => update(s.id, { ...s, ...patch })}
          onDelete={() => remove(s.id)}
          onDropTicket={(ticketId) => moveTicket(ticketId, s.id)}
          onEditTicket={(t) => setEditing(t)}
        />
      ))}

      <BacklogBlock
        tickets={backlog}
        onDropTicket={(ticketId) => moveTicket(ticketId, null)}
        onEditTicket={(t) => setEditing(t)}
      />

      {editing && (
        <EditTicketDialog
          ticket={editing}
          sprints={sprints}
          onCancel={() => setEditing(null)}
          onSave={async (patch) => {
            await updateTicket(editing.id, patch);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function SprintBlock({
  sprint, tickets, onUpdate, onDelete, onDropTicket, onEditTicket,
}: {
  sprint: Sprint;
  tickets: Ticket[];
  onUpdate: (patch: Partial<Sprint>) => Promise<void>;
  onDelete: () => Promise<void>;
  onDropTicket: (ticketId: string) => Promise<void>;
  onEditTicket: (t: Ticket) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`panel sprint-block sprint-${sprint.state.toLowerCase()} ${over ? "drop-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropTicket(id);
      }}
    >
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div className="row">
          <strong>{sprint.name}</strong>
          <span className={`badge sprint-state ${sprint.state.toLowerCase()}`}>{sprint.state}</span>
          {sprint.start_date && (
            <span className="muted">{sprint.start_date} 〜 {sprint.end_date ?? ""}</span>
          )}
          {sprint.goal && <span className="muted">🎯 {sprint.goal}</span>}
        </div>
        <div className="row">
          <select value={sprint.state} onChange={(e) => onUpdate({ state: e.target.value as SprintState })}>
            {SPRINT_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button className="danger" onClick={onDelete}>削除</button>
        </div>
      </div>

      <div className="ticket-list">
        {tickets.map((t) => <TicketCard key={t.id} t={t} onEdit={() => onEditTicket(t)} />)}
        {tickets.length === 0 && (
          <div className="muted ticket-list-empty">
            (バックログからチケットをドロップ)
          </div>
        )}
      </div>
    </div>
  );
}

function BacklogBlock({
  tickets, onDropTicket, onEditTicket,
}: {
  tickets: Ticket[];
  onDropTicket: (ticketId: string) => Promise<void>;
  onEditTicket: (t: Ticket) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`panel sprint-block backlog ${over ? "drop-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropTicket(id);
      }}
    >
      <div className="row" style={{ marginBottom: 8 }}>
        <strong>バックログ</strong>
        <span className="muted">{tickets.length} 件</span>
      </div>
      <div className="ticket-list">
        {tickets.map((t) => <TicketCard key={t.id} t={t} onEdit={() => onEditTicket(t)} />)}
        {tickets.length === 0 && (
          <div className="muted ticket-list-empty">バックログは空です</div>
        )}
      </div>
    </div>
  );
}

export function TicketCard({ t, onEdit }: { t: Ticket; onEdit: () => void }) {
  return (
    <div
      className="ticket-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", t.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="row" style={{ marginBottom: 4, gap: 6 }}>
        <TicketDetailLink id={t.id} />
        <TypeBadge value={t.type} />
        <span style={{ marginLeft: "auto" }}>
          <StatusBadge value={t.status} />
        </span>
      </div>
      <div
        className="ticket-card-title title-link"
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        onMouseDown={(e) => e.stopPropagation()}
        title="クリックで編集"
      >{t.title}</div>
      {t.assignee && <div className="muted" style={{ fontSize: 11 }}>👤 {t.assignee}</div>}
      {t.due_date && <div className="muted" style={{ fontSize: 11 }}>📅 {t.due_date}</div>}
    </div>
  );
}
