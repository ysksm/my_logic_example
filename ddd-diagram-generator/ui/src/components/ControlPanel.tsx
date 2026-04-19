import type { ApiGraph, GroupBy, LayoutName, Stereotype } from "../types";

interface Props {
  graph: ApiGraph | null;
  hiddenNodes: Set<string>;
  hiddenStereotypes: Set<Stereotype>;
  focus: string | null;
  focusDepth: number;
  groupBy: GroupBy;
  layout: LayoutName;
  search: string;
  onToggleNode(id: string): void;
  onToggleStereotype(s: Stereotype): void;
  onSelectFocus(id: string | null): void;
  onFocusDepth(n: number): void;
  onGroupBy(g: GroupBy): void;
  onLayoutChange(l: LayoutName): void;
  onSearch(q: string): void;
  onApplyLayout(): void;
  onShowAll(): void;
}

const STEREOTYPES: Stereotype[] = [
  "aggregate",
  "entity",
  "valueObject",
  "repository",
  "service",
  "factory",
  "event",
  "command",
  "query",
  "policy",
  "enum",
  "typeAlias",
  "interface",
  "class",
];

const LAYOUTS: { value: LayoutName; label: string }[] = [
  { value: "dagre-lr", label: "階層 (横: LR)" },
  { value: "dagre-tb", label: "階層 (縦: TB)" },
  { value: "cluster-aggregate", label: "集約ごとにクラスタ" },
  { value: "cluster-module", label: "モジュールごとにクラスタ" },
  { value: "grid", label: "グリッド" },
];

const GROUPS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "なし" },
  { value: "aggregate", label: "集約" },
  { value: "module", label: "モジュール" },
  { value: "stereotype", label: "種別" },
];

export function ControlPanel(p: Props) {
  const { graph } = p;
  if (!graph) {
    return <div style={{ padding: 12, color: "#64748b" }}>パスを解析してください。</div>;
  }
  const filteredNodes = graph.nodes.filter((n) =>
    p.search === "" ? true : n.name.toLowerCase().includes(p.search.toLowerCase()),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, fontFamily: "system-ui", fontSize: 13 }}>
      <Section title="表示レイアウト">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {LAYOUTS.map((l) => (
            <label key={l.value} style={{ display: "flex", gap: 6, cursor: "pointer" }}>
              <input
                type="radio"
                checked={p.layout === l.value}
                onChange={() => p.onLayoutChange(l.value)}
              />
              {l.label}
            </label>
          ))}
          <button onClick={p.onApplyLayout} style={btnStyle}>
            レイアウト再適用
          </button>
        </div>
      </Section>

      <Section title="グループ化 (枠で囲む)">
        <select value={p.groupBy} onChange={(e) => p.onGroupBy(e.target.value as GroupBy)} style={{ padding: 4 }}>
          {GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
      </Section>

      <Section title="種別で絞り込み">
        {STEREOTYPES.map((s) => {
          const count = graph.nodes.filter((n) => n.stereotype === s).length;
          if (count === 0) return null;
          const hidden = p.hiddenStereotypes.has(s);
          return (
            <label key={s} style={{ display: "flex", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={!hidden} onChange={() => p.onToggleStereotype(s)} />
              <span style={{ textTransform: "capitalize" }}>{s}</span>
              <span style={{ color: "#94a3b8", marginLeft: "auto" }}>{count}</span>
            </label>
          );
        })}
      </Section>

      <Section title="フォーカス">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <select
            value={p.focus ?? ""}
            onChange={(e) => p.onSelectFocus(e.target.value || null)}
            style={{ padding: 4 }}
          >
            <option value="">(なし — 全体表示)</option>
            {graph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} ({n.stereotype})
              </option>
            ))}
          </select>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            深さ
            <input
              type="number"
              min={1}
              max={5}
              value={p.focusDepth}
              onChange={(e) => p.onFocusDepth(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
              style={{ width: 48, padding: 2 }}
            />
            <span style={{ color: "#94a3b8" }}>関係しているものだけ表示</span>
          </label>
        </div>
      </Section>

      <Section title="ノード一覧">
        <input
          value={p.search}
          onChange={(e) => p.onSearch(e.target.value)}
          placeholder="検索..."
          style={{ padding: 4, marginBottom: 6 }}
        />
        <button onClick={p.onShowAll} style={btnStyle}>
          すべて表示
        </button>
        <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 6 }}>
          {filteredNodes.map((n) => {
            const hidden = p.hiddenNodes.has(n.id);
            return (
              <label
                key={n.id}
                style={{
                  display: "flex",
                  gap: 6,
                  padding: "2px 0",
                  cursor: "pointer",
                  opacity: hidden ? 0.5 : 1,
                }}
              >
                <input type="checkbox" checked={!hidden} onChange={() => p.onToggleNode(n.id)} />
                <span>{n.name}</span>
                <span style={{ color: "#94a3b8", marginLeft: "auto", fontSize: 11 }}>{n.stereotype}</span>
              </label>
            );
          })}
        </div>
      </Section>

      <Section title="統計">
        <div style={{ color: "#64748b", fontSize: 12 }}>
          {graph.stats.filesScanned} files / {graph.stats.nodeCount} nodes / {graph.stats.edgeCount} edges
        </div>
      </Section>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "4px 8px",
  background: "#1f2937",
  color: "white",
  border: 0,
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
};

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderBottom: "1px solid #e2e8f0", paddingBottom: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: "#1e293b" }}>{props.title}</div>
      {props.children}
    </div>
  );
}
