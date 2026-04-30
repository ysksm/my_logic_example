import { useMemo, useState } from "react";
import { useTickets } from "@/application/hooks/useTickets";
import { useRepositories } from "@/application/hooks/useRepositories";
import { useTags } from "@/application/hooks/useTags";
import type { Ticket, TicketStatus, TicketType } from "@/domain/types";
import { TICKET_STATUSES, TICKET_TYPES } from "@/domain/types";
import { StatusBadge, TypeBadge } from "@/presentation/components/Badges";
import TicketForm, { childTypeFor, type TicketFormPreset } from "@/presentation/components/TicketForm";

type ViewMode = "list" | "tree";

export default function TicketsPage() {
  const [filterType, setFilterType] = useState<TicketType | "">("");
  const [filterStatus, setFilterStatus] = useState<TicketStatus | "">("");
  const [filterTag, setFilterTag] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [preset, setPreset] = useState<TicketFormPreset | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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

  // Visible rows in display order. List mode: server order. Tree mode: pre-order
  // DFS from roots (parents not present in the filtered set are demoted to roots).
  const visible = useMemo<Array<{ t: Ticket; depth: number; hasChildren: boolean }>>(() => {
    if (viewMode === "list") {
      return tickets.map((t) => ({ t, depth: 0, hasChildren: false }));
    }
    const idSet = new Set(tickets.map((t) => t.id));
    const childMap = new Map<string | null, Ticket[]>();
    for (const t of tickets) {
      const key = t.parent_id && idSet.has(t.parent_id) ? t.parent_id : null;
      const arr = childMap.get(key) ?? [];
      arr.push(t);
      childMap.set(key, arr);
    }
    const out: Array<{ t: Ticket; depth: number; hasChildren: boolean }> = [];
    const walk = (parentKey: string | null, depth: number) => {
      const kids = childMap.get(parentKey) ?? [];
      for (const k of kids) {
        const has = (childMap.get(k.id) ?? []).length > 0;
        out.push({ t: k, depth, hasChildren: has });
        if (!collapsed.has(k.id)) walk(k.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [tickets, viewMode, collapsed]);

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
        <div className="row" style={{ marginBottom: 8, justifyContent: "space-between" }}>
          <div className="row">
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
          <div className="row">
            <button
              className={viewMode === "list" ? "" : "secondary"}
              onClick={() => setViewMode("list")}
            >一覧</button>
            <button
              className={viewMode === "tree" ? "" : "secondary"}
              onClick={() => setViewMode("tree")}
            >ツリー</button>
            {viewMode === "tree" && collapsed.size > 0 && (
              <button className="secondary" onClick={() => setCollapsed(new Set())}>
                すべて展開
              </button>
            )}
          </div>
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
            {visible.map(({ t, depth, hasChildren }) => (
              <TicketRow
                key={t.id}
                t={t}
                depth={viewMode === "tree" ? depth : 0}
                isTree={viewMode === "tree"}
                hasChildren={hasChildren}
                isCollapsed={collapsed.has(t.id)}
                onToggleCollapsed={() => toggleCollapsed(t.id)}
                allRepos={repos}
                childCount={childrenByParent.get(t.id)?.length ?? 0}
                onChangeStatus={(s) => update(t.id, { status: s, type: t.type, title: t.title })}
                onDelete={() => remove(t.id)}
                onAddTag={(tag) => addTag(t.id, tag)}
                onRemoveTag={(tag) => removeTag(t.id, tag)}
                onAddChild={() => startChild(t)}
              />
            ))}
            {visible.length === 0 && (
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
  depth: number;
  isTree: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  allRepos: { id: string; name: string; default_branch: string }[];
  childCount: number;
  onChangeStatus: (s: TicketStatus) => void;
  onDelete: () => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onAddChild: () => void;
}

function TicketRow({
  t, depth, isTree, hasChildren, isCollapsed, onToggleCollapsed,
  allRepos, childCount, onChangeStatus, onDelete, onAddTag, onRemoveTag, onAddChild,
}: RowProps) {
  const [newTag, setNewTag] = useState("");
  const repo = allRepos.find((r) => r.id === t.repository_id);
  const canAddChild = t.type !== "SUBTASK";
  return (
    <tr>
      <td><TypeBadge value={t.type} /></td>
      <td>
        <div style={{ paddingLeft: isTree ? depth * 18 : 0, display: "flex", alignItems: "flex-start" }}>
          {isTree ? (
            <span
              style={{
                display: "inline-block",
                width: 16,
                cursor: hasChildren ? "pointer" : "default",
                color: "var(--muted)",
                userSelect: "none",
              }}
              onClick={hasChildren ? onToggleCollapsed : undefined}
              title={hasChildren ? (isCollapsed ? "展開" : "折りたたみ") : undefined}
            >
              {hasChildren ? (isCollapsed ? "▶" : "▼") : ""}
            </span>
          ) : (
            t.parent_id && <span className="muted">↳ </span>
          )}
          <div style={{ flex: 1 }}>
            {t.title}
            {childCount > 0 && (
              <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>(子 {childCount})</span>
            )}
            {t.description && <div className="muted" style={{ marginTop: 4 }}>{t.description}</div>}
          </div>
        </div>
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
