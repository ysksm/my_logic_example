import type { Aggregate, DomainModel, Entity, Field, ValueObject } from "../types";

const COL_W = 280;
const COL_GAP = 28;
const HEADER_H = 28;
const FIELD_H = 22;
const VGAP = 14;
const TITLE_H = 26;

type BoxKind = "root" | "child" | "vo-id" | "vo";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: BoxKind;
  title: string;
  fields: Field[];
}

interface AggregateLayout {
  ag: Aggregate;
  x: number;
  y: number;
  w: number;
  h: number;
  boxes: Box[];
  /** map field id (`<entityName>.<fieldName>`) → midpoint of its row */
  fieldAnchors: Map<string, { x: number; y: number }>;
}

function entityHeight(e: Entity): number {
  return HEADER_H + Math.max(e.fields.length, 1) * FIELD_H + 6;
}
function voHeight(v: ValueObject): number {
  return HEADER_H + Math.max(v.fields.length, 1) * FIELD_H + 6;
}

function layoutAggregate(ag: Aggregate, originX: number, originY: number): AggregateLayout {
  const boxes: Box[] = [];
  const fieldAnchors = new Map<string, { x: number; y: number }>();
  let y = originY + TITLE_H + 8;
  const innerX = originX + 10;
  const innerW = COL_W - 20;

  // Root entity
  const rootH = entityHeight(ag.root);
  boxes.push({
    x: innerX, y, w: innerW, h: rootH,
    kind: "root", title: ag.root.name, fields: ag.root.fields,
  });
  ag.root.fields.forEach((f, i) => {
    fieldAnchors.set(`${ag.root.name}.${f.name}`, {
      x: innerX + innerW,
      y: y + HEADER_H + i * FIELD_H + FIELD_H / 2,
    });
  });
  y += rootH + VGAP;

  // Child entities
  for (const child of ag.entities ?? []) {
    const h = entityHeight(child);
    boxes.push({
      x: innerX, y, w: innerW, h,
      kind: "child", title: child.name, fields: child.fields,
    });
    child.fields.forEach((f, i) => {
      fieldAnchors.set(`${child.name}.${f.name}`, {
        x: innerX + innerW,
        y: y + HEADER_H + i * FIELD_H + FIELD_H / 2,
      });
    });
    y += h + VGAP;
  }

  // Value objects (Identifier first, dimmed)
  const vos = (ag.valueObjects ?? []).slice().sort((a, b) => Number(b.isIdentifier ?? false) - Number(a.isIdentifier ?? false));
  for (const vo of vos) {
    const h = voHeight(vo);
    boxes.push({
      x: innerX, y, w: innerW, h,
      kind: vo.isIdentifier ? "vo-id" : "vo",
      title: vo.isIdentifier ? `${vo.name} «id»` : `${vo.name} «VO»`,
      fields: vo.fields,
    });
    y += h + VGAP;
  }

  const aggH = y - originY - VGAP + 8;
  return { ag, x: originX, y: originY, w: COL_W, h: aggH, boxes, fieldAnchors };
}

function colorFor(kind: BoxKind): { head: string; bg: string } {
  switch (kind) {
    case "root":  return { head: "#16a34a", bg: "#f0fdf4" };
    case "child": return { head: "#0891b2", bg: "#ecfeff" };
    case "vo-id": return { head: "#6b7280", bg: "#f9fafb" };
    case "vo":    return { head: "#8b5cf6", bg: "#faf5ff" };
  }
}

function fieldTypeLabel(f: Field): string {
  switch (f.type) {
    case "ref": return `→ ${f.refTo ?? "?"}${f.many ? "[]" : ""}`;
    case "vo":  return `«${f.voTypeRef ?? "?"}»`;
    case "enum":return `enum(${(f.enumValues ?? []).length})`;
    default:    return f.type;
  }
}

interface Props {
  domain: DomainModel;
}

export function DomainDiagram({ domain }: Props) {
  if (!domain.aggregates.length) {
    return (
      <div style={{ padding: 16, color: "#6b7280" }}>
        Aggregate がまだありません。左ペインから追加してください。
      </div>
    );
  }

  // Lay out aggregates side by side.
  const margin = 20;
  let x = margin;
  const layouts: AggregateLayout[] = [];
  for (const ag of domain.aggregates) {
    layouts.push(layoutAggregate(ag, x, margin));
    x += COL_W + COL_GAP;
  }
  const width = x - COL_GAP + margin;
  const height = Math.max(...layouts.map((l) => l.y + l.h)) + margin;

  // Build cross-aggregate ref edges: from a Field with type=ref to the
  // target aggregate's header.
  const aggHeaders = new Map<string, { x: number; y: number; w: number }>();
  layouts.forEach((l) =>
    aggHeaders.set(l.ag.name, { x: l.x, y: l.y, w: l.w }),
  );
  const crossRefs: { from: { x: number; y: number }; to: { x: number; y: number }; label: string }[] = [];
  layouts.forEach((l) => {
    const allEntities: Entity[] = [l.ag.root, ...(l.ag.entities ?? [])];
    for (const e of allEntities) {
      for (const f of e.fields) {
        if (f.type === "ref" && f.refTo && aggHeaders.has(f.refTo) && f.refTo !== l.ag.name) {
          const src = l.fieldAnchors.get(`${e.name}.${f.name}`);
          const dst = aggHeaders.get(f.refTo)!;
          if (src) {
            crossRefs.push({
              from: src,
              to: { x: dst.x + dst.w / 2, y: dst.y + 6 },
              label: `${e.name}.${f.name}`,
            });
          }
        }
      }
    }
  });

  return (
    <div style={{ overflow: "auto", padding: 0, background: "#f9fafb", height: "100%" }}>
      <svg
        width={width}
        height={height}
        style={{ display: "block", background: "#f9fafb" }}
      >
        <defs>
          <marker id="dia-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" />
          </marker>
        </defs>

        {/* Cross-aggregate refs (dashed) */}
        {crossRefs.map((e, i) => {
          const midX = (e.from.x + e.to.x) / 2;
          return (
            <g key={i} opacity={0.7}>
              <path
                d={`M ${e.from.x} ${e.from.y} C ${midX} ${e.from.y}, ${midX} ${e.to.y}, ${e.to.x} ${e.to.y}`}
                stroke="#9ca3af"
                strokeWidth={1.4}
                fill="none"
                strokeDasharray="4,3"
                markerEnd="url(#dia-arrow)"
              />
              <text x={midX} y={(e.from.y + e.to.y) / 2 - 6} textAnchor="middle" fontSize={10} fill="#6b7280">
                {e.label}
              </text>
            </g>
          );
        })}

        {/* Aggregate clusters + boxes */}
        {layouts.map((l, i) => (
          <AggregateView key={i} layout={l} />
        ))}
      </svg>
    </div>
  );
}

function AggregateView({ layout }: { layout: AggregateLayout }) {
  const { ag, x, y, w, h, boxes } = layout;
  return (
    <g>
      {/* Aggregate dashed cluster */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="rgba(168, 85, 247, 0.04)"
        stroke="#a855f7"
        strokeWidth={1.5}
        strokeDasharray="6,4"
        rx={8}
      />
      <rect x={x} y={y} width={w} height={TITLE_H} fill="#a855f7" rx={8} />
      <rect x={x} y={y + TITLE_H - 8} width={w} height={8} fill="#a855f7" />
      <text x={x + 10} y={y + 18} fill="#fff" fontSize={13} fontWeight={700}>
        {ag.isSingleton ? "⚙ " : "◆ "}
        {ag.name}
        {ag.isSingleton ? "  (singleton)" : ""}
      </text>

      {boxes.map((b, i) => (
        <BoxView key={i} box={b} />
      ))}
    </g>
  );
}

function BoxView({ box }: { box: Box }) {
  const { head, bg } = colorFor(box.kind);
  return (
    <g>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={bg} stroke="#d1d5db" rx={4} />
      <rect x={box.x} y={box.y} width={box.w} height={HEADER_H} fill={head} rx={4} />
      <rect x={box.x} y={box.y + HEADER_H - 6} width={box.w} height={6} fill={head} />
      <text x={box.x + 8} y={box.y + 18} fill="#fff" fontSize={12} fontWeight={600}>
        {box.title}
      </text>
      {box.fields.length === 0 && (
        <text x={box.x + 8} y={box.y + HEADER_H + 14} fontSize={11} fill="#9ca3af">
          (no fields)
        </text>
      )}
      {box.fields.map((f, i) => {
        const yy = box.y + HEADER_H + i * FIELD_H + 14;
        return (
          <g key={i}>
            <text x={box.x + 8} y={yy} fontSize={11} fill="#1f2937" fontFamily="ui-monospace, monospace">
              {f.required ? "*" : " "}
              {f.name}
            </text>
            <text x={box.x + box.w - 8} y={yy} fontSize={11} textAnchor="end" fill="#6b7280" fontFamily="ui-monospace, monospace">
              {fieldTypeLabel(f)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
