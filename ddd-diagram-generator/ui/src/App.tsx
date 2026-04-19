import { useCallback, useMemo, useState } from "react";
import { analyze } from "./api";
import { ControlPanel } from "./components/ControlPanel";
import { DiagramCanvas } from "./components/DiagramCanvas";
import type { ApiEdge, ApiGraph, ApiNode, GroupBy, LayoutName, Stereotype } from "./types";

export function App() {
  const [path, setPath] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<ApiGraph | null>(null);

  const [layout, setLayout] = useState<LayoutName>("dagre-lr");
  const [groupBy, setGroupBy] = useState<GroupBy>("aggregate");
  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(new Set());
  const [hiddenStereotypes, setHiddenStereotypes] = useState<Set<Stereotype>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [focusDepth, setFocusDepth] = useState(1);
  const [search, setSearch] = useState("");
  const [manualPositions, setManualPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [layoutNonce, setLayoutNonce] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const onAnalyze = useCallback(async () => {
    if (!path.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const g = await analyze(path.trim());
      setGraph(g);
      setHiddenNodes(new Set());
      setHiddenStereotypes(new Set());
      setFocus(null);
      setManualPositions({});
      setLayoutNonce((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  const { visibleNodes, visibleEdges } = useMemo(() => {
    if (!graph) return { visibleNodes: [] as ApiNode[], visibleEdges: [] as ApiEdge[] };
    let nodes = graph.nodes.filter((n) => !hiddenNodes.has(n.id) && !hiddenStereotypes.has(n.stereotype));
    if (focus) {
      const keep = expandFocus(focus, graph, focusDepth);
      nodes = nodes.filter((n) => keep.has(n.id));
    }
    const allowed = new Set(nodes.map((n) => n.id));
    const edges = graph.edges.filter((e) => allowed.has(e.from) && allowed.has(e.to));
    return { visibleNodes: nodes, visibleEdges: edges };
  }, [graph, hiddenNodes, hiddenStereotypes, focus, focusDepth]);

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <aside
        style={{
          width: 320,
          borderRight: "1px solid #e2e8f0",
          overflowY: "auto",
          background: "#f8fafc",
        }}
      >
        <div style={{ padding: 12, borderBottom: "1px solid #e2e8f0", background: "white" }}>
          <h1 style={{ margin: 0, fontSize: 16 }}>DDD Diagram Generator</h1>
          <p style={{ margin: "4px 0 8px", fontSize: 12, color: "#64748b" }}>
            TypeScript ドメインコードを解析して ER 風の図を生成します。
          </p>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              placeholder="/abs/path/to/domain"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              style={{ flex: 1, padding: 6, fontSize: 12 }}
            />
            <button
              onClick={onAnalyze}
              disabled={loading || !path.trim()}
              style={{
                padding: "6px 10px",
                background: loading ? "#94a3b8" : "#7c3aed",
                color: "white",
                border: 0,
                borderRadius: 4,
                cursor: loading ? "not-allowed" : "pointer",
                fontSize: 12,
              }}
            >
              {loading ? "解析中…" : "解析"}
            </button>
          </div>
          {error ? <div style={{ color: "#dc2626", fontSize: 12, marginTop: 6 }}>{error}</div> : null}
        </div>

        <ControlPanel
          graph={graph}
          hiddenNodes={hiddenNodes}
          hiddenStereotypes={hiddenStereotypes}
          focus={focus}
          focusDepth={focusDepth}
          groupBy={groupBy}
          layout={layout}
          search={search}
          onToggleNode={(id) =>
            setHiddenNodes((s) => {
              const next = new Set(s);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onToggleStereotype={(s) =>
            setHiddenStereotypes((set) => {
              const next = new Set(set);
              if (next.has(s)) next.delete(s);
              else next.add(s);
              return next;
            })
          }
          onSelectFocus={setFocus}
          onFocusDepth={setFocusDepth}
          onGroupBy={setGroupBy}
          onLayoutChange={setLayout}
          onSearch={setSearch}
          onApplyLayout={() => {
            setManualPositions({});
            setLayoutNonce((n) => n + 1);
          }}
          onShowAll={() => setHiddenNodes(new Set())}
        />
      </aside>

      <main style={{ flex: 1, position: "relative" }}>
        {graph ? (
          <DiagramCanvas
            graph={graph}
            visibleNodes={visibleNodes}
            visibleEdges={visibleEdges}
            layout={layout}
            groupBy={groupBy}
            manualPositions={manualPositions}
            onNodePositionChange={(id, pos) =>
              setManualPositions((m) => ({ ...m, [id]: pos }))
            }
            onSelectNode={(id) => {
              setSelected(id);
              if (id) setFocus(id);
            }}
            layoutNonce={layoutNonce}
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#94a3b8",
              fontSize: 14,
            }}
          >
            左サイドバーから解析したいパスを入力してください。
          </div>
        )}
        {selected && graph ? <SelectedBadge id={selected} graph={graph} /> : null}
      </main>
    </div>
  );
}

function SelectedBadge({ id, graph }: { id: string; graph: ApiGraph }) {
  const n = graph.nodes.find((x) => x.id === id);
  if (!n) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 6,
        padding: "6px 10px",
        fontSize: 12,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      <strong>{n.name}</strong>{" "}
      <span style={{ color: "#64748b" }}>
        {n.stereotype} · {n.file}:{n.line}
      </span>
    </div>
  );
}

// expandFocus performs a BFS of depth `depth` over both directions of the
// graph starting from `rootId` so that the focus view also includes callers,
// not just callees.
function expandFocus(rootId: string, g: ApiGraph, depth: number): Set<string> {
  const adj = new Map<string, Set<string>>();
  for (const n of g.nodes) adj.set(n.id, new Set());
  for (const e of g.edges) {
    adj.get(e.from)?.add(e.to);
    adj.get(e.to)?.add(e.from);
  }
  const keep = new Set<string>([rootId]);
  let frontier = [rootId];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!keep.has(nb)) {
          keep.add(nb);
          next.push(nb);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return keep;
}
