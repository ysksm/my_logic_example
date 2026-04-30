import { useEffect, useState } from "react";
import type { Sprint, Ticket, TicketCreate, TicketStatus, TicketType } from "@/domain/types";
import { TICKET_STATUSES, TICKET_TYPES } from "@/domain/types";

interface Props {
  ticket: Ticket;
  sprints?: Sprint[];
  onCancel: () => void;
  onSave: (patch: Partial<TicketCreate>) => Promise<void>;
}

// Quick edit modal: title / type / status / assignee / sprint / due_date.
// More detailed editing (description, repository, branch, tags) is on the
// dedicated /tickets/:id page.
export default function EditTicketDialog({ ticket, sprints = [], onCancel, onSave }: Props) {
  const [title, setTitle] = useState(ticket.title);
  const [type, setType] = useState<TicketType>(ticket.type);
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [assignee, setAssignee] = useState(ticket.assignee ?? "");
  const [sprintId, setSprintId] = useState<string>(ticket.sprint_id ?? "");
  const [dueDate, setDueDate] = useState(ticket.due_date ?? "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function save() {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSave({
        title: title.trim(),
        type,
        status,
        assignee: assignee.trim() || null,
        sprint_id: sprintId || null,
        due_date: dueDate || null,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 style={{ margin: 0 }}>チケット編集</h3>
          <button className="secondary modal-close" onClick={onCancel} aria-label="閉じる">×</button>
        </div>
        <div className="modal-body">
          <div className="row">
            <input
              placeholder="タイトル"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
              style={{ flex: 1 }}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <select value={type} onChange={(e) => setType(e.target.value as TicketType)}>
              {TICKET_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as TicketStatus)}>
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <input
              placeholder="担当者"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              style={{ flex: 1, minWidth: 160 }}
            />
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <select value={sprintId} onChange={(e) => setSprintId(e.target.value)} style={{ minWidth: 200 }}>
              <option value="">(バックログ)</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>{s.name} [{s.state}]</option>
              ))}
            </select>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              placeholder="期日"
            />
          </div>
          <p className="muted" style={{ marginTop: 6, fontSize: 11 }}>
            Enter: 保存 / ESC: キャンセル / 詳細編集はチケットの「別タブ」を開いてください。
          </p>
        </div>
        <div className="modal-foot">
          <button className="secondary" onClick={onCancel}>キャンセル</button>
          <button onClick={save} disabled={!title.trim() || submitting}>保存</button>
        </div>
      </div>
    </div>
  );
}
