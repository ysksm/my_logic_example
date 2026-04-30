import { useEffect, useMemo, useState } from "react";
import { useTickets } from "@/application/hooks/useTickets";
import { useRepositories } from "@/application/hooks/useRepositories";
import { useTags } from "@/application/hooks/useTags";
import { useSprints } from "@/application/hooks/useSprints";
import type { Ticket, TicketCreate, TicketStatus, TicketType } from "@/domain/types";
import { TICKET_STATUSES, TICKET_TYPES } from "@/domain/types";
import { StatusBadge, TypeBadge } from "@/presentation/components/Badges";
import TicketForm, { childTypeFor, type TicketFormPreset } from "@/presentation/components/TicketForm";
import EditTicketDialog from "@/presentation/components/EditTicketDialog";

type ViewMode = "list" | "tree" | "mindmap" | "kanban";

export default function TicketsPage() {
  const [filterType, setFilterType] = useState<TicketType | "">("");
  const [filterStatus, setFilterStatus] = useState<TicketStatus | "">("");
  const [filterTag, setFilterTag] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [preset, setPreset] = useState<TicketFormPreset | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [quickAdd, setQuickAdd] = useState<{ parent: Ticket } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Ticket | null>(null);

  const { tickets, error, create, update, remove, addTag, removeTag } = useTickets({
    type: filterType || undefined,
    status: filterStatus || undefined,
    tag: filterTag || undefined,
  });
  const { repos } = useRepositories();
  const { tags } = useTags();
  const { sprints } = useSprints();

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

  // ===== Mindmap keyboard navigation =====
  // When in mindmap mode and no modal is open, capture arrow / Tab / Enter
  // for focus movement, child creation, and edit.
  useEffect(() => {
    if (viewMode !== "mindmap") return;
    if (quickAdd || editing) return;

    // If nothing focused, anchor to the first root ticket
    if (focusedId === null && tickets.length > 0) {
      const idSet = new Set(tickets.map((t) => t.id));
      const root = tickets.find((t) => !t.parent_id || !idSet.has(t.parent_id)) ?? tickets[0];
      setFocusedId(root.id);
      return;
    }
    if (focusedId !== null && !tickets.some((t) => t.id === focusedId)) {
      // Focused ticket disappeared (deleted / filtered out)
      setFocusedId(tickets[0]?.id ?? null);
      return;
    }

    const onKey = (e: KeyboardEvent) => {
      // Don't intercept while editing form fields elsewhere on the page
      const tgt = e.target as HTMLElement;
      if (
        tgt &&
        (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" ||
         tgt.tagName === "SELECT" || tgt.isContentEditable)
      ) {
        return;
      }
      if (focusedId === null) return;
      const focused = tickets.find((t) => t.id === focusedId);
      if (!focused) return;

      const idSet = new Set(tickets.map((t) => t.id));
      const parentKey = (t: Ticket) =>
        t.parent_id && idSet.has(t.parent_id) ? t.parent_id : null;
      const siblings = tickets.filter((t) => parentKey(t) === parentKey(focused));
      const idx = siblings.findIndex((t) => t.id === focused.id);

      switch (e.key) {
        case "Tab":
          e.preventDefault();
          if (focused.type !== "SUBTASK") setQuickAdd({ parent: focused });
          break;
        case "Enter":
          e.preventDefault();
          setEditing(focused);
          break;
        case "ArrowLeft": {
          e.preventDefault();
          const pid = parentKey(focused);
          if (pid) setFocusedId(pid);
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          const kids = tickets.filter((t) => parentKey(t) === focused.id);
          if (kids.length > 0) setFocusedId(kids[0].id);
          break;
        }
        case "ArrowUp":
          e.preventDefault();
          if (idx > 0) setFocusedId(siblings[idx - 1].id);
          break;
        case "ArrowDown":
          e.preventDefault();
          if (idx >= 0 && idx < siblings.length - 1) setFocusedId(siblings[idx + 1].id);
          break;
        case "Escape":
          e.preventDefault();
          setFocusedId(null);
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewMode, focusedId, tickets, quickAdd, editing]);

  return (
    <>
      <h1>チケット</h1>

      <TicketForm
        parents={parents}
        repositories={repos}
        tagSuggestions={tags.map((t) => t.name)}
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
            <button
              className={viewMode === "mindmap" ? "" : "secondary"}
              onClick={() => setViewMode("mindmap")}
            >マインドマップ</button>
            <button
              className={viewMode === "kanban" ? "" : "secondary"}
              onClick={() => setViewMode("kanban")}
            >看板</button>
            {viewMode === "tree" && collapsed.size > 0 && (
              <button className="secondary" onClick={() => setCollapsed(new Set())}>
                すべて展開
              </button>
            )}
          </div>
        </div>

        {error && <p style={{ color: "red" }}>{error}</p>}

        {viewMode === "kanban" ? (
          <Kanban
            tickets={tickets}
            onChangeStatus={(id, s) => {
              const t = tickets.find((x) => x.id === id);
              if (!t) return;
              update(id, { ...t, status: s });
            }}
            onEdit={(t) => setEditing(t)}
          />
        ) : viewMode === "mindmap" ? (
          <Mindmap
            tickets={tickets}
            focusedId={focusedId}
            onFocus={setFocusedId}
            onAddChild={(t) => setQuickAdd({ parent: t })}
            onEdit={(t) => setEditing(t)}
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Type</th>
                <th>Title</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>Due</th>
                <th>Est.</th>
                <th>Repo / Branch</th>
                <th>Tags</th>
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
                  onEdit={() => setEditing(t)}
                />
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={9} className="muted">該当なし</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {quickAdd && (
        <QuickAddChildModal
          parent={quickAdd.parent}
          onCancel={() => setQuickAdd(null)}
          onCreate={async (req, keepOpen) => {
            await create(req);
            if (!keepOpen) setQuickAdd(null);
          }}
        />
      )}

      {editing && (
        <EditTicketDialog
          ticket={editing}
          sprints={sprints}
          onCancel={() => setEditing(null)}
          onSave={async (patch) => {
            await update(editing.id, patch);
            setEditing(null);
          }}
        />
      )}
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
  onEdit: () => void;
}

// ===== Kanban (status columns) =====
function Kanban({
  tickets,
  onChangeStatus,
  onEdit,
}: {
  tickets: Ticket[];
  onChangeStatus: (id: string, status: TicketStatus) => void;
  onEdit: (t: Ticket) => void;
}) {
  const cols: { status: TicketStatus; label: string }[] = [
    { status: "TODO", label: "TODO" },
    { status: "IN_PROGRESS", label: "進行中" },
    { status: "DONE", label: "完了" },
  ];
  const byStatus = new Map<TicketStatus, Ticket[]>();
  for (const t of tickets) {
    const arr = byStatus.get(t.status) ?? [];
    arr.push(t);
    byStatus.set(t.status, arr);
  }
  return (
    <div className="kanban">
      {cols.map((c) => (
        <KanbanColumn
          key={c.status}
          status={c.status}
          label={c.label}
          tickets={byStatus.get(c.status) ?? []}
          onDropTicket={(id) => onChangeStatus(id, c.status)}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}

function KanbanColumn({
  status, label, tickets, onDropTicket, onEdit,
}: {
  status: TicketStatus;
  label: string;
  tickets: Ticket[];
  onDropTicket: (id: string) => void;
  onEdit: (t: Ticket) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`kanban-col status-${status.toLowerCase()} ${over ? "drop-over" : ""}`}
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
      <div className="kanban-col-head">
        <strong>{label}</strong>
        <span className="muted">{tickets.length}</span>
      </div>
      <div className="ticket-list">
        {tickets.map((t) => (
          <KCard key={t.id} t={t} onEdit={() => onEdit(t)} />
        ))}
        {tickets.length === 0 && (
          <div className="muted ticket-list-empty">(空)</div>
        )}
      </div>
    </div>
  );
}

function KCard({ t, onEdit }: { t: Ticket; onEdit: () => void }) {
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
        <a
          href={`/tickets/${t.id}`}
          target="_blank"
          rel="noopener"
          className="btn-link"
          onMouseDown={(e) => e.stopPropagation()}
          title="別タブで詳細編集"
        >↗</a>
        <TypeBadge value={t.type} />
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

// ===== Quick add modal (mindmap node click) =====
function QuickAddChildModal({
  parent,
  onCancel,
  onCreate,
}: {
  parent: Ticket;
  onCancel: () => void;
  onCreate: (req: TicketCreate, keepOpen: boolean) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TicketType>(childTypeFor(parent.type));
  const [status, setStatus] = useState<TicketStatus>("TODO");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function submit(keepOpen: boolean) {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onCreate(
        {
          title: title.trim(),
          type,
          status,
          parent_id: parent.id,
          tags: [],
        },
        keepOpen,
      );
      setTitle("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 style={{ margin: 0 }}>子チケット追加</h3>
          <button className="secondary modal-close" onClick={onCancel} aria-label="閉じる">×</button>
        </div>
        <div className="modal-body">
          <div className="muted" style={{ marginBottom: 8 }}>
            親: <strong>[{parent.type}] {parent.title}</strong>
          </div>
          <div className="row">
            <input
              placeholder="タイトル"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(e.metaKey || e.ctrlKey);
                }
              }}
              style={{ flex: 1 }}
              autoFocus
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
          <p className="muted" style={{ marginTop: 6, fontSize: 11 }}>
            Enter: 追加して閉じる / ⌘+Enter: 追加して続ける
          </p>
        </div>
        <div className="modal-foot">
          <button className="secondary" onClick={onCancel}>キャンセル</button>
          <button
            className="secondary"
            onClick={() => submit(true)}
            disabled={!title.trim() || submitting}
          >追加して続ける</button>
          <button
            onClick={() => submit(false)}
            disabled={!title.trim() || submitting}
          >追加</button>
        </div>
      </div>
    </div>
  );
}

// ===== Mindmap (SVG horizontal tree) =====
const NODE_W = 200;
const NODE_H = 50;
const COL_W = 240;
const ROW_H = 66;
const PAD = 16;

interface MindmapNode {
  t: Ticket;
  depth: number;
  x: number;
  y: number;
  parentId: string | null;
}

function Mindmap({
  tickets,
  focusedId,
  onFocus,
  onAddChild,
  onEdit,
}: {
  tickets: Ticket[];
  focusedId: string | null;
  onFocus: (id: string) => void;
  onAddChild: (t: Ticket) => void;
  onEdit: (t: Ticket) => void;
}) {
  const { nodes, edges, width, height } = useMemo(() => layoutMindmap(tickets), [tickets]);

  if (tickets.length === 0) {
    return <div className="muted" style={{ padding: 20 }}>該当なし</div>;
  }

  return (
    <>
      <p className="muted" style={{ fontSize: 11, margin: "0 0 6px" }}>
        ↑↓←→ で移動 / Tab で子追加 / Enter で編集 / クリックで選択 / + バッジで子追加
      </p>
      <div style={{ overflow: "auto", maxHeight: "70vh", border: "1px solid var(--border)", borderRadius: 4 }}>
        <svg width={width + PAD * 2} height={height + PAD * 2} style={{ display: "block" }}>
          <g transform={`translate(${PAD},${PAD})`}>
            {edges.map((e, i) => {
              const midX = (e.x1 + e.x2) / 2;
              const d = `M${e.x1},${e.y1} C${midX},${e.y1} ${midX},${e.y2} ${e.x2},${e.y2}`;
              return <path key={i} d={d} stroke="#cbd5e1" strokeWidth={1.5} fill="none" />;
            })}
            {nodes.map((n) => {
              const canAddChild = n.t.type !== "SUBTASK";
              const isFocused = focusedId === n.t.id;
              return (
                <g
                  key={n.t.id}
                  transform={`translate(${n.x},${n.y})`}
                  className={`mm-node mm-${n.t.type.toLowerCase()} mm-status-${n.t.status.toLowerCase()} ${isFocused ? "focused" : ""}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => onFocus(n.t.id)}
                  onDoubleClick={() => onEdit(n.t)}
                >
                  <rect width={NODE_W} height={NODE_H} rx={6} ry={6} className="mm-rect" />
                  <text x={8} y={14} className="mm-type">[{n.t.type}]</text>
                  <text x={8} y={28} className="mm-title">{trim(n.t.title, 20)}</text>
                  <g
                    className={`mm-status-pill status-${n.t.status.toLowerCase()}`}
                    transform={`translate(${NODE_W / 2 - 22}, ${NODE_H - 14})`}
                  >
                    <rect width={44} height={11} rx={5.5} ry={5.5} />
                    <text x={22} y={8} textAnchor="middle">{statusShort(n.t.status)}</text>
                  </g>
                  {canAddChild && (
                    <g
                      className="mm-plus"
                      transform={`translate(${NODE_W - 14}, 14)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddChild(n.t);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <title>子チケットを追加 (またはフォーカス中に Tab)</title>
                      <circle r={9} className="mm-plus-circle" />
                      <text textAnchor="middle" y={4} className="mm-plus-text">+</text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </>
  );
}

function trim(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function statusShort(s: TicketStatus): string {
  return s === "IN_PROGRESS" ? "進行中" : s === "DONE" ? "完了" : "TODO";
}

function layoutMindmap(tickets: Ticket[]): {
  nodes: MindmapNode[];
  edges: { x1: number; y1: number; x2: number; y2: number }[];
  width: number;
  height: number;
} {
  const idSet = new Set(tickets.map((t) => t.id));
  const childMap = new Map<string | null, Ticket[]>();
  for (const t of tickets) {
    const k = t.parent_id && idSet.has(t.parent_id) ? t.parent_id : null;
    const arr = childMap.get(k) ?? [];
    arr.push(t);
    childMap.set(k, arr);
  }
  const nodes: MindmapNode[] = [];
  let cursorY = 0;
  let maxDepth = 0;

  const visit = (t: Ticket, depth: number, parentId: string | null, topY: number): { y: number; consumed: number } => {
    maxDepth = Math.max(maxDepth, depth);
    const kids = childMap.get(t.id) ?? [];
    if (kids.length === 0) {
      const y = topY;
      cursorY = topY + ROW_H;
      nodes.push({ t, depth, x: depth * COL_W, y, parentId });
      return { y, consumed: ROW_H };
    }
    const ys: number[] = [];
    let consumed = 0;
    for (const k of kids) {
      const r = visit(k, depth + 1, t.id, topY + consumed);
      ys.push(r.y);
      consumed += r.consumed;
    }
    const y = (ys[0] + ys[ys.length - 1]) / 2;
    nodes.push({ t, depth, x: depth * COL_W, y, parentId });
    return { y, consumed };
  };

  let topY = 0;
  for (const root of childMap.get(null) ?? []) {
    const r = visit(root, 0, null, topY);
    topY += r.consumed;
  }

  const byId = new Map(nodes.map((n) => [n.t.id, n]));
  const edges = nodes
    .filter((n) => n.parentId && byId.has(n.parentId))
    .map((n) => {
      const p = byId.get(n.parentId!)!;
      return {
        x1: p.x + NODE_W,
        y1: p.y + NODE_H / 2,
        x2: n.x,
        y2: n.y + NODE_H / 2,
      };
    });

  const width = (maxDepth + 1) * COL_W;
  const height = cursorY;
  return { nodes, edges, width, height };
}

function TicketRow({
  t, depth, isTree, hasChildren, isCollapsed, onToggleCollapsed,
  allRepos, childCount, onChangeStatus, onDelete, onAddTag, onRemoveTag, onAddChild, onEdit,
}: RowProps) {
  const [newTag, setNewTag] = useState("");
  const repo = allRepos.find((r) => r.id === t.repository_id);
  const canAddChild = t.type !== "SUBTASK";
  return (
    <tr>
      <td className="row-actions" style={{ whiteSpace: "nowrap" }}>
        <a
          href={`/tickets/${t.id}`}
          target="_blank"
          rel="noopener"
          className="btn-link"
          title="別タブで詳細編集"
        >↗</a>
        {canAddChild && (
          <button
            className="secondary"
            onClick={onAddChild}
            title="この行を親として子チケットを作成"
          >+ 子</button>
        )}
        <button className="danger" onClick={onDelete} title="削除">×</button>
      </td>
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
            <span
              className="title-link"
              onClick={onEdit}
              title="クリックで編集"
            >{t.title}</span>
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
    </tr>
  );
}
