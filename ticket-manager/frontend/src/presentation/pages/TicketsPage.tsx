import { useMemo, useState } from "react";
import { useTickets } from "@/application/hooks/useTickets";
import { useRepositories } from "@/application/hooks/useRepositories";
import { useTags } from "@/application/hooks/useTags";
import type { Ticket, TicketStatus, TicketType } from "@/domain/types";
import { TICKET_STATUSES, TICKET_TYPES } from "@/domain/types";
import { StatusBadge, TypeBadge } from "@/presentation/components/Badges";
import TicketForm, { childTypeFor, type TicketFormPreset } from "@/presentation/components/TicketForm";

export default function TicketsPage() {
  const [filterType, setFilterType] = useState<TicketType | "">("");
  const [filterStatus, setFilterStatus] = useState<TicketStatus | "">("");
  const [filterTag, setFilterTag] = useState<string>("");
  const [preset, setPreset] = useState<TicketFormPreset | null>(null);

  const { tickets, error, create, update, remove, addTag, removeTag } = useTickets({
    type: filterType || undefined,
    status: filterStatus || undefined,
    tag: filterTag || undefined,
  });
  const { repos } = useRepositories();
  const { tags } = useTags();

  const parents = useMemo(
    () => tickets.filter((t) => t.type !== "SUBTASK").map((t) => ({ id: t.id, title: `[${t.type}] ${t.title}` })),
    [tickets],
  );

  // index children by parent_id for quick lookup
  const childrenByParent = useMemo(() => {
    const m = new Map<string, Ticket[]>();
    for (const t of tickets) {
      if (!t.parent_id) continue;
      const arr = m.get(t.parent_id) ?? [];
      arr.push(t);
      m.set(t.parent_id, arr);
    }
    return m;
  }, [tickets]);

  function startChild(parent: Ticket) {
    setPreset({
      parent_id: parent.id,
      parent_label: `[${parent.type}] ${parent.title}`,
      child_type: childTypeFor(parent.type),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      <h1>チケット</h1>

      <TicketForm
        parents={parents}
        repositories={repos}
        onSubmit={async (t) => {
          await create(t);
          // Don't auto-clear preset: enables rapid sibling creation.
        }}
        preset={preset}
        onClearPreset={() => setPreset(null)}
      />

      <div className="panel">
        <div className="row" style={{ marginBottom: 8 }}>
          <strong>フィルタ:</strong>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as TicketType | "")}>
            <option value="">All Types</option>
            {TICKET_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as TicketStatus | "")}>
            <option value="">All Status</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
            <option value="">All Tags</option>
            {tags.map((t) => (
              <option key={t.name}>{t.name}</option>
            ))}
          </select>
        </div>

        {error && <p style={{ color: "red" }}>{error}</p>}

        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Title</th>
              <th>Status</th>
              <th>Assignee</th>
              <th>Due</th>
              <th>Est.</th>
              <th>Repo / Branch</th>
              <th>Tags</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <TicketRow
                key={t.id}
                t={t}
                allRepos={repos}
                childCount={childrenByParent.get(t.id)?.length ?? 0}
                onChangeStatus={(s) => update(t.id, { status: s, type: t.type, title: t.title })}
                onDelete={() => remove(t.id)}
                onAddTag={(tag) => addTag(t.id, tag)}
                onRemoveTag={(tag) => removeTag(t.id, tag)}
                onAddChild={() => startChild(t)}
              />
            ))}
            {tickets.length === 0 && (
              <tr><td colSpan={9} className="muted">該当なし</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface RowProps {
  t: Ticket;
  allRepos: { id: string; name: string; default_branch: string }[];
  childCount: number;
  onChangeStatus: (s: TicketStatus) => void;
  onDelete: () => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onAddChild: () => void;
}

function TicketRow({ t, allRepos, childCount, onChangeStatus, onDelete, onAddTag, onRemoveTag, onAddChild }: RowProps) {
  const [newTag, setNewTag] = useState("");
  const repo = allRepos.find((r) => r.id === t.repository_id);
  const canAddChild = t.type !== "SUBTASK";
  return (
    <tr>
      <td><TypeBadge value={t.type} /></td>
      <td>
        {t.parent_id && <span className="muted">↳ </span>}
        {t.title}
        {childCount > 0 && (
          <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>(子 {childCount})</span>
        )}
        {t.description && <div className="muted" style={{ marginTop: 4 }}>{t.description}</div>}
      </td>
      <td>
        <select
          value={t.status}
          onChange={(e) => onChangeStatus(e.target.value as TicketStatus)}
          style={{ marginRight: 4 }}
        >
          {TICKET_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <StatusBadge value={t.status} />
      </td>
      <td>{t.assignee ?? "-"}</td>
      <td>{t.due_date ?? "-"}</td>
      <td>{t.estimate_hours != null ? `${t.estimate_hours}h` : "-"}</td>
      <td>
        {repo ? <span>{repo.name}</span> : "-"}
        {t.branch && <div className="muted">{t.branch}</div>}
      </td>
      <td>
        {t.tags.map((tag) => (
          <span key={tag} className="tag">
            {tag}
            <span className="x" onClick={() => onRemoveTag(tag)}>×</span>
          </span>
        ))}
        <input
          style={{ width: 90 }}
          placeholder="+tag"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newTag.trim()) {
              onAddTag(newTag.trim());
              setNewTag("");
            }
          }}
        />
      </td>
      <td>
        {canAddChild && (
          <button
            className="secondary"
            style={{ marginRight: 4, padding: "2px 8px" }}
            onClick={onAddChild}
            title="この行を親として子チケットを作成"
          >
            + 子
          </button>
        )}
        <button className="danger" onClick={onDelete}>削除</button>
      </td>
    </tr>
  );
}
