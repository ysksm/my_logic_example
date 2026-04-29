import type { Peer } from "@domain/idl";
import { formatBytes } from "@domain/types";

interface Props {
  peers: Peer[];
  loading: boolean;
}

export function PeerList({ peers, loading }: Props) {
  const ip = peers.filter((p) => p.kind === "ip");
  const mac = peers.filter((p) => p.kind === "mac");

  return (
    <div className="peer-list">
      <PeerSection title="IP peers" peers={ip} loading={loading} />
      <PeerSection title="MAC peers (with vendor)" peers={mac} loading={loading} />
    </div>
  );
}

function PeerSection({ title, peers, loading }: { title: string; peers: Peer[]; loading: boolean }) {
  return (
    <section className="peer-section">
      <h3>
        {title} <span className="count">{peers.length}</span>
      </h3>
      <div className="peer-table-wrap">
        <table className="peer-table">
          <thead>
            <tr>
              <th>address</th>
              <th>vendor</th>
              <th style={{ width: "6rem" }}>packets</th>
              <th style={{ width: "5rem" }}>sent</th>
              <th style={{ width: "5rem" }}>recv</th>
              <th style={{ width: "8rem" }}>bytes</th>
              <th style={{ width: "10rem" }}>last seen</th>
            </tr>
          </thead>
          <tbody>
            {loading && peers.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  loading…
                </td>
              </tr>
            )}
            {!loading && peers.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  none
                </td>
              </tr>
            )}
            {peers.map((p) => (
              <tr key={p.kind + p.address}>
                <td className="mono">{p.address}</td>
                <td>{p.vendor || <span className="muted">—</span>}</td>
                <td>{p.packets}</td>
                <td>{p.sent}</td>
                <td>{p.received}</td>
                <td>{formatBytes(p.bytes)}</td>
                <td>{p.last_seen.replace("T", " ").slice(0, 19)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
