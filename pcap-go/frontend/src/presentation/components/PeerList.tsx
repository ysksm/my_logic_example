import { useEffect, useState } from "react";
import type { IPRangesStatus, Peer } from "@domain/idl";
import { formatBytes } from "@domain/types";
import { captureService } from "@infrastructure/container";

interface Props {
  peers: Peer[];
  loading: boolean;
  onFilterByPeer?: (address: string) => void;
}

export function PeerList({ peers, loading, onFilterByPeer }: Props) {
  const ip = peers.filter((p) => p.kind === "ip");
  const mac = peers.filter((p) => p.kind === "mac");

  return (
    <div className="peer-list">
      <IPRangesPanel />
      <PeerSection
        title="IP peers"
        peers={ip}
        loading={loading}
        onFilterByPeer={onFilterByPeer}
        showOwner
        showReverseDNS
      />
      <PeerSection
        title="MAC peers (with vendor)"
        peers={mac}
        loading={loading}
        onFilterByPeer={onFilterByPeer}
      />
    </div>
  );
}

function IPRangesPanel() {
  const [status, setStatus] = useState<IPRangesStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const refresh = async () => {
    try {
      setStatus(await captureService.ipRangesStatus());
    } catch (e) {
      setMsg(`status fetch failed: ${e}`);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const update = async () => {
    setBusy(true);
    setMsg(null);
    setErrors([]);
    try {
      const r = await captureService.ipRangesUpdate();
      setStatus(r.status);
      setErrors(r.errors ?? []);
      setMsg(`updated: ${r.fetched_total} entries`);
    } catch (e) {
      setMsg(`update failed: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ipranges-panel">
      <div className="ipranges-row">
        <strong>IP ranges</strong>
        <span className="muted">
          {status
            ? `${status.total_entries} entries · ${status.providers.length} sources`
            : "loading…"}
        </span>
        <button type="button" onClick={update} disabled={busy} className="ipranges-update">
          {busy ? "updating…" : "Update from feeds"}
        </button>
        <span className="muted ipranges-msg">{msg}</span>
      </div>
      {status && (
        <div className="ipranges-providers">
          {status.providers.map((p) => (
            <span key={`${p.name}-${p.source}`} className={`provider provider-${p.source}`}>
              {p.name} <span className="muted">({p.entries}, {p.source})</span>
            </span>
          ))}
        </div>
      )}
      {errors.length > 0 && (
        <ul className="ipranges-errors">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {status?.user_file_present && (
        <div className="muted ipranges-file">
          user file: <span className="mono">{status.user_file_path}</span>
          {status.user_file_updated && <> · updated {status.user_file_updated}</>}
        </div>
      )}
    </section>
  );
}

function PeerSection({
  title,
  peers,
  loading,
  onFilterByPeer,
  showOwner = false,
  showReverseDNS = false,
}: {
  title: string;
  peers: Peer[];
  loading: boolean;
  onFilterByPeer?: (address: string) => void;
  showOwner?: boolean;
  showReverseDNS?: boolean;
}) {
  const cols = 7 + (showOwner ? 1 : 0) + (showReverseDNS ? 1 : 0) + (onFilterByPeer ? 1 : 0);

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
              {showOwner && <th>owner</th>}
              <th>vendor</th>
              <th style={{ width: "6rem" }}>packets</th>
              <th style={{ width: "5rem" }}>sent</th>
              <th style={{ width: "5rem" }}>recv</th>
              <th style={{ width: "8rem" }}>bytes</th>
              <th style={{ width: "10rem" }}>last seen</th>
              {showReverseDNS && <th style={{ width: "16rem" }}>reverse DNS</th>}
              {onFilterByPeer && <th style={{ width: "5rem" }}>filter</th>}
            </tr>
          </thead>
          <tbody>
            {loading && peers.length === 0 && (
              <tr>
                <td colSpan={cols} className="empty">
                  loading…
                </td>
              </tr>
            )}
            {!loading && peers.length === 0 && (
              <tr>
                <td colSpan={cols} className="empty">
                  none
                </td>
              </tr>
            )}
            {peers.map((p) => (
              <PeerRow
                key={p.kind + p.address}
                peer={p}
                onFilterByPeer={onFilterByPeer}
                showOwner={showOwner}
                showReverseDNS={showReverseDNS}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface RDNSState {
  loading: boolean;
  names?: string[];
  error?: string;
}

function PeerRow({
  peer,
  onFilterByPeer,
  showOwner,
  showReverseDNS,
}: {
  peer: Peer;
  onFilterByPeer?: (address: string) => void;
  showOwner: boolean;
  showReverseDNS: boolean;
}) {
  const [rdns, setRdns] = useState<RDNSState | null>(null);

  const lookup = async () => {
    setRdns({ loading: true });
    try {
      const r = await captureService.reverseDNS(peer.address);
      setRdns({ loading: false, names: r.names, error: r.error });
    } catch (e) {
      setRdns({ loading: false, error: String(e) });
    }
  };

  return (
    <tr>
      <td className="mono">{peer.address}</td>
      {showOwner && (
        <td>
          {peer.owner ? (
            <span className="owner-tag">{peer.owner}</span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      )}
      <td>{peer.vendor || <span className="muted">—</span>}</td>
      <td>{peer.packets}</td>
      <td>{peer.sent}</td>
      <td>{peer.received}</td>
      <td>{formatBytes(peer.bytes)}</td>
      <td>{peer.last_seen.replace("T", " ").slice(0, 19)}</td>
      {showReverseDNS && (
        <td>
          {rdns === null && (
            <button type="button" className="rdns-btn" onClick={lookup}>
              lookup
            </button>
          )}
          {rdns?.loading && <span className="muted">resolving…</span>}
          {rdns && !rdns.loading && rdns.names && rdns.names.length > 0 && (
            <span className="mono rdns-names">{rdns.names.join(", ")}</span>
          )}
          {rdns && !rdns.loading && (!rdns.names || rdns.names.length === 0) && (
            <span className="muted">{rdns.error || "no PTR"}</span>
          )}
        </td>
      )}
      {onFilterByPeer && (
        <td>
          <button
            type="button"
            className="peer-filter-btn"
            onClick={() => onFilterByPeer(peer.address)}
            title="show packets matching this peer"
          >
            filter →
          </button>
        </td>
      )}
    </tr>
  );
}
