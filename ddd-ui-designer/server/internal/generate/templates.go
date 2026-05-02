package generate

const viteConfig = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
`

const tsconfig = `{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "useDefineForClassFields": true
  },
  "include": ["src"]
}
`

const mainTSX = `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`

const stylesCSS = `* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
    "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
  background: #f3f4f6;
  color: #1f2937;
  font-size: 14px;
}

.app { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
.topnav {
  background: #111827;
  color: #fff;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.topnav strong { font-size: 15px; margin-right: 16px; }
.topnav button {
  background: #374151;
  color: #fff;
  border: 0;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
}
.topnav button:hover { background: #4b5563; }
.topnav code { background: #1f2937; padding: 2px 6px; border-radius: 3px; }

main { padding: 24px; overflow: auto; }
.screen {
  max-width: 960px;
  margin: 0 auto;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  padding: 24px;
}
.screen header h2 {
  margin: 0 0 16px;
  padding-bottom: 8px;
  border-bottom: 2px solid #e5e7eb;
  font-size: 18px;
}

.field { display: block; margin-bottom: 12px; }
.field .lbl {
  display: block;
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 4px;
  font-weight: 600;
}
.field input,
.field select,
.field textarea {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 14px;
  background: #fff;
}
.field textarea { min-height: 80px; }
.checkbox-row { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; }

fieldset.section {
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 12px;
  margin: 12px 0;
}
fieldset.section legend {
  padding: 0 6px;
  color: #4b5563;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}
fieldset.tab {
  background: #f9fafb;
}

.btn,
.btn-cancel {
  border: 0;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  margin: 4px 4px 4px 0;
  font-size: 14px;
}
.btn { background: #3b82f6; color: #fff; }
.btn:hover { background: #2563eb; }
.btn-cancel { background: #6b7280; color: #fff; }
.btn-cancel:hover { background: #4b5563; }

.data-table {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0 16px;
}
.data-table th,
.data-table td {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid #e5e7eb;
}
.data-table th { background: #f9fafb; font-weight: 600; font-size: 12px; }
.data-table tbody tr:hover { background: #eef2ff; cursor: pointer; }
.data-table .empty {
  color: #9ca3af;
  text-align: center;
  font-style: italic;
}

.readonly {
  background: #f9fafb;
  border: 1px dashed #d1d5db;
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 12px;
}
.summary {
  background: #f3f4f6;
  padding: 12px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  white-space: pre-wrap;
}
.confirm {
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 12px;
}
`

const dbTS = `// localStorage-backed CRUD for records, namespaced per Aggregate.
export type Row = { id: string; values: Record<string, any> };

const NS = "ddd-ui-designer-app:";

function key(aggregate: string): string {
  return NS + aggregate;
}

function load(aggregate: string): Row[] {
  try {
    const raw = localStorage.getItem(key(aggregate));
    return raw ? (JSON.parse(raw) as Row[]) : [];
  } catch {
    return [];
  }
}

function persist(aggregate: string, rows: Row[]): void {
  localStorage.setItem(key(aggregate), JSON.stringify(rows));
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const db = {
  list(aggregate: string): Row[] {
    return load(aggregate);
  },
  get(aggregate: string, id: string): Row | undefined {
    return load(aggregate).find((r) => r.id === id);
  },
  save(aggregate: string, row: Row): Row {
    const list = load(aggregate);
    if (!row.id) row.id = makeId();
    const idx = list.findIndex((r) => r.id === row.id);
    if (idx >= 0) list[idx] = row;
    else list.push(row);
    persist(aggregate, list);
    return row;
  },
  remove(aggregate: string, id: string): void {
    persist(aggregate, load(aggregate).filter((r) => r.id !== id));
  },
  reset(aggregate: string): void {
    persist(aggregate, []);
  },
};

export { makeId };
`

const runtimeTSX = `import { useEffect, useMemo, useState } from "react";
import { db, makeId, type Row } from "./db";

export type Component = {
  type: string;
  bind?: string;
  label?: string;
  props?: Record<string, any>;
  children?: Component[];
};

export type Screen = {
  id: string;
  kind: string;
  title: string;
  aggregateRef: string;
  entityRef?: string;
  parentScreen?: string;
  components: Component[];
  stepIndex?: number;
};

type Ctx = { selectedId?: string; [k: string]: any };
type NavFn = (event: string, extra?: Ctx) => void;

interface ScreenViewProps {
  screen: Screen;
  ctx: Ctx;
  navigate: NavFn;
}

export function ScreenView({ screen, ctx, navigate }: ScreenViewProps) {
  const [form, setForm] = useState<Record<string, any>>({});
  const [, forceTick] = useState(0);
  const refresh = () => forceTick((x) => x + 1);

  const rows: Row[] = useMemo(() => db.list(screen.aggregateRef), [screen.aggregateRef, screen.id, ctx.selectedId]);

  useEffect(() => {
    if (
      (screen.kind === "detail" || screen.kind === "edit" || screen.kind === "modal") &&
      ctx.selectedId
    ) {
      const rec = db.get(screen.aggregateRef, ctx.selectedId);
      setForm(rec?.values ?? {});
    } else if (screen.kind === "settings" || screen.kind === "master") {
      const id = screen.kind === "settings" ? "singleton" : (ctx.selectedId ?? "singleton");
      const rec = db.get(screen.aggregateRef, id);
      setForm(rec?.values ?? {});
    } else {
      setForm({});
    }
  }, [screen.id, ctx.selectedId, screen.aggregateRef, screen.kind]);

  const setField = (k: string, v: any) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const onEvent = (event: string, extra?: Ctx) => {
    if (event === "save") {
      const id =
        screen.kind === "settings" || screen.kind === "master"
          ? (screen.kind === "settings" ? "singleton" : (ctx.selectedId ?? "singleton"))
          : (ctx.selectedId ?? makeId());
      db.save(screen.aggregateRef, { id, values: form });
      refresh();
    } else if (event === "submit") {
      db.save(screen.aggregateRef, { id: makeId(), values: form });
      setForm({});
      refresh();
    } else if (event === "delete" && ctx.selectedId) {
      db.remove(screen.aggregateRef, ctx.selectedId);
      refresh();
    }
    navigate(event, extra);
  };

  return (
    <div className="screen">
      <header><h2>{screen.title}</h2></header>
      <div className="screen-body">
        {screen.components.map((c, i) => (
          <Comp key={i} c={c} form={form} setField={setField} rows={rows} onEvent={onEvent} />
        ))}
      </div>
    </div>
  );
}

function bindForm(b?: string): string {
  if (!b) return "";
  return b.startsWith("form.") ? b.slice(5) : b;
}
function bindRow(b?: string): string {
  if (!b) return "";
  return b.startsWith("row.") ? b.slice(4) : b;
}

interface CompProps {
  c: Component;
  form: Record<string, any>;
  setField: (k: string, v: any) => void;
  rows: Row[];
  onEvent: NavFn;
}

function field(c: Component, control: any) {
  return (
    <label className="field">
      <span className="lbl">
        {c.label}
        {c.props?.required ? " *" : ""}
      </span>
      {control}
    </label>
  );
}

function Comp({ c, form, setField, rows, onEvent }: CompProps): any {
  switch (c.type) {
    case "TextInput":
      return field(
        c,
        <input
          type="text"
          value={form[bindForm(c.bind)] ?? ""}
          onChange={(e) => setField(bindForm(c.bind), e.target.value)}
        />,
      );
    case "TextArea":
      return field(
        c,
        <textarea
          value={form[bindForm(c.bind)] ?? ""}
          onChange={(e) => setField(bindForm(c.bind), e.target.value)}
        />,
      );
    case "NumberInput":
      return field(
        c,
        <input
          type="number"
          value={form[bindForm(c.bind)] ?? ""}
          onChange={(e) => setField(bindForm(c.bind), e.target.value === "" ? "" : Number(e.target.value))}
        />,
      );
    case "DatePicker":
      return field(
        c,
        <input
          type="date"
          value={form[bindForm(c.bind)] ?? ""}
          onChange={(e) => setField(bindForm(c.bind), e.target.value)}
        />,
      );
    case "Checkbox":
      return (
        <div className="checkbox-row">
          <input
            type="checkbox"
            checked={!!form[bindForm(c.bind)]}
            onChange={(e) => setField(bindForm(c.bind), e.target.checked)}
          />
          <span>{c.label}</span>
        </div>
      );
    case "Select":
    case "RadioGroup": {
      const opts: string[] = (c.props?.options as string[]) ?? [];
      return field(
        c,
        <select
          value={form[bindForm(c.bind)] ?? ""}
          onChange={(e) => setField(bindForm(c.bind), e.target.value)}
        >
          <option value="">--</option>
          {opts.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>,
      );
    }
    case "RefPicker": {
      const refTo = String(c.props?.refTo ?? "");
      const recs = refTo ? db.list(refTo) : [];
      return field(
        c,
        <select
          value={form[bindForm(c.bind)] ?? ""}
          onChange={(e) => setField(bindForm(c.bind), e.target.value)}
        >
          <option value="">-- {refTo} --</option>
          {recs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.values?.name ?? r.values?.title ?? r.id}
            </option>
          ))}
        </select>,
      );
    }
    case "Hidden":
      return null;
    case "Section":
    case "Tab":
      return (
        <fieldset className={"section" + (c.type === "Tab" ? " tab" : "")}>
          <legend>{c.label}</legend>
          {(c.children ?? []).map((cc, i) => (
            <Comp key={i} c={cc} form={form} setField={setField} rows={rows} onEvent={onEvent} />
          ))}
        </fieldset>
      );
    case "ReadOnlyForm":
      return (
        <div className="readonly">
          {(c.children ?? []).map((cc, i) => (
            <Comp key={i} c={cc} form={form} setField={() => {}} rows={rows} onEvent={onEvent} />
          ))}
        </div>
      );
    case "Summary":
      return <pre className="summary">{JSON.stringify(form, null, 2)}</pre>;
    case "ConfirmDialog":
      return <div className="confirm">{c.label}</div>;
    case "Table":
    case "EditableTable": {
      const cols = c.children ?? [];
      const rowEvent = String(c.props?.rowEvent ?? "select");
      return (
        <table className="data-table">
          <thead>
            <tr>{cols.map((col, i) => <th key={i}>{col.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length || 1} className="empty">
                  まだレコードがありません
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} onClick={() => onEvent(rowEvent, { selectedId: r.id })}>
                {cols.map((col, j) => (
                  <td key={j}>{String(r.values?.[bindRow(col.bind)] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "Button": {
      const ev = String(c.props?.event ?? "");
      const cancel = ev === "cancel" || ev === "close" || ev === "back";
      return (
        <button className={cancel ? "btn-cancel" : "btn"} onClick={() => onEvent(ev)}>
          {c.label}
        </button>
      );
    }
    default:
      return <div>{c.type}: {c.label}</div>;
  }
}
`
