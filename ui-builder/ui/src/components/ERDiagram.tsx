import { useEffect, useMemo, useRef, useState } from "react";
import type { Aggregate, Domain, DomainEntity, DomainPosition, ValueObject } from "../types";

interface Props {
  domain: Domain;
  selected: { kind: NodeKind; name: string } | null;
  onSelect: (sel: { kind: NodeKind; name: string } | null) => void;
  onMove: (name: string, p: DomainPosition) => void;
}

export type NodeKind = "vo" | "entity" | "aggregate";

interface NodeBox {
  kind: NodeKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  // textual lines drawn inside
  rows: { label: string; sub?: string; isId?: boolean }[];
  // drawn as a dashed group instead of a regular box
  group?: boolean;
}

const NODE_W = 220;
const ROW_H = 22;
const HEADER_H = 28;

// Lay out anything missing from domain.layout in a simple grid by kind.
function defaultLayouts(domain: Domain): Record<string, DomainPosition> {
  const out: Record<string, DomainPosition> = { ...(domain.layout ?? {}) };
  let row = 0;
  const place = (name: string, col: number) => {
    if (out[name]) return;
    out[name] = { x: 40 + col * (NODE_W + 80), y: 40 + row * 220 };
    row++;
  };
  row = 0; domain.valueObjects.forEach((v) => place(v.name, 0));
  row = 0; domain.entities.forEach((e) => place(e.name, 1));
  row = 0; domain.aggregates.forEach((a) => place(a.name, 2));
  return out;
}

function buildNodes(domain: Domain): NodeBox[] {
  const layout = defaultLayouts(domain);
  const nodes: NodeBox[] = [];

  for (const v of domain.valueObjects) {
    const rows = v.attributes.length === 0
      ? [{ label: "(no attributes)" }]
      : v.attributes.map((a) => ({ label: a.name, sub: typeStr(a) }));
    nodes.push({
      kind: "vo", name: v.name, ...layout[v.name],
      w: NODE_W, h: HEADER_H + ROW_H * rows.length + 8, rows,
    });
  }
  for (const e of domain.entities) {
    const rows: NodeBox["rows"] = [
      { label: e.identifierName || "id", sub: e.identifierType, isId: true },
    ];
    e.attributes.forEach((a) => rows.push({ label: a.name, sub: typeStr(a) }));
    (e.references ?? []).forEach((r) =>
      rows.push({ label: r.name + " →", sub: r.target + (r.cardinality === "many" ? "[]" : "") }));
    nodes.push({
      kind: "entity", name: e.name, ...layout[e.name],
      w: NODE_W, h: HEADER_H + ROW_H * rows.length + 8, rows,
    });
  }
  for (const a of domain.aggregates) {
    // size of the aggregate group is computed lazily based on its members.
    const memberNames = [a.root, ...(a.members ?? [])];
    const memberBoxes = nodes.filter((n) => memberNames.includes(n.name));
    if (memberBoxes.length === 0) {
      nodes.push({
        kind: "aggregate", name: a.name, ...layout[a.name],
        w: NODE_W, h: 80, rows: [{ label: "root: " + a.root }], group: true,
      });
      continue;
    }
    const minX = Math.min(...memberBoxes.map((b) => b.x)) - 16;
    const minY = Math.min(...memberBoxes.map((b) => b.y)) - 36;
    const maxX = Math.max(...memberBoxes.map((b) => b.x + b.w)) + 16;
    const maxY = Math.max(...memberBoxes.map((b) => b.y + b.h)) + 16;
    nodes.push({
      kind: "aggregate", name: a.name,
      x: minX, y: minY, w: maxX - minX, h: maxY - minY,
      rows: [{ label: "root: " + a.root }], group: true,
    });
  }
  return nodes;
}

function typeStr(a: { type: string; list?: boolean }) {
  return a.list ? `${a.type}[]` : a.type;
}

interface Edge { from: string; to: string; label: string; dashed: boolean }

function buildEdges(domain: Domain): Edge[] {
  const voNames = new Set(domain.valueObjects.map((v) => v.name));
  const entNames = new Set(domain.entities.map((e) => e.name));
  const edges: Edge[] = [];
  for (const e of domain.entities) {
    // Identifier link: entity → its identifier VO (dashed).
    if (e.identifierType && voNames.has(e.identifierType)) {
      edges.push({ from: e.name, to: e.identifierType, label: e.identifierName || "id", dashed: true });
    }
    // Attributes typed as a VO → dashed line.
    for (const a of e.attributes) {
      if (voNames.has(a.type)) edges.push({ from: e.name, to: a.type, label: a.name, dashed: true });
    }
    // References to other entities → solid arrow.
    for (const r of e.references ?? []) {
      if (entNames.has(r.target)) {
        edges.push({ from: e.name, to: r.target, label: `${r.name} (${r.cardinality})`, dashed: false });
      }
    }
  }
  return edges;
}

export function ERDiagram({ domain, selected, onSelect, onMove }: Props) {
  const nodes = useMemo(() => buildNodes(domain), [domain]);
  const edges = useMemo(() => buildEdges(domain), [domain]);
  const byName = useMemo(() => Object.fromEntries(nodes.map((n) => [n.name, n])), [nodes]);

  const [drag, setDrag] = useState<{ name: string; ox: number; oy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!drag) return;
    const onMouseMove = (e: MouseEvent) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      onMove(drag.name, { x: e.clientX - rect.left - drag.ox, y: e.clientY - rect.top - drag.oy });
    };
    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, onMove]);

  return (
    <svg
      ref={svgRef}
      width="100%" height="100%"
      style={{ background: "#f3f4f6" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}
    >
      {/* Aggregates first (background) */}
      {nodes.filter((n) => n.group).map((n) => (
        <g key={"agg-" + n.name}
           onClick={(e) => { e.stopPropagation(); onSelect({ kind: "aggregate", name: n.name }); }}>
          <rect x={n.x} y={n.y} width={n.w} height={n.h}
            rx={10} ry={10}
            fill="rgba(124, 58, 237, 0.06)"
            stroke={selected?.kind === "aggregate" && selected.name === n.name ? "#7c3aed" : "#a78bfa"}
            strokeDasharray="6 4" strokeWidth={2} />
          <text x={n.x + 12} y={n.y + 22} fill="#6d28d9" fontSize={13} fontWeight={600}>
            《Aggregate》 {n.name}
          </text>
        </g>
      ))}

      {/* Edges */}
      {edges.map((e, i) => {
        const from = byName[e.from];
        const to = byName[e.to];
        if (!from || !to) return null;
        const f = center(from), t = center(to);
        const mid = { x: (f.x + t.x) / 2, y: (f.y + t.y) / 2 };
        return (
          <g key={i}>
            <line x1={f.x} y1={f.y} x2={t.x} y2={t.y}
              stroke={e.dashed ? "#9ca3af" : "#374151"} strokeWidth={1.5}
              strokeDasharray={e.dashed ? "4 4" : undefined}
              markerEnd={e.dashed ? undefined : "url(#arrow)"} />
            <text x={mid.x} y={mid.y - 4} fontSize={10} fill="#4b5563"
              textAnchor="middle">{e.label}</text>
          </g>
        );
      })}

      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="8" markerHeight="8" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#374151" />
        </marker>
      </defs>

      {/* Nodes (foreground) */}
      {nodes.filter((n) => !n.group).map((n) => {
        const isSelected = selected?.name === n.name && selected.kind === n.kind;
        const colors = palette(n.kind);
        return (
          <g key={n.kind + ":" + n.name}
             style={{ cursor: "move" }}
             onMouseDown={(e) => {
               e.stopPropagation();
               onSelect({ kind: n.kind, name: n.name });
               const rect = svgRef.current!.getBoundingClientRect();
               setDrag({ name: n.name, ox: e.clientX - rect.left - n.x, oy: e.clientY - rect.top - n.y });
             }}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h}
              rx={6} ry={6} fill="#fff"
              stroke={isSelected ? "#2563eb" : colors.border} strokeWidth={isSelected ? 2 : 1} />
            <rect x={n.x} y={n.y} width={n.w} height={HEADER_H}
              rx={6} ry={6} fill={colors.header} />
            <rect x={n.x} y={n.y + HEADER_H - 6} width={n.w} height={6} fill={colors.header} />
            <text x={n.x + 10} y={n.y + 18} fill="#fff" fontSize={12} fontWeight={600}>
              {colors.tag} {n.name}
            </text>
            {n.rows.map((row, ri) => (
              <g key={ri}>
                <text x={n.x + 12} y={n.y + HEADER_H + 16 + ri * ROW_H}
                  fontSize={12} fill="#111" fontWeight={row.isId ? 600 : 400}>
                  {row.isId ? "🔑 " : ""}{row.label}
                </text>
                {row.sub !== undefined && (
                  <text x={n.x + n.w - 12} y={n.y + HEADER_H + 16 + ri * ROW_H}
                    fontSize={11} fill="#6b7280" textAnchor="end">{row.sub}</text>
                )}
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function center(n: { x: number; y: number; w: number; h: number }) {
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}

function palette(kind: NodeKind) {
  if (kind === "vo") return { header: "#0ea5e9", border: "#7dd3fc", tag: "《VO》" };
  if (kind === "entity") return { header: "#10b981", border: "#6ee7b7", tag: "《Entity》" };
  return { header: "#7c3aed", border: "#a78bfa", tag: "《Aggregate》" };
}

// Unused-but-exported helpers for potential reuse.
export type { ValueObject, DomainEntity, Aggregate };
