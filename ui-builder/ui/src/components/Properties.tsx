import type { AppComponent, EventAction, Screen } from "../types";

interface Props {
  comp: AppComponent | null;
  screens: Screen[];
  models: string[];
  onChange: (patch: Partial<AppComponent>) => void;
  onDelete: () => void;
}

// Properties is a generic JSON editor with a friendlier section for the
// onClick action. Per-component schemas would scale better, but a flat
// list of inputs covers everything we ship today.
export function Properties({ comp, screens, models, onChange, onDelete }: Props) {
  if (!comp) {
    return (
      <div className="props">
        <h3>Properties</h3>
        <p style={{ color: "#9ca3af" }}>Select a component to edit it.</p>
      </div>
    );
  }
  const set = (key: string, value: unknown) =>
    onChange({ props: { ...comp.props, [key]: value } });
  const setEvent = (name: string, action: EventAction | null) => {
    const events = { ...(comp.events || {}) };
    if (action) events[name] = action;
    else delete events[name];
    onChange({ events });
  };

  return (
    <div className="props">
      <h3>Properties — {comp.type}</h3>
      <label>id</label>
      <input value={comp.id} onChange={(e) => onChange({ id: e.target.value })} />

      <div className="row">
        <div><label>x</label><input type="number" value={comp.props.x as number}
          onChange={(e) => set("x", Number(e.target.value))} /></div>
        <div><label>y</label><input type="number" value={comp.props.y as number}
          onChange={(e) => set("y", Number(e.target.value))} /></div>
        <div><label>w</label><input type="number" value={comp.props.w as number}
          onChange={(e) => set("w", Number(e.target.value))} /></div>
        <div><label>h</label><input type="number" value={comp.props.h as number}
          onChange={(e) => set("h", Number(e.target.value))} /></div>
      </div>

      {/* Custom props for known component types */}
      {("text" in comp.props || comp.type === "Text") && (
        <>
          <label>text</label>
          <input value={String(comp.props.text ?? "")} onChange={(e) => set("text", e.target.value)} />
        </>
      )}
      {comp.type === "Button" && (
        <>
          <label>label</label>
          <input value={String(comp.props.label ?? "")} onChange={(e) => set("label", e.target.value)} />
          <label>
            <input type="checkbox" checked={Boolean(comp.props.primary)}
              onChange={(e) => set("primary", e.target.checked)} /> primary
          </label>
        </>
      )}
      {(comp.type === "Input" || comp.type === "Textarea" ||
        comp.type === "NumberInput" || comp.type === "DateInput" ||
        comp.type === "Checkbox") && (
        <>
          <label>bind (e.g. form.title)</label>
          <input value={String(comp.props.bind ?? "")} onChange={(e) => set("bind", e.target.value)} />
          <label>placeholder</label>
          <input value={String(comp.props.placeholder ?? "")} onChange={(e) => set("placeholder", e.target.value)} />
        </>
      )}
      {comp.type === "Table" && (
        <>
          <label>model</label>
          <select value={String(comp.props.model ?? "")} onChange={(e) => set("model", e.target.value)}>
            <option value="">(choose)</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </>
      )}

      <h3 style={{ marginTop: 16 }}>onClick</h3>
      <EventEditor
        action={comp.events?.onClick}
        screens={screens}
        models={models}
        onChange={(a) => setEvent("onClick", a)}
      />

      <button className="danger" onClick={onDelete}>Delete component</button>
    </div>
  );
}

interface EventProps {
  action: EventAction | undefined;
  screens: Screen[];
  models: string[];
  onChange: (a: EventAction | null) => void;
}

function EventEditor({ action, screens, models, onChange }: EventProps) {
  const a = action ?? { action: "navigate" as const };
  return (
    <>
      <label>action</label>
      <select value={a.action} onChange={(e) =>
        onChange({ action: e.target.value as EventAction["action"] })
      }>
        <option value="navigate">navigate</option>
        <option value="saveRecord">saveRecord</option>
        <option value="deleteRecord">deleteRecord</option>
        <option value="setVar">setVar</option>
      </select>
      {a.action === "navigate" && (
        <>
          <label>target screen</label>
          <select value={a.target ?? ""} onChange={(e) => onChange({ ...a, target: e.target.value })}>
            <option value="">(choose)</option>
            {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </>
      )}
      {(a.action === "saveRecord" || a.action === "deleteRecord") && (
        <>
          <label>model</label>
          <select value={a.model ?? ""} onChange={(e) => onChange({ ...a, model: e.target.value })}>
            <option value="">(choose)</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {a.action === "saveRecord" && (
            <>
              <label>read values from (state var)</label>
              <input value={a.from ?? "form"} onChange={(e) => onChange({ ...a, from: e.target.value })} />
              <label>recordId (literal or $state.x)</label>
              <input value={a.recordId ?? ""} onChange={(e) => onChange({ ...a, recordId: e.target.value })} />
              <label>then dispatch event</label>
              <input value={a.thenEvent ?? ""} onChange={(e) => onChange({ ...a, thenEvent: e.target.value })} />
            </>
          )}
        </>
      )}
      {a.action === "setVar" && (
        <>
          <label>var name</label>
          <input value={a.varName ?? ""} onChange={(e) => onChange({ ...a, varName: e.target.value })} />
          <label>value</label>
          <input value={String(a.value ?? "")} onChange={(e) => onChange({ ...a, value: e.target.value })} />
        </>
      )}
      {action && (
        <button className="danger" onClick={() => onChange(null)} style={{ marginTop: 8 }}>Remove handler</button>
      )}
    </>
  );
}
