import { useMemo } from "react";
import ReactFlow, { Background, Controls, MiniMap, type Node, type NodeTypes } from "reactflow";
import "reactflow/dist/style.css";
import { EntityNode } from "./EntityNode";
import type { ApiEdge, ApiGraph, ApiNode, GroupBy, LayoutName } from "../types";
import { computeLayout, toReactFlow } from "../layout/layouts";

const nodeTypes: NodeTypes = { entity: EntityNode };

const GROUP_PALETTE = ["#7c3aed", "#2563eb", "#059669", "#d97706", "#db2777", "#0891b2", "#65a30d", "#475569"];

interface Props {
  graph: ApiGraph;
  visibleNodes: ApiNode[];
  visibleEdges: ApiEdge[];
  layout: LayoutName;
  groupBy: GroupBy;
  manualPositions: Record<string, { x: number; y: number }>;
  onNodePositionChange(id: string, pos: { x: number; y: number }): void;
  onSelectNode(id: string | null): void;
  layoutNonce: number;
}

export function DiagramCanvas(p: Props) {
  const { nodes, edges } = useMemo(() => {
    const computed = computeLayout(p.layout, { nodes: p.visibleNodes, edges: p.visibleEdges });
    const rf = toReactFlow(p.visibleNodes, p.visibleEdges, computed.positions, p.manualPositions);
    const withGroups = addGroupNodes(p.visibleNodes, rf.nodes, p.groupBy);
    return { nodes: withGroups, edges: rf.edges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.visibleNodes, p.visibleEdges, p.layout, p.groupBy, p.layoutNonce]);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeDragStop={(_, n) => p.onNodePositionChange(n.id, n.position)}
        onNodeClick={(_, n) => {
          if (n.type === "entity") p.onSelectNode(n.id);
        }}
        onPaneClick={() => p.onSelectNode(null)}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}

// addGroupNodes injects reactflow "group" nodes behind the entity nodes. The
// entities themselves keep their absolute positions; group nodes are sized /
// positioned to encompass their members.
function addGroupNodes(visible: ApiNode[], rfNodes: Node[], groupBy: GroupBy): Node[] {
  if (groupBy === "none") return rfNodes;
  const posById = new Map(rfNodes.filter((n) => n.type === "entity").map((n) => [n.id, n.position]));
  const keyOf = (n: ApiNode) =>
    groupBy === "aggregate"
      ? n.aggregate || ""
      : groupBy === "module"
      ? n.module
      : n.stereotype;

  const groups = new Map<string, ApiNode[]>();
  for (const n of visible) {
    const k = keyOf(n);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(n);
  }

  const groupNodes: Node[] = [];
  let i = 0;
  for (const [k, members] of groups) {
    if (members.length < 2) continue;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const m of members) {
      const p = posById.get(m.id);
      if (!p) continue;
      const h = 80 + m.fields.length * 18 + (m.methods.length ? 12 + m.methods.length * 16 : 0);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + 260);
      maxY = Math.max(maxY, p.y + h);
    }
    if (!Number.isFinite(minX)) continue;
    const color = GROUP_PALETTE[i % GROUP_PALETTE.length];
    const pad = 24;
    groupNodes.push({
      id: `group:${groupBy}:${k}`,
      type: "default",
      position: { x: minX - pad, y: minY - pad - 14 },
      draggable: false,
      selectable: false,
      connectable: false,
      zIndex: -1,
      data: { label: k },
      style: {
        width: maxX - minX + pad * 2,
        height: maxY - minY + pad * 2 + 14,
        background: color + "14",
        border: `1.5px dashed ${color}`,
        borderRadius: 12,
        color,
        fontSize: 12,
        fontWeight: 600,
        textAlign: "left",
        padding: "6px 10px",
        pointerEvents: "none",
      },
    });
    i++;
  }
  // Group nodes must come first so reactflow renders them behind entities.
  return [...groupNodes, ...rfNodes];
}
