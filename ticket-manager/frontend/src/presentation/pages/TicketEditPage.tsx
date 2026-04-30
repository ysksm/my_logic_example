import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api } from "@/infrastructure/api/client";
import { useSprints } from "@/application/hooks/useSprints";
import { useRepositories, useBranches } from "@/application/hooks/useRepositories";
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
        <span className="muted" style={{ fontSize: 18 }}>TICKET-{ticket.number}</span>
        <span style={{ fontSize: 22 }}>{ticket.title}</span>
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

      <BranchCreator
        ticket={ticket}
        repos={repos}
        repositoryId={repositoryId}
        currentTitle={title}
        onCreated={async (repoId, branchName) => {
          await api.updateTicket(id, {
            title,
            description,
            type,
            status,
            parent_id: parentId || null,
            assignee: assignee.trim() || null,
            estimate_hours: estimate ? Number(estimate) : null,
            due_date: dueDate || null,
            repository_id: repoId,
            branch: branchName,
            sprint_id: sprintId || null,
          });
          setRepositoryId(repoId);
          setBranch(branchName);
          const fresh = await api.getTicket(id);
          setTicket(fresh);
        }}
      />

      <div className="panel">
        <p className="muted" style={{ margin: 0, fontSize: 11 }}>
          作成: {new Date(ticket.created_at).toLocaleString()} ・ 更新: {new Date(ticket.updated_at).toLocaleString()}
        </p>
      </div>
    </>
  );
}

// ===== Branch creator =====
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w぀-ヿ㐀-䶿一-鿿-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);
}

function BranchCreator({
  ticket,
  repos,
  repositoryId,
  currentTitle,
  onCreated,
}: {
  ticket: Ticket;
  repos: Repository[];
  repositoryId: string;
  currentTitle: string;
  onCreated: (repoId: string, branchName: string) => Promise<void>;
}) {
  const [chosenRepo, setChosenRepo] = useState<string>(repositoryId);
  // Keep in sync if user changed repository in the main form
  useEffect(() => { setChosenRepo(repositoryId); }, [repositoryId]);

  const repo = repos.find((r) => r.id === chosenRepo);
  const { branches, createBranch } = useBranches(chosenRepo || null);
  const [from, setFrom] = useState("");
  const [checkout, setCheckout] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const defaultName = useMemo(
    () => `TICKET-${ticket.number}-${slugify(currentTitle || ticket.title)}`,
    [ticket.number, currentTitle, ticket.title],
  );
  const [name, setName] = useState(defaultName);
  // Re-sync name when default changes (only if user hasn't customised)
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setName(defaultName);
  }, [defaultName, touched]);

  // Default source branch = repo's default
  useEffect(() => {
    if (!repo) return;
    if (!from) setFrom(repo.default_branch);
  }, [repo, from]);

  if (repos.length === 0) {
    return (
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>ブランチ作成</h3>
        <p className="muted" style={{ margin: 0 }}>
          リポジトリが登録されていません。先に <Link to="/repositories">リポジトリ管理</Link> から追加してください。
        </p>
      </div>
    );
  }

  async function create() {
    if (!chosenRepo || !name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await createBranch({ branch: name.trim(), from: from.trim() || undefined, checkout });
      await onCreated(chosenRepo, name.trim());
      setMsg(`ブランチ "${name.trim()}" を作成しました${checkout ? " (チェックアウト済み)" : ""}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>ブランチ作成</h3>
      <div className="row">
        <select value={chosenRepo} onChange={(e) => setChosenRepo(e.target.value)} style={{ minWidth: 200 }}>
          <option value="">(リポジトリ選択)</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setTouched(true); }}
          onBlur={() => { if (!name.trim()) { setName(defaultName); setTouched(false); } }}
          style={{ flex: 1, minWidth: 280, fontFamily: "monospace" }}
          placeholder="branch name"
        />
        <button
          className="secondary"
          onClick={() => { setName(defaultName); setTouched(false); }}
          title="既定 (TICKET-番号-タイトル) に戻す"
          type="button"
        >既定に戻す</button>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <span className="muted" style={{ width: 60 }}>分岐元:</span>
        {branches.length > 0 ? (
          <select value={from} onChange={(e) => setFrom(e.target.value)} style={{ minWidth: 200 }}>
            {branches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        ) : (
          <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder={repo?.default_branch ?? "main"} />
        )}
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} />
          作成後にチェックアウト
        </label>
        <button onClick={create} disabled={!chosenRepo || !name.trim() || busy}>
          ブランチ作成
        </button>
      </div>
      {msg && <p className="muted" style={{ marginTop: 6, color: "var(--done)" }}>{msg}</p>}
      {err && <p style={{ marginTop: 6, color: "red" }}>{err}</p>}
    </div>
  );
}
