import { useState } from "react";
import type { NetworkInterface } from "@domain/idl";
import { DEFAULT_FORM, type CaptureFormValues } from "@domain/types";

interface Props {
  interfaces: NetworkInterface[];
  busy: boolean;
  running: boolean;
  onStart(values: CaptureFormValues): void;
  onStop(): void;
}

export function CaptureForm({ interfaces, busy, running, onStart, onStop }: Props) {
  const [values, setValues] = useState<CaptureFormValues>(() => ({
    ...DEFAULT_FORM,
    interface: interfaces[0]?.name ?? "",
  }));

  const update = <K extends keyof CaptureFormValues>(k: K, v: CaptureFormValues[K]) =>
    setValues((s) => ({ ...s, [k]: v }));

  return (
    <form
      className="capture-form"
      onSubmit={(e) => {
        e.preventDefault();
        onStart(values);
      }}
    >
      <label>
        Interface
        <select
          value={values.interface}
          onChange={(e) => update("interface", e.target.value)}
          disabled={running || busy}
        >
          <option value="" disabled>
            select…
          </option>
          {interfaces.map((i) => (
            <option key={i.name} value={i.name}>
              {i.name}
              {i.addresses.length ? ` (${i.addresses.join(", ")})` : ""}
            </option>
          ))}
        </select>
      </label>

      <label>
        BPF filter
        <input
          type="text"
          placeholder='e.g. "tcp port 80"'
          value={values.bpfFilter}
          onChange={(e) => update("bpfFilter", e.target.value)}
          disabled={running || busy}
        />
      </label>

      <label>
        Snaplen
        <input
          type="number"
          min={64}
          max={262144}
          value={values.snaplen}
          onChange={(e) => update("snaplen", Number(e.target.value) || 65535)}
          disabled={running || busy}
        />
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={values.promiscuous}
          onChange={(e) => update("promiscuous", e.target.checked)}
          disabled={running || busy}
        />
        promiscuous
      </label>

      {running ? (
        <button type="button" onClick={onStop} disabled={busy} className="danger">
          Stop
        </button>
      ) : (
        <button type="submit" disabled={busy || !values.interface}>
          Start capture
        </button>
      )}
    </form>
  );
}
