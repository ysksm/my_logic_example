import { useEffect, useRef, useState } from "react";
import { captureService, packetStream } from "@infrastructure/container";
import type { CaptureFormValues } from "@domain/types";
import type { CaptureSession, Packet } from "@domain/idl";

const MAX_PACKETS = 500;

interface State {
  session: CaptureSession | null;
  packets: Packet[];
  error: string | null;
  busy: boolean;
}

export function useLiveCapture() {
  const [state, setState] = useState<State>({
    session: null,
    packets: [],
    error: null,
    busy: false,
  });
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => unsubscribeRef.current?.();
  }, []);

  const start = async (values: CaptureFormValues) => {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const session = await captureService.start(values);
      const unsub = packetStream.subscribe(
        session.id,
        (p) =>
          setState((s) => ({
            ...s,
            packets: [p, ...s.packets].slice(0, MAX_PACKETS),
          })),
        (sess) => setState((s) => ({ ...s, session: sess })),
        (msg) => setState((s) => ({ ...s, error: msg })),
      );
      unsubscribeRef.current?.();
      unsubscribeRef.current = unsub;
      setState({ session, packets: [], error: null, busy: false });
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: String(e) }));
    }
  };

  const stop = async () => {
    if (!state.session) return;
    setState((s) => ({ ...s, busy: true }));
    try {
      const session = await captureService.stop(state.session.id);
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      setState((s) => ({ ...s, session, busy: false }));
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: String(e) }));
    }
  };

  return { ...state, start, stop };
}
