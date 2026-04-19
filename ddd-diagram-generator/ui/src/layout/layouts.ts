import * as dagre from "@dagrejs/dagre";
import type { CSSProperties } from "react";
import type { Node, Edge } from "reactflow";
import type { ApiEdge, ApiNode, LayoutName } from "../types";

const NODE_WIDTH = 260;
const NODE_HEIGHT_BASE = 80;

function nodeHeight(n: ApiNode): number {
  const fields = n.fields ?? [];
  const methods = n.methods ?? [];
  return NODE_HEIGHT_BASE + fields.length * 18 + (methods.length > 0 ? 12 + methods.length * 16 : 0);
}

export interface LayoutInput {
  nodes: ApiNode[];
  edges: ApiEdge[];
}

export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>;
}

export function computeLayout(name: LayoutName, data: LayoutInput): LayoutResult {
  switch (name) {
    case "dagre-lr":
      return dagreLayout(data, "LR");
    case "dagre-tb":
      return dagreLayout(data, "TB");
    case "grid":
      return gridLayout(data);
    case "cluster-aggregate":
      return clusterLayout(data, (n) => n.aggregate || n.module || "other");
    case "cluster-module":
      return clusterLayout(data, (n) => n.module || "other");
    default:
      return dagreLayout(data, "LR");
  }
}

function dagreLayout(data: LayoutInput, direction: "LR" | "TB"): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, marginx: 40, marginy: 40, nodesep: 40, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of data.nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: nodeHeight(n) });
  }
  for (const e of data.edges) {
    if (g.hasNode(e.from) && g.hasNode(e.to)) {
      g.setEdge(e.from, e.to);
    }
  }
  dagre.layout(g);

  const positions: LayoutResult["positions"] = {};
  for (const n of data.nodes) {
    const node = g.node(n.id);
    if (node) {
      positions[n.id] = { x: node.x - NODE_WIDTH / 2, y: node.y - nodeHeight(n) / 2 };
    }
  }
  return { positions };
}

function gridLayout(data: LayoutInput): LayoutResult {
  const cols = Math.max(1, Math.ceil(Math.sqrt(data.nodes.length)));
  const gap = 40;
  const positions: LayoutResult["positions"] = {};
  data.nodes.forEach((n, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    positions[n.id] = { x: c * (NODE_WIDTH + gap), y: r * (NODE_HEIGHT_BASE * 3 + gap) };
  });
  return { positions };
}

function clusterLayout(data: LayoutInput, keyOf: (n: ApiNode) => string): LayoutResult {
  const clusters = new Map<string, ApiNode[]>();
  for (const n of data.nodes) {
    const k = keyOf(n);
    if (!clusters.has(k)) clusters.set(k, []);
    clusters.get(k)!.push(n);
  }
  const positions: LayoutResult["positions"] = {};
  const clusterKeys = [...clusters.keys()].sort();
  const clusterGap = 80;
  let offsetX = 0;
  for (const key of clusterKeys) {
    const members = clusters.get(key)!;
    // Lay out each cluster as its own mini-dagre, then shift to offsetX.
    const sub = dagreLayout({ nodes: members, edges: data.edges.filter((e) => clusters.get(key)!.some((n) => n.id === e.from) && clusters.get(key)!.some((n) => n.id === e.to)) }, "TB");
    let maxX = 0;
    for (const id of Object.keys(sub.positions)) {
      const p = sub.positions[id];
      positions[id] = { x: p.x + offsetX, y: p.y };
      maxX = Math.max(maxX, p.x + NODE_WIDTH);
    }
    offsetX += maxX + clusterGap;
  }
  return { positions };
}

// Build React Flow node objects, given a graph and an optional layout.
export function toReactFlow(
  nodes: ApiNode[],
  edges: ApiEdge[],
  positions: Record<string, { x: number; y: number }>,
  existing: Record<string, { x: number; y: number }> = {},
): { nodes: Node[]; edges: Edge[] } {
  const rfNodes: Node[] = nodes.map((n) => {
    const p = existing[n.id] ?? positions[n.id] ?? { x: 0, y: 0 };
    return {
      id: n.id,
      type: "entity",
      position: p,
      data: n,
    };
  });
  const rfEdges: Edge[] = edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    label: e.label || undefined,
    type: "smoothstep",
    animated: e.kind === "extends" || e.kind === "implements",
    style: edgeStyle(e.kind),
    markerEnd: { type: "arrowclosed", color: edgeColor(e.kind) } as never,
    data: e,
  }));
  return { nodes: rfNodes, edges: rfEdges };
}

function edgeColor(kind: ApiEdge["kind"]): string {
  switch (kind) {
    case "extends":
      return "#6d28d9";
    case "implements":
      return "#2563eb";
    case "field":
      return "#334155";
    case "method":
      return "#94a3b8";
    default:
      return "#94a3b8";
  }
}

function edgeStyle(kind: ApiEdge["kind"]): CSSProperties {
  const base: CSSProperties = { stroke: edgeColor(kind), strokeWidth: 1.5 };
  if (kind === "implements") {
    base.strokeDasharray = "4 4";
  }
  if (kind === "method") {
    base.strokeDasharray = "2 3";
    base.strokeWidth = 1;
  }
  return base;
}
