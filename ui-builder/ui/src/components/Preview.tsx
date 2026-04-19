import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppDoc, EventAction } from "../types";
import { api } from "../api";
import { renderComponent, resolve } from "./renderComponent";

interface Props { app: AppDoc; onExit: () => void }

// Preview runs an App for real:
//   - state holds form values + state variables
//   - records caches the latest data per model
//   - fire(eventName) interprets the component's event action, then walks
//     the transition table to find the next screen
export function Preview({ app, onExit }: Props) {
  const [screenId, setScreenId] = useState(app.initialScreen || app.screens[0]?.id || "");
  const [state, setState] = useState<Record<string, unknown>>(() => ({
    ...(app.stateVariables ?? {}),
    form: {},
  }));
  const [records, setRecords] = useState<Record<string, { id: string; values: Record<string, unknown> }[]>>({});

  const screen = app.screens.find((s) => s.id === screenId) ?? app.screens[0];

  const reloadRecords = useCallback(async (model: string) => {
    try {
      const list = await api.listRecords(model);
      setRecords((r) => ({ ...r, [model]: list }));
    } catch (_) { /* model may not exist */ }
  }, []);

  // Pre-load any model referenced by a Table on the current screen.
  useEffect(() => {
    if (!screen) return;
    const seen = new Set<string>();
    for (const c of screen.components) {
      if (c.type === "Table" && c.props.model && !seen.has(c.props.model as string)) {
        seen.add(c.props.model as string);
        reloadRecords(c.props.model as string);
      }
    }
  }, [screen, reloadRecords]);

  // Look up the record selected for "show"/"edit" screens.
  const recordForCurrentScreen = useMemo(() => {
    const id = state.selectedId as string | undefined;
    if (!id) return null;
    for (const list of Object.values(records)) {
      const hit = list.find((r) => r.id === id);
      if (hit) return hit;
    }
    return null;
  }, [state.selectedId, records]);

  const transition = useCallback((from: string, event: string) => {
    const t = app.transitions.find((t) => t.from === from && t.event === event);
    if (t) setScreenId(t.to);
  }, [app.transitions]);

  const fire = useCallback(async (componentId: string, payload?: unknown) => {
    if (!screen) return;
    const comp = screen.components.find((c) => c.id === componentId);
    let eventKey: "onClick" | "onRowClick" = "onClick";
    let actualPayload = payload;
    if (
      payload && typeof payload === "object" &&
      "eventName" in payload && "payload" in payload
    ) {
      const wrapper = payload as { eventName: "onClick" | "onRowClick"; payload: unknown };
      eventKey = wrapper.eventName;
      actualPayload = wrapper.payload;
    }
    const action: EventAction | undefined = comp?.events?.[eventKey];
    if (action) await runAction(action, actualPayload);
    transition(screen.id, componentId);
  }, [screen, transition]);

  const runAction = useCallback(async (action: EventAction, payload?: unknown) => {
    const row = (payload as Record<string, unknown> | undefined) ?? undefined;
    switch (action.action) {
      case "navigate": {
        if (action.setVars) {
          const setVars = action.setVars;
          setState((prev) => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(setVars)) {
              next[k] = resolve(v, { mode: "preview", state: prev, records, recordForCurrentScreen }, row);
            }
            return next;
          });
        }
        if (action.target) setScreenId(action.target);
        break;
      }
      case "saveRecord": {
        if (!action.model) return;
        const fromKey = action.from || "form";
        const values = (state[fromKey] as Record<string, unknown>) ?? {};
        const idRaw = action.recordId;
        let id = "";
        if (idRaw && typeof idRaw === "string") {
          const resolved = resolve(idRaw, { mode: "preview", state, records, recordForCurrentScreen });
          id = String(resolved ?? "");
        }
        if (!id) id = String(Date.now());
        await api.saveRecord(action.model, id, values);
        await reloadRecords(action.model);
        setState((prev) => ({ ...prev, [fromKey]: {} }));
        if (action.thenEvent) transition(screen!.id, action.thenEvent);
        break;
      }
      case "deleteRecord": {
        if (!action.model || !action.recordId) return;
        const id = String(resolve(action.recordId, { mode: "preview", state, records, recordForCurrentScreen }) ?? "");
        if (id) {
          await api.deleteRecord(action.model, id);
          await reloadRecords(action.model);
        }
        break;
      }
      case "setVar":
        if (action.varName) {
          const varName = action.varName;
          setState((prev) => ({ ...prev, [varName]: action.value }));
        }
        break;
    }
  }, [state, records, recordForCurrentScreen, reloadRecords, screen, transition]);

  if (!screen) return <div className="empty">No screens</div>;

  return (
    <div className="preview" style={{ height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", padding: 8, background: "#1f2937", color: "#fff" }}>
        <span style={{ flex: 1 }}>Preview · {app.name} · screen: <strong>{screen.name}</strong></span>
        <select value={screenId} onChange={(e) => setScreenId(e.target.value)}
          style={{ background: "#374151", color: "#fff", border: "1px solid #4b5563", padding: 4 }}>
          {app.screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={onExit} style={{ marginLeft: 8 }}>Exit preview</button>
      </div>
      <div className="canvas" style={{ width: 880, height: 600 }}>
        {screen.components.map((c) => (
          <div
            key={c.id}
            className="comp"
            style={{ left: c.props.x, top: c.props.y, width: c.props.w, height: c.props.h, position: "absolute" }}
          >
            {renderComponent(c, { mode: "preview", state, setState, records, fire, recordForCurrentScreen })}
          </div>
        ))}
      </div>
      <details style={{ margin: 16, background: "#fff", padding: 8, borderRadius: 4 }}>
        <summary>Runtime state</summary>
        <pre style={{ fontSize: 12 }}>{JSON.stringify({ screenId, state }, null, 2)}</pre>
      </details>
    </div>
  );
}
