import { useEffect, useRef, useState } from "react";
import type { TicketCreate, TicketStatus, TicketType, Repository } from "@/domain/types";
import { TICKET_STATUSES, TICKET_TYPES } from "@/domain/types";

export interface TicketFormPreset {
  parent_id: string;
  parent_label: string;
  // child type to default to (computed from parent type)
  child_type?: TicketType;
}

interface Props {
  parents: { id: string; title: string }[];
  repositories: Repository[];
  onSubmit: (t: TicketCreate) => Promise<void>;
  preset?: TicketFormPreset | null;
  onClearPreset?: () => void;
}

export default function TicketForm({ parents, repositories, onSubmit, preset, onClearPreset }: Props) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TicketType>("TASK");
  const [status, setStatus] = useState<TicketStatus>("TODO");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [estimate, setEstimate] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [branch, setBranch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (preset) {
      setParentId(preset.parent_id);
      if (preset.child_type) setType(preset.child_type);
      titleRef.current?.focus();
    }
  }, [preset]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title) return;
    setSubmitting(true);
    try {
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await onSubmit({
        title,
        type,
        status,
        description: description || undefined,
        parent_id: parentId || null,
        assignee: assignee || null,
        due_date: dueDate || null,
        estimate_hours: estimate ? Number(estimate) : null,
        tags,
        repository_id: repositoryId || null,
        branch: branch || null,
      });
      setTitle("");
      setDescription("");
      setAssignee("");
      setDueDate("");
      setEstimate("");
      setTagsText("");
      setBranch("");
      // Keep parentId so user can rapidly add multiple children of the same parent.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h3 style={{ marginTop: 0 }}>
        {preset ? `子チケット作成 (親: ${preset.parent_label})` : "チケット作成"}
      </h3>
      {preset && (
        <div className="muted" style={{ marginBottom: 8 }}>
          ↳ 親: <strong>{preset.parent_label}</strong>
          {onClearPreset && (
            <button
              type="button"
              className="secondary"
              style={{ marginLeft: 8, padding: "2px 8px", fontSize: 11 }}
              onClick={() => {
                setParentId("");
                onClearPreset();
              }}
            >
              親を解除
            </button>
          )}
        </div>
      )}
      <div className="row">
        <input
          ref={titleRef}
          placeholder="タイトル"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ flex: 1, minWidth: 260 }}
          required
        />
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
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">(親なし)</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
        <input placeholder="担当者" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <input
          type="number"
          step="0.25"
          placeholder="見積 (h)"
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
          style={{ width: 100 }}
        />
        <input
          placeholder="タグ (カンマ区切り)"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <select value={repositoryId} onChange={(e) => setRepositoryId(e.target.value)}>
          <option value="">(リポジトリ未指定)</option>
          {repositories.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <input
          placeholder="ブランチ名 (任意)"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
      </div>
      <textarea
        placeholder="詳細"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        style={{ width: "100%", marginTop: 8, minHeight: 60 }}
      />
      <div style={{ marginTop: 8 }}>
        <button type="submit" disabled={submitting}>追加</button>
      </div>
    </form>
  );
}

// Default child type given a parent's type.
export function childTypeFor(parent: TicketType): TicketType {
  switch (parent) {
    case "EPIC": return "STORY";
    case "STORY": return "TASK";
    case "TASK": return "SUBTASK";
    case "SUBTASK": return "SUBTASK";
  }
}
