import type { AggregatePlan, AppSpec, Component, Screen } from "../types";

interface Props {
  spec: AppSpec | null;
  filterAggregate: string | null;
}

export function ScreenPreview({ spec, filterAggregate }: Props) {
  if (!spec) {
    return (
      <div className="pane">
        <h2>UI 派生</h2>
        <p style={{ color: "#6b7280" }}>「派生」を押すと、左のドメイン定義から画面仕様 (IR2) を生成します。</p>
      </div>
    );
  }
  const plans = filterAggregate
    ? spec.plans.filter((p) => p.aggregateRef === filterAggregate)
    : spec.plans;
  return (
    <div className="pane">
      <h2>UI 派生 ({plans.length} aggregate)</h2>
      {plans.map((plan) => (
        <PlanBlock key={plan.aggregateRef} plan={plan} spec={spec} />
      ))}
    </div>
  );
}

function PlanBlock({ plan, spec }: { plan: AggregatePlan; spec: AppSpec }) {
  const screens = plan.screenIds
    .map((id) => spec.screens.find((s) => s.id === id))
    .filter((s): s is Screen => !!s);
  const transitions = spec.transitions.filter((t) =>
    plan.screenIds.includes(t.from) || plan.screenIds.includes(t.to),
  );
  return (
    <div className="plan-card">
      <div>
        <span className="pattern-badge">{plan.pattern}</span>
        <strong>{plan.aggregateRef}</strong>
      </div>
      <div className="reason">{plan.reason}</div>
      <div style={{ marginTop: 8 }}>
        {screens.map((s) => <ScreenCard key={s.id} screen={s} />)}
      </div>
      {transitions.length > 0 && (
        <div className="transitions">
          <strong>transitions:</strong>{" "}
          {transitions.map((t, i) => (
            <span key={i}>
              {i > 0 && ", "}
              <code>{t.from}</code>→<code>{t.to}</code> [{t.event}]
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ScreenCard({ screen }: { screen: Screen }) {
  return (
    <div className="screen-card">
      <div className="head">
        <span>{screen.title}</span>
        <span className="kind">{screen.kind}</span>
      </div>
      <div className="body">
        {screen.components.map((c, i) => <CompMock key={i} c={c} />)}
      </div>
    </div>
  );
}

function CompMock({ c }: { c: Component }) {
  switch (c.type) {
    case "TextInput":
      return (<div><span className="field-label">{c.label}</span><div className="mock-input">［ {c.bind} ］</div></div>);
    case "TextArea":
      return (<div><span className="field-label">{c.label}</span><div className="mock-textarea">［ {c.bind} ］</div></div>);
    case "Checkbox":
      return (<div className="mock-checkbox">☐ {c.label}</div>);
    case "DatePicker":
      return (<div><span className="field-label">{c.label}</span><div className="mock-date">📅 {c.bind}</div></div>);
    case "NumberInput":
      return (<div><span className="field-label">{c.label}</span><div className="mock-number">123</div></div>);
    case "Select":
    case "RadioGroup": {
      const opts = (c.props?.options as string[] | undefined) ?? [];
      return (
        <div>
          <span className="field-label">{c.label} {c.type === "RadioGroup" ? "(radio)" : "(select)"}</span>
          <div className="mock-select">{opts.join(" / ") || "(空)"}</div>
        </div>
      );
    }
    case "RefPicker":
      return (
        <div>
          <span className="field-label">{c.label} → {String(c.props?.refTo ?? "?")}{c.props?.many ? " (多)" : ""}</span>
          <div className="mock-input">🔍 picker</div>
        </div>
      );
    case "Hidden":
      return (<div style={{ fontSize: 11, color: "#9ca3af" }}>(hidden: {c.bind})</div>);
    case "Section":
      return (
        <div className="mock-section">
          <div className="label">{c.label}</div>
          {(c.children ?? []).map((cc, i) => <CompMock key={i} c={cc} />)}
        </div>
      );
    case "Tab": {
      return (
        <div className="mock-section">
          <div className="label">▶ tab: {c.label}</div>
          {(c.children ?? []).map((cc, i) => <CompMock key={i} c={cc} />)}
        </div>
      );
    }
    case "Button": {
      const cancel = c.props?.event === "cancel" || c.props?.event === "close" || c.props?.event === "back";
      return (<span className={`mock-button ${cancel ? "cancel" : ""}`}>{c.label}</span>);
    }
    case "Table":
    case "EditableTable": {
      const cols = c.children ?? [];
      return (
        <div className="mock-table">
          <div className="row header">
            {cols.map((col, i) => <div className="col" key={i}>{col.label}</div>)}
          </div>
          {[1, 2].map((row) => (
            <div className="row" key={row}>
              {cols.map((_col, i) => <div className="col" key={i}>...</div>)}
            </div>
          ))}
        </div>
      );
    }
    case "ReadOnlyForm":
      return (
        <div className="mock-section">
          <div className="label">read-only</div>
          {(c.children ?? []).map((cc, i) => <CompMock key={i} c={cc} />)}
        </div>
      );
    case "Summary":
      return (<div className="mock-section"><div className="label">summary of form</div></div>);
    case "ConfirmDialog":
      return (<div className="mock-section"><div className="label">confirm</div>{c.label}</div>);
    default:
      return (<div className="mock-input">{c.type}: {c.label ?? ""}</div>);
  }
}
