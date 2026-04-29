import type { Packet } from "@domain/idl";

interface Props {
  packets: Packet[];
}

export function PacketTable({ packets }: Props) {
  return (
    <div className="packet-table-wrap">
      <table className="packet-table">
        <thead>
          <tr>
            <th style={{ width: "5rem" }}>#</th>
            <th style={{ width: "13rem" }}>time</th>
            <th>protocol</th>
            <th>source</th>
            <th>destination</th>
            <th>summary</th>
            <th style={{ width: "5rem" }}>len</th>
          </tr>
        </thead>
        <tbody>
          {packets.length === 0 && (
            <tr>
              <td colSpan={7} className="empty">
                no packets yet — start a capture to see traffic
              </td>
            </tr>
          )}
          {packets.map((p) => (
            <tr key={p.seq}>
              <td>{p.seq}</td>
              <td>{p.captured_at.replace("T", " ").slice(0, 23)}</td>
              <td>
                {[p.link_layer, p.network_layer, p.transport_layer, p.application_layer]
                  .filter(Boolean)
                  .join("/")}
              </td>
              <td>{p.src}</td>
              <td>{p.dst}</td>
              <td className="mono">{p.summary}</td>
              <td>{p.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
