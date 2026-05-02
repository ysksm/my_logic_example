import { useState } from "react";
import type { AppSpec, DomainModel } from "../types";
import { ScreenPreview } from "./ScreenPreview";
import { FlowDiagram } from "./FlowDiagram";
import { DomainDiagram } from "./DomainDiagram";

type Tab = "preview" | "flow" | "er";

interface Props {
  spec: AppSpec | null;
  domain: DomainModel;
  filterAggregate: string | null;
}

const TABS: { id: Tab; label: string; testid: string }[] = [
  { id: "preview", label: "🪟 モックプレビュー", testid: "tab-preview" },
  { id: "flow",    label: "🔀 画面遷移図",       testid: "tab-flow" },
  { id: "er",      label: "📐 ドメイン ER 図",   testid: "tab-er" },
];

export function RightPane({ spec, domain, filterAggregate }: Props) {
  const [tab, setTab] = useState<Tab>("preview");
  return (
    <div
      className="pane right-pane"
      style={{
        display: "flex",
        flexDirection: "column",
        padding: 0,
        overflow: "hidden",
      }}
    >
      <div
        className="right-pane-tabs"
        style={{
          display: "flex",
          background: "#f3f4f6",
          borderBottom: "1px solid #e5e7eb",
          padding: "4px 4px 0",
          gap: 2,
          flexShrink: 0,
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            data-testid={t.testid}
            onClick={() => setTab(t.id)}
            style={{
              border: 0,
              background: tab === t.id ? "#fff" : "transparent",
              padding: "8px 14px",
              borderRadius: "6px 6px 0 0",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? "#1f2937" : "#6b7280",
              borderTop: tab === t.id ? "1px solid #e5e7eb" : 0,
              borderLeft: tab === t.id ? "1px solid #e5e7eb" : 0,
              borderRight: tab === t.id ? "1px solid #e5e7eb" : 0,
              borderBottom: tab === t.id ? "1px solid #fff" : "1px solid transparent",
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto", background: "#fff" }}>
        {tab === "preview" && (
          <ScreenPreview spec={spec} filterAggregate={filterAggregate} />
        )}
        {tab === "flow" && <FlowDiagram spec={spec} />}
        {tab === "er" && <DomainDiagram domain={domain} />}
      </div>
    </div>
  );
}
