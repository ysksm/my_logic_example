import { useCallback, useEffect, useState } from "react";
import { api } from "@/infrastructure/api/client";
import type { TableDump } from "@/domain/types";

export function useMaintenance() {
  const [enabled, setEnabled] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.maintenanceStatus();
      setEnabled(s.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshTables = useCallback(async () => {
    try {
      setTables(await api.maintenanceTables());
    } catch (e) {
      setTables([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (enabled) refreshTables();
    else setTables([]);
  }, [enabled, refreshTables]);

  const enable = useCallback(async (token?: string) => {
    setError(null);
    try {
      const r = await api.enableMaintenance(token);
      setEnabled(r.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const disable = useCallback(async () => {
    setError(null);
    try {
      const r = await api.disableMaintenance();
      setEnabled(r.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const dumpTable = useCallback(async (name: string, limit = 200): Promise<TableDump | null> => {
    setError(null);
    try {
      return await api.maintenanceDump(name, limit);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  const runQuery = useCallback(async (sql: string): Promise<TableDump | null> => {
    setError(null);
    try {
      return await api.maintenanceQuery(sql);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  return { enabled, tables, error, enable, disable, dumpTable, runQuery, refreshStatus, refreshTables };
}
