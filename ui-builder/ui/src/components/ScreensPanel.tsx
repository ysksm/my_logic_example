import type { Screen, Transition } from "../types";

interface Props {
  screens: Screen[];
  transitions: Transition[];
  initialScreen: string;
  currentScreenId: string;
  onSelect: (id: string) => void;
  onAddScreen: () => void;
  onDeleteScreen: (id: string) => void;
  onSetInitial: (id: string) => void;
  onAddTransition: (t: Transition) => void;
  onDeleteTransition: (i: number) => void;
}

// ScreensPanel doubles as a state-machine editor: each screen is a state,
// each transition is an edge, the initial screen is the start state.
export function ScreensPanel(p: Props) {
  return (
    <div>
      <h3>Screens (states)</h3>
      <ul>
        {p.screens.map((s) => (
          <li
            key={s.id}
            className={`list-item ${s.id === p.currentScreenId ? "active" : ""}`}
            onClick={() => p.onSelect(s.id)}
          >
            {s.id === p.initialScreen ? "★ " : ""}
            {s.name}
            <button
              style={{ float: "right", fontSize: 11, background: "transparent", border: "none", color: "inherit", cursor: "pointer" }}
              title="Set as initial"
              onClick={(e) => { e.stopPropagation(); p.onSetInitial(s.id); }}
            >set</button>
          </li>
        ))}
      </ul>
      <button onClick={p.onAddScreen}>+ Add screen</button>
      {p.currentScreenId && (
        <button style={{ marginLeft: 6 }} onClick={() => p.onDeleteScreen(p.currentScreenId)}>
          Delete current
        </button>
      )}

      <h3 style={{ marginTop: 16 }}>Transitions</h3>
      <ul>
        {p.transitions.map((t, i) => (
          <li key={i} className="list-item" style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "monospace", fontSize: 12 }}>
              {nameOf(p.screens, t.from)} → {nameOf(p.screens, t.to)} ({t.event})
            </span>
            <button onClick={() => p.onDeleteTransition(i)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#ef4444" }}>×</button>
          </li>
        ))}
      </ul>
      <AddTransition screens={p.screens} onAdd={p.onAddTransition} />
    </div>
  );
}

function nameOf(screens: Screen[], id: string) {
  return screens.find((s) => s.id === id)?.name ?? id;
}

function AddTransition({ screens, onAdd }: { screens: Screen[]; onAdd: (t: Transition) => void }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        onAdd({
          from: String(data.get("from") || ""),
          to: String(data.get("to") || ""),
          event: String(data.get("event") || ""),
        });
        e.currentTarget.reset();
      }}
      style={{ marginTop: 6, display: "grid", gap: 4 }}
    >
      <select name="from" required>
        <option value="">from…</option>
        {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select name="to" required>
        <option value="">to…</option>
        {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <input name="event" placeholder="event (component id or saved/etc)" required />
      <button type="submit">+ Add transition</button>
    </form>
  );
}
