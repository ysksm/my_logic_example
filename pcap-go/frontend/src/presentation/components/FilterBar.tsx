import type { PacketFilter } from "@domain/types";
import { PROTOCOL_OPTIONS } from "@domain/types";

interface Props {
  value: PacketFilter;
  onChange(next: PacketFilter): void;
  visible: number;
  total: number;
}

export function FilterBar({ value, onChange, visible, total }: Props) {
  const toggle = (proto: string) => {
    const next = new Set(value.protocols);
    if (next.has(proto)) next.delete(proto);
    else next.add(proto);
    onChange({ ...value, protocols: next });
  };
  const reset = () =>
    onChange({ text: "", protocols: new Set(), address: "", port: "" });

  return (
    <div className="filter-bar">
      <input
        type="text"
        placeholder="search (host, vendor, sni, summary…)"
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        className="filter-text"
      />
      <input
        type="text"
        placeholder="ip / mac"
        value={value.address}
        onChange={(e) => onChange({ ...value, address: e.target.value })}
        className="filter-addr"
      />
      <input
        type="text"
        placeholder="port"
        value={value.port}
        onChange={(e) =>
          onChange({ ...value, port: e.target.value.replace(/[^0-9]/g, "") })
        }
        className="filter-port"
      />
      <div className="filter-protos">
        {PROTOCOL_OPTIONS.map((p) => (
          <label key={p} className={value.protocols.has(p) ? "on" : ""}>
            <input
              type="checkbox"
              checked={value.protocols.has(p)}
              onChange={() => toggle(p)}
            />
            {p}
          </label>
        ))}
      </div>
      <button type="button" onClick={reset} className="filter-reset">
        reset
      </button>
      <span className="filter-counts">
        {visible} / {total}
      </span>
    </div>
  );
}
