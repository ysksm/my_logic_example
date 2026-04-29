import { useEffect, useState } from "react";
import { captureService } from "@infrastructure/container";
import type { Peer, StatsResponse } from "@domain/idl";

interface State {
  stats: StatsResponse | null;
  peers: Peer[];
  loading: boolean;
  error: string | null;
}

const EMPTY: State = { stats: null, peers: [], loading: false, error: null };

export function useStats(sessionId: string | undefined, intervalMs = 1500) {
  const [state, setState] = useState<State>(EMPTY);

  useEffect(() => {
    if (!sessionId) {
      setState(EMPTY);
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    const tick = async () => {
      try {
        const [stats, peers] = await Promise.all([
          captureService.stats(sessionId, 10),
          captureService.peers(sessionId),
        ]);
        if (!alive) return;
        setState({ stats, peers, loading: false, error: null });
      } catch (e) {
        if (!alive) return;
        setState((s) => ({ ...s, loading: false, error: String(e) }));
      }
    };

    tick();
    const id = window.setInterval(tick, intervalMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [sessionId, intervalMs]);

  return state;
}
