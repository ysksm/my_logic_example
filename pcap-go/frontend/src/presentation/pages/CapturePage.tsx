import { useMemo, useState } from "react";
import { CaptureForm } from "../components/CaptureForm";
import { FilterBar } from "../components/FilterBar";
import { PacketTable } from "../components/PacketTable";
import { PacketDetail } from "../components/PacketDetail";
import { PeerList } from "../components/PeerList";
import { ProtocolBars, TopPeersBars, RateChart } from "../components/Charts";
import { SessionStatus } from "../components/SessionStatus";
import { useInterfaces } from "../hooks/useInterfaces";
import { useLiveCapture } from "../hooks/useLiveCapture";
import { useStats } from "../hooks/useStats";
import { applyFilter, EMPTY_FILTER, type PacketFilter } from "@domain/types";

type Tab = "packets" | "peers" | "viz";

export function CapturePage() {
  const { interfaces, error: ifacesError, loading } = useInterfaces();
  const live = useLiveCapture();
  const stats = useStats(live.session?.id, 1500);

  const [tab, setTab] = useState<Tab>("packets");
  const [filter, setFilter] = useState<PacketFilter>(EMPTY_FILTER);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);

  const filtered = useMemo(() => applyFilter(live.packets, filter), [live.packets, filter]);
  const selected = useMemo(
    () => filtered.find((p) => p.seq === selectedSeq) ?? null,
    [filtered, selectedSeq],
  );

  const running = live.session?.state === "running";

  return (
    <section className="capture-page">
      {loading ? (
        <p>loading interfaces…</p>
      ) : ifacesError ? (
        <p className="status status-error">interfaces: {ifacesError}</p>
      ) : (
        <CaptureForm
          interfaces={interfaces}
          busy={live.busy}
          running={running}
          onStart={live.start}
          onStop={live.stop}
        />
      )}

      <SessionStatus session={live.session} error={live.error} />

      <nav className="tabs">
        <button className={tab === "packets" ? "on" : ""} onClick={() => setTab("packets")}>
          Packets
        </button>
        <button className={tab === "peers" ? "on" : ""} onClick={() => setTab("peers")}>
          Peers
        </button>
        <button className={tab === "viz" ? "on" : ""} onClick={() => setTab("viz")}>
          Visualization
        </button>
      </nav>

      {tab === "packets" && (
        <>
          <FilterBar
            value={filter}
            onChange={setFilter}
            visible={filtered.length}
            total={live.packets.length}
          />
          <div className="packets-split">
            <PacketTable
              packets={filtered}
              selectedSeq={selectedSeq}
              onSelect={setSelectedSeq}
            />
            <aside className="detail-pane">
              {selected ? (
                <PacketDetail packet={selected} />
              ) : (
                <p className="muted">select a packet to view per-layer detail</p>
              )}
            </aside>
          </div>
        </>
      )}

      {tab === "peers" && <PeerList peers={stats.peers} loading={stats.loading} />}

      {tab === "viz" && (
        <div className="viz-grid">
          <ProtocolBars title="Transport layer" stats={stats.stats?.transport ?? []} />
          <ProtocolBars title="Application layer" stats={stats.stats?.application ?? []} />
          <TopPeersBars peers={stats.stats?.top_peers ?? []} />
          <RateChart buckets={stats.stats?.rate ?? []} />
        </div>
      )}
    </section>
  );
}
