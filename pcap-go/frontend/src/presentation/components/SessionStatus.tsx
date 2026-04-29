import type { CaptureSession } from "@domain/idl";

interface Props {
  session: CaptureSession | null;
  error: string | null;
}

export function SessionStatus({ session, error }: Props) {
  if (error) {
    return (
      <div className="status status-error">
        <strong>error:</strong> {error}
      </div>
    );
  }
  if (!session) {
    return <div className="status status-idle">idle — no session</div>;
  }
  return (
    <div className={`status status-${session.state}`}>
      <span>
        <strong>session</strong> {session.id.slice(0, 12)}
      </span>
      <span>
        <strong>state</strong> {session.state}
      </span>
      <span>
        <strong>iface</strong> {session.interface}
      </span>
      {session.bpf_filter && (
        <span>
          <strong>filter</strong> {session.bpf_filter}
        </span>
      )}
      <span>
        <strong>packets</strong> {session.packet_count}
      </span>
    </div>
  );
}
