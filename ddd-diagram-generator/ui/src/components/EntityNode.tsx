import { Handle, Position } from "reactflow";
import type { NodeProps } from "reactflow";
import type { ApiNode, Stereotype } from "../types";

const STEREOTYPE_STYLE: Record<Stereotype, { border: string; accent: string; label: string }> = {
  aggregate:   { border: "#7c3aed", accent: "#ede9fe", label: "Aggregate" },
  entity:      { border: "#2563eb", accent: "#dbeafe", label: "Entity" },
  valueObject: { border: "#059669", accent: "#d1fae5", label: "Value Object" },
  repository:  { border: "#d97706", accent: "#fef3c7", label: "Repository" },
  service:     { border: "#db2777", accent: "#fce7f3", label: "Service" },
  factory:     { border: "#db2777", accent: "#fce7f3", label: "Factory" },
  event:       { border: "#dc2626", accent: "#fee2e2", label: "Event" },
  command:     { border: "#0891b2", accent: "#cffafe", label: "Command" },
  query:       { border: "#0e7490", accent: "#cffafe", label: "Query" },
  policy:      { border: "#65a30d", accent: "#ecfccb", label: "Policy" },
  enum:        { border: "#64748b", accent: "#e2e8f0", label: "Enum" },
  typeAlias:   { border: "#64748b", accent: "#f1f5f9", label: "Type" },
  interface:   { border: "#475569", accent: "#f1f5f9", label: "Interface" },
  class:       { border: "#475569", accent: "#f8fafc", label: "Class" },
};

export function EntityNode({ data, selected }: NodeProps<ApiNode>) {
  const style = STEREOTYPE_STYLE[data.stereotype] ?? STEREOTYPE_STYLE.class;
  return (
    <div
      style={{
        border: `2px solid ${style.border}`,
        borderRadius: 8,
        background: "white",
        minWidth: 220,
        maxWidth: 280,
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        boxShadow: selected ? "0 0 0 3px rgba(124,58,237,0.25)" : "0 1px 2px rgba(0,0,0,0.08)",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: style.border }} />
      <div
        style={{
          background: style.accent,
          padding: "6px 10px",
          borderBottom: `1px solid ${style.border}`,
          borderTopLeftRadius: 6,
          borderTopRightRadius: 6,
        }}
      >
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: style.border }}>
          &laquo;{style.label}&raquo;
          {data.aggregate && data.stereotype !== "aggregate" ? (
            <span style={{ marginLeft: 6, color: "#64748b" }}>({data.aggregate})</span>
          ) : null}
        </div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{data.name}</div>
      </div>

      {data.fields.length > 0 && (
        <div style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }}>
          {data.fields.map((f) => (
            <div key={f.name} style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
              <span>
                {f.readonly ? <span style={{ color: "#94a3b8" }}>ro </span> : null}
                {f.name}
                {f.optional ? "?" : ""}
              </span>
              <span style={{ color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.type}
              </span>
            </div>
          ))}
        </div>
      )}

      {data.methods.length > 0 && (
        <div style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }}>
          {data.methods.map((m) => (
            <div key={m.name} style={{ color: "#334155" }}>
              {m.name}(){m.returnType ? <span style={{ color: "#64748b" }}>: {m.returnType}</span> : null}
            </div>
          ))}
        </div>
      )}

      {data.enumValues && data.enumValues.length > 0 && (
        <div style={{ padding: "6px 10px" }}>
          {data.enumValues.map((v) => (
            <div key={v} style={{ color: "#475569" }}>
              {v}
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: "4px 10px", fontSize: 10, color: "#94a3b8" }}>
        {data.file}:{data.line}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: style.border }} />
    </div>
  );
}
