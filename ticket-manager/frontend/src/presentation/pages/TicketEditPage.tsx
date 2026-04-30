import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api } from "@/infrastructure/api/client";
import { useSprints } from "@/application/hooks/useSprints";
import { useRepositories } from "@/application/hooks/useRepositories";
import { useTags } from "@/application/hooks/useTags";
import type { Repository, Ticket, TicketStatus, TicketType } from "@/domain/types";
import { TICKET_STATUSES, TICKET_TYPES } from "@/domain/types";
import { StatusBadge, TypeBadge } from "@/presentation/components/Badges";
import TagInput from "@/presentation/components/TagInput";

export default function TicketEditPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { sprints } = useSprints();
  const { repos } = useRepositories();
  const { tags: knownTags } = useTags();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Editable fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TicketType>("TASK");
  const [status, setStatus] = useState<TicketStatus>("TODO");
  const [parentId, setParentId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [estimate, setEstimate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [branch, setBranch] = useState("");
  const [sprintId, setSprintId] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  // Parent options
  const [parentChoices, setParentChoices] = useState<Ticket[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [t, all] = await Promise.all([
          api.getTicket(id),
          api.listTickets(),
        ]);
        if (!alive) return;
        setTicket(t);
        setTitle(t.title);
        setDescription(t.description);
        setType(t.type);
        setStatus(t.status);
        setParentId(t.parent_id ?? "");
        setAssignee(t.assignee ?? "");
        setEstimate(t.estimate_hours != null ? String(t.estimate_hours) : "");
        setDueDate(t.due_date ?? "");
        setRepositoryId(t.repository_id ?? "");
        setBranch(t.branch ?? "");
        setSprintId(t.sprint_id ?? "");
        setTags(t.tags);
        setParentChoices(all.filter((x) => x.id !== id && x.type !== "SUBTASK"));
      } catch (e) {
        if (alive) setLoadErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [id]);

  async function save() {
    if (!ticket) return;
    setSaving(true);
    setSavedAt(null);
    try {
      const updated = await api.updateTicket(id, {
        title,
        description,
        type,
        status,
        parent_id: parentId || null,
        assignee: assignee.trim() || null,
        estimate_hours: estimate ? Number(estimate) : null,
        due_date: dueDate || null,
        repository_id: repositoryId || null,
        branch: branch.trim() || null,
        sprint_id: sprintId || null,
      });
      // Sync tags via add/remove
      const original = new Set(ticket.tags);
      const target = new Set(tags);
      for (const t of original) if (!target.has(t)) await api.removeTag(id, t);
      for (const t of target) if (!original.has(t)) await api.addTag(id, t);
      const fresh = await api.getTicket(id);
      setTicket(fresh);
      setSavedAt(new Date().toLocaleTimeString());
      void updated;
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteTicket() {
    if (!ticket) return;
    if (!confirm(`削除しますか? "${ticket.title}"`)) return;
    await api.deleteTicket(id);
    navigate("/tickets");
  }

  if (loadErr) {
    return (
      <div className="panel">
        <h1>チケット編集</h1>
        <p style={{ color: "red" }}>{loadErr}</p>
        <Link to="/tickets">← チケット一覧へ</Link>
      </div>
    );
  }
  if (!ticket) return <div className="panel">読み込み中...</div>;

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Link to="/tickets" className="muted">← チケット一覧</Link>
      </div>
      <h1 style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <TypeBadge value={ticket.type} />
        チケット編集
        <StatusBadge value={ticket.status} />
      </h1>

      <div className="panel">
        <div className="row">
          <input
            placeholder="タイトル"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ flex: 1, minWidth: 280, fontSize: 16 }}
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
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} style={{ minWidth: 240 }}>
            <option value="">(親なし)</option>
            {parentChoices.map((p) => (
              <option key={p.id} value={p.id}>[{p.type}] {p.title}</option>
            ))}
          </select>
          <select value={sprintId} onChange={(e) => setSprintId(e.target.value)} style={{ minWidth: 200 }}>
            <option value="">(バックログ)</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>{s.name} [{s.state}]</option>
            ))}
          </select>
          <input placeholder="担当者" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <input
            type="number"
            step="0.25"
            placeholder="見積 (h)"
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            style={{ width: 110 }}
          />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <select value={repositoryId} onChange={(e) => setRepositoryId(e.target.value)}>
            <option value="">(リポジトリ未指定)</option>
            {repos.map((r: Repository) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <input
            placeholder="ブランチ名"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            style={{ flex: 1, minWidth: 220 }}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <TagInput
            value={tags}
            onChange={setTags}
            suggestions={knownTags.map((t) => t.name)}
            placeholder="タグ (Enter で追加)"
          />
        </div>
        <textarea
          placeholder="詳細"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ width: "100%", marginTop: 8, minHeight: 140 }}
        />

        <div className="row" style={{ marginTop: 12, justifyContent: "space-between" }}>
          <div className="row">
            <button onClick={save} disabled={!title.trim() || saving}>保存</button>
            <button className="secondary" onClick={() => navigate("/tickets")}>戻る</button>
            {savedAt && <span className="muted">保存: {savedAt}</span>}
          </div>
          <button className="danger" onClick={deleteTicket}>削除</button>
        </div>
      </div>

      <div className="panel">
        <p className="muted" style={{ margin: 0, fontSize: 11 }}>
          作成: {new Date(ticket.created_at).toLocaleString()} ・ 更新: {new Date(ticket.updated_at).toLocaleString()}
        </p>
      </div>
    </>
  );
}
