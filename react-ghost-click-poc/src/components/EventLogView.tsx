import { useSyncExternalStore } from "react";
import { getSnapshot, subscribe } from "../lib/eventLog";

export function EventLogView() {
  const entries = useSyncExternalStore(subscribe, getSnapshot);
  const t0 = entries[0]?.t ?? 0;

  return (
    <ol className="event-log" data-testid="event-log">
      {entries.map((e) => (
        <li
          key={e.id}
          className={e.ghost ? "event-log__ghost" : e.note ? "event-log__note" : undefined}
        >
          <span className="event-log__time">{(e.t - t0).toFixed(1).padStart(7)}ms</span>{" "}
          <span className="event-log__type">{e.type}</span> {e.detail}
          {e.ghost && <strong> 👻 ghost click</strong>}
        </li>
      ))}
    </ol>
  );
}
