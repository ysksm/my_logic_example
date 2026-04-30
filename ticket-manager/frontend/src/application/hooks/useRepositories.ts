import { useCallback, useEffect, useState } from "react";
import { api } from "@/infrastructure/api/client";
import type { Repository, RepositoryCreate, BranchCreate } from "@/domain/types";

export function useRepositories() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRepos(await api.listRepositories());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (r: RepositoryCreate) => {
    await api.createRepository(r);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await api.deleteRepository(id);
    await refresh();
  }, [refresh]);

  return { repos, loading, error, refresh, create, remove };
}

export function useBranches(repoId: string | null) {
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!repoId) {
      setBranches([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setBranches(await api.listBranches(repoId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createBranch = useCallback(
    async (b: BranchCreate) => {
      if (!repoId) return;
      await api.createBranch(repoId, b);
      await refresh();
    },
    [repoId, refresh],
  );

  return { branches, loading, error, refresh, createBranch };
}
