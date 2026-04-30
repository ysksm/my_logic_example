import { useCallback, useEffect, useState } from "react";
import { api } from "@/infrastructure/api/client";
import type { TimeEntry, TimeEntryCreate } from "@/domain/types";

export function useTimeEntries(filter: { ticket_id?: string; from?: string; to?: string } = {}) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await api.listTimeEntries(filter));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filter.ticket_id, filter.from, filter.to]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (e: TimeEntryCreate) => {
    await api.createTimeEntry(e);
    await refresh();
  }, [refresh]);

  const update = useCallback(async (id: string, e: Partial<TimeEntry>) => {
    await api.updateTimeEntry(id, e);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await api.deleteTimeEntry(id);
    await refresh();
  }, [refresh]);

  return { entries, loading, error, refresh, create, update, remove };
}
