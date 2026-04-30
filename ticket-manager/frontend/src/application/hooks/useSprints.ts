import { useCallback, useEffect, useState } from "react";
import { api } from "@/infrastructure/api/client";
import type { Sprint, SprintCreate } from "@/domain/types";

export function useSprints() {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSprints(await api.listSprints());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = useCallback(async (s: SprintCreate) => {
    await api.createSprint(s);
    await refresh();
  }, [refresh]);

  const update = useCallback(async (id: string, s: Partial<Sprint>) => {
    await api.updateSprint(id, s);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await api.deleteSprint(id);
    await refresh();
  }, [refresh]);

  return { sprints, loading, error, refresh, create, update, remove };
}
