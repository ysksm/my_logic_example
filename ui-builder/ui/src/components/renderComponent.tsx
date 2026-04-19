import type { AppComponent } from "../types";

interface Ctx {
  mode: "design" | "preview";
  // Preview-only collaborators:
  state?: Record<string, unknown>;
  setState?: (patch: Record<string, unknown>) => void;
  records?: Record<string, { id: string; values: Record<string, unknown> }[]>;
  fire?: (event: string, payload?: unknown) => void;
  recordForCurrentScreen?: { id: string; values: Record<string, unknown> } | null;
}

// Substitutes "$state.x", "$record.x", "$row.x" tokens. Plain strings pass through.
export function resolve(value: unknown, ctx: Ctx, row?: Record<string, unknown>): unknown {
  if (typeof value !== "string") return value;
  if (value.startsWith("$state.")) return ctx.state?.[value.slice(7)];
  if (value.startsWith("$record.")) return ctx.recordForCurrentScreen?.values?.[value.slice(8)];
  if (value.startsWith("$row.")) return row?.[value.slice(5)];
  return value;
}

// renderComponent is shared between Canvas (design) and Preview (runtime).
// In design mode interactions are inert; in preview mode events fire actions.
export function renderComponent(c: AppComponent, ctx: Ctx) {
  const p = c.props;
  const onClick = (e: React.MouseEvent, payload?: unknown) => {
    if (ctx.mode === "design") return;
    e.stopPropagation();
    const action = c.events?.onClick;
    if (action) ctx.fire?.(c.id, payload);
  };

  switch (c.type) {
    case "Text": {
      const text = String(resolve(p.text, ctx) ?? "");
      return (
        <div style={{
          width: "100%", height: "100%",
          fontSize: (p.size as number) ?? 14,
          fontWeight: p.bold ? 600 : 400,
          display: "flex", alignItems: "center",
        }}>{text}</div>
      );
    }
    case "Button":
      return (
        <button
          style={{
            width: "100%", height: "100%",
            background: p.primary ? "#2563eb" : "#fff",
            color: p.primary ? "#fff" : "#111",
            border: "1px solid " + (p.primary ? "#2563eb" : "#d1d5db"),
            borderRadius: 4, cursor: "pointer",
          }}
          onClick={onClick}
        >{String(p.label ?? "Button")}</button>
      );
    case "Input":
      return (
        <input
          style={{ width: "100%", height: "100%", padding: "0 6px", border: "1px solid #d1d5db", borderRadius: 3 }}
          placeholder={String(p.placeholder ?? "")}
          value={readBound(p.bind, ctx)}
          onChange={(e) => writeBound(p.bind, e.target.value, ctx)}
          readOnly={ctx.mode === "design"}
        />
      );
    case "Textarea":
      return (
        <textarea
          style={{ width: "100%", height: "100%", padding: 6, border: "1px solid #d1d5db", borderRadius: 3, resize: "none" }}
          placeholder={String(p.placeholder ?? "")}
          value={readBound(p.bind, ctx)}
          onChange={(e) => writeBound(p.bind, e.target.value, ctx)}
          readOnly={ctx.mode === "design"}
        />
      );
    case "NumberInput":
      return (
        <input type="number"
          style={{ width: "100%", height: "100%", padding: "0 6px", border: "1px solid #d1d5db", borderRadius: 3 }}
          value={readBound(p.bind, ctx)}
          onChange={(e) => writeBound(p.bind, Number(e.target.value), ctx)}
          readOnly={ctx.mode === "design"}
        />
      );
    case "DateInput":
      return (
        <input type="date"
          style={{ width: "100%", height: "100%", padding: "0 6px", border: "1px solid #d1d5db", borderRadius: 3 }}
          value={readBound(p.bind, ctx)}
          onChange={(e) => writeBound(p.bind, e.target.value, ctx)}
          readOnly={ctx.mode === "design"}
        />
      );
    case "Checkbox":
      return (
        <label style={{ display: "flex", alignItems: "center", gap: 6, height: "100%" }}>
          <input type="checkbox"
            checked={Boolean(readBound(p.bind, ctx))}
            onChange={(e) => writeBound(p.bind, e.target.checked, ctx)}
            disabled={ctx.mode === "design"}
          />
          {String(p.label ?? "")}
        </label>
      );
    case "Table": {
      const model = String(p.model ?? "");
      const cols = (p.columns as { key: string; label: string }[]) || [{ key: "id", label: "ID" }];
      const rows = ctx.mode === "preview" ? (ctx.records?.[model] ?? []) : [];
      return (
        <div style={{ width: "100%", height: "100%", overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 4, background: "#fff" }}>
          <table className="records">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => {
                const merged = { id: r.id, ...r.values };
                return (
                  <tr key={r.id} onClick={(e) => onClick(e, merged)}>
                    {cols.map((c) => <td key={c.key}>{String((merged as Record<string, unknown>)[c.key] ?? "")}</td>)}
                  </tr>
                );
              })}
              {ctx.mode === "design" && (
                <tr><td colSpan={cols.length} style={{ color: "#9ca3af" }}>(table preview shows records at runtime)</td></tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }
    default:
      return <div>Unknown: {c.type}</div>;
  }
}

// "form.title" reads/writes ctx.state.form.title
function readBound(bind: unknown, ctx: Ctx): string {
  if (typeof bind !== "string" || !ctx.state) return "";
  const parts = bind.split(".");
  let cur: unknown = ctx.state;
  for (const p of parts) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[p];
    else return "";
  }
  return cur == null ? "" : String(cur);
}

function writeBound(bind: unknown, value: unknown, ctx: Ctx) {
  if (typeof bind !== "string" || !ctx.state || !ctx.setState) return;
  const parts = bind.split(".");
  const next = { ...ctx.state };
  let cur: Record<string, unknown> = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    cur[k] = { ...((cur[k] as Record<string, unknown>) || {}) };
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  ctx.setState(next);
}
