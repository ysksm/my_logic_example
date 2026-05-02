import type { AppSpec, Screen, Transition } from "../types";

const NODE_W = 200;
const NODE_H = 76;
const HGAP = 56;
const VGAP = 60;
const SVC_HEAD = 22;

interface NodePos {
  id: string;
  x: number;
  y: number;
  screen: Screen;
}
interface RowLayout {
  aggregate: string;
  pattern: string;
  reason: string;
  yStart: number;
  yEnd: number;
  nodes: NodePos[];
}

function kindColor(kind: string): string {
  switch (kind) {
    case "list":         return "#3b82f6";
    case "detail":       return "#10b981";
    case "edit":         return "#f59e0b";
    case "modal":        return "#fb7185";
    case "settings":     return "#8b5cf6";
    case "form":         return "#8b5cf6";
    case "master":       return "#a855f7";
    case "wizard-step":  return "#06b6d4";
    case "wizard-review":return "#0891b2";
    case "confirm":      return "#dc2626";
    case "create":       return "#f59e0b";
    default:             return "#6b7280";
  }
}

interface Props {
  spec: AppSpec | null;
}

export function FlowDiagram({ spec }: Props) {
  if (!spec || spec.plans.length === 0) {
    return (
      <div style={{ padding: 16, color: "#6b7280" }}>
        ▶ 派生 を実行すると、画面遷移図がここに表示されます。
      </div>
    );
  }

  // Lay out: one row per Aggregate, screens in plan order across the row.
  const rows: RowLayout[] = [];
  let y = 30;
  for (const plan of spec.plans) {
    const screens = plan.screenIds
      .map((id) => spec.screens.find((s) => s.id === id))
      .filter((s): s is Screen => !!s);
    if (screens.length === 0) continue;
    const yStart = y;
    let x = 30;
    const nodes: NodePos[] = [];
    for (const s of screens) {
      nodes.push({ id: s.id, x, y: y + SVC_HEAD, screen: s });
      x += NODE_W + HGAP;
    }
    const yEnd = y + SVC_HEAD + NODE_H + 30;
    rows.push({
      aggregate: plan.aggregateRef,
      pattern: plan.pattern,
      reason: plan.reason,
      yStart, yEnd, nodes,
    });
    y = yEnd + VGAP;
  }
  if (rows.length === 0) {
    return (
      <div style={{ padding: 16, color: "#6b7280" }}>
        生成された画面がありません。
      </div>
    );
  }

  const width = Math.max(...rows.map((r) => r.nodes[r.nodes.length - 1]?.x ?? 0)) + NODE_W + 30;
  const height = rows[rows.length - 1].yEnd + 20;

  // Index nodes for edge lookup.
  const nodeMap = new Map<string, NodePos>();
  rows.forEach((r) => r.nodes.forEach((n) => nodeMap.set(n.id, n)));

  return (
    <div style={{ overflow: "auto", height: "100%", background: "#f9fafb" }}>
      <svg width={width} height={height} style={{ display: "block", background: "#f9fafb" }}>
        <defs>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#374151" />
          </marker>
          <marker id="flow-arrow-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" />
          </marker>
        </defs>

        {rows.map((r, i) => (
          <RowBackground key={i} row={r} width={width} />
        ))}

        {spec.transitions.map((t, i) => (
          <Edge key={i} t={t} nodeMap={nodeMap} />
        ))}

        {rows.map((r) =>
          r.nodes.map((n) => <Node key={n.id} node={n} />),
        )}
      </svg>
    </div>
  );
}

function RowBackground({ row, width }: { row: RowLayout; width: number }) {
  return (
    <g>
      <rect
        x={10}
        y={row.yStart - 4}
        width={width - 20}
        height={row.yEnd - row.yStart + 8}
        fill="rgba(168, 85, 247, 0.04)"
        stroke="#a855f7"
        strokeWidth={1}
        strokeDasharray="4,4"
        rx={8}
      />
      <text x={20} y={row.yStart + 14} fontSize={12} fontWeight={700} fill="#7c3aed">
        ◆ {row.aggregate}
      </text>
      <text x={120} y={row.yStart + 14} fontSize={11} fill="#7c3aed">
        [{row.pattern}] {row.reason}
      </text>
    </g>
  );
}

function Node({ node }: { node: NodePos }) {
  const head = kindColor(node.screen.kind);
  return (
    <g>
      <rect
        x={node.x}
        y={node.y}
        width={NODE_W}
        height={NODE_H}
        fill="#fff"
        stroke="#374151"
        strokeWidth={1.2}
        rx={6}
      />
      <rect x={node.x} y={node.y} width={NODE_W} height={20} fill={head} rx={6} />
      <rect x={node.x} y={node.y + 14} width={NODE_W} height={6} fill={head} />
      <text x={node.x + 8} y={node.y + 14} fill="#fff" fontSize={11} fontWeight={700}>
        {node.screen.kind}
      </text>
      <text
        x={node.x + NODE_W / 2}
        y={node.y + 42}
        textAnchor="middle"
        fontSize={13}
        fill="#1f2937"
        fontWeight={600}
      >
        {node.screen.title}
      </text>
      <text
        x={node.x + NODE_W / 2}
        y={node.y + 60}
        textAnchor="middle"
        fontSize={9}
        fill="#9ca3af"
        fontFamily="ui-monospace, monospace"
      >
        {node.screen.id}
      </text>
    </g>
  );
}

function Edge({ t, nodeMap }: { t: Transition; nodeMap: Map<string, NodePos> }) {
  const from = nodeMap.get(t.from);
  const to = nodeMap.get(t.to);
  if (!from || !to) return null;

  // Self-loop: small arc above the node.
  if (from.id === to.id) {
    const x = from.x + NODE_W / 2;
    const top = from.y;
    const dy = 28;
    return (
      <g>
        <path
          d={`M ${x - 12} ${top} C ${x - 30} ${top - dy}, ${x + 30} ${top - dy}, ${x + 12} ${top}`}
          stroke="#374151"
          strokeWidth={1.4}
          fill="none"
          markerEnd="url(#flow-arrow)"
        />
        <text x={x} y={top - dy + 2} textAnchor="middle" fontSize={10} fill="#374151">
          {t.event}
        </text>
      </g>
    );
  }

  // Forward (left → right) — straight line with label background.
  // Backward (right → left) — curved above with dashed style.
  const sameRow = Math.abs(from.y - to.y) < 4;
  const forward = from.x < to.x;
  if (sameRow && forward) {
    const x1 = from.x + NODE_W;
    const x2 = to.x;
    const yMid = from.y + NODE_H / 2;
    const labelX = (x1 + x2) / 2;
    return (
      <g>
        <line
          x1={x1}
          y1={yMid}
          x2={x2}
          y2={yMid}
          stroke="#374151"
          strokeWidth={1.4}
          markerEnd="url(#flow-arrow)"
        />
        <rect x={labelX - 28} y={yMid - 16} width={56} height={14} fill="#fff" stroke="#d1d5db" rx={3} />
        <text x={labelX} y={yMid - 5} textAnchor="middle" fontSize={10} fill="#1f2937">
          {t.event}
        </text>
      </g>
    );
  }
  if (sameRow && !forward) {
    const x1 = from.x;
    const x2 = to.x + NODE_W;
    const yMid = from.y + NODE_H / 2;
    const arc = Math.min(50, Math.abs(x1 - x2) / 4 + 20);
    const cy = yMid - arc - 8;
    return (
      <g>
        <path
          d={`M ${x1} ${yMid} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${yMid}`}
          stroke="#9ca3af"
          strokeWidth={1.2}
          strokeDasharray="4,3"
          fill="none"
          markerEnd="url(#flow-arrow-back)"
        />
        <text x={(x1 + x2) / 2} y={cy + 2} textAnchor="middle" fontSize={10} fill="#6b7280">
          {t.event}
        </text>
      </g>
    );
  }
  // Cross-row (rare for our patterns) — straight diagonal.
  const x1 = from.x + NODE_W / 2;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x + NODE_W / 2;
  const y2 = to.y + NODE_H / 2;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#374151" strokeWidth={1.2} markerEnd="url(#flow-arrow)" />
      <text x={(x1 + x2) / 2} y={(y1 + y2) / 2} fontSize={10} fill="#374151">
        {t.event}
      </text>
    </g>
  );
}
