import { CaptureForm } from "../components/CaptureForm";
import { PacketTable } from "../components/PacketTable";
import { SessionStatus } from "../components/SessionStatus";
import { useInterfaces } from "../hooks/useInterfaces";
import { useLiveCapture } from "../hooks/useLiveCapture";

export function CapturePage() {
  const { interfaces, error: ifacesError, loading } = useInterfaces();
  const live = useLiveCapture();

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
      <PacketTable packets={live.packets} />
    </section>
  );
}
