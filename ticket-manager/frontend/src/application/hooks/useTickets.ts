// Application layer: orchestration hooks bridging UI and infrastructure.
// They keep React state, call the api client, and never touch fetch directly.

import { useCallback, useEffect, useState } from "react";
import { api } from "@/infrastructure/api/client";
import type { Ticket, TicketCreate, TicketStatus, TicketType } from "@/domain/types";

export interface UseTicketsParams {
  type?: TicketType;
  status?: TicketStatus;
  parent_id?: string;
  tag?: string;
}

export function useTickets(params: UseTicketsParams = {}) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTickets(await api.listTickets(params));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [params.type, params.status, params.parent_id, params.tag]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (t: TicketCreate) => {
    await api.createTicket(t);
    await refresh();
  }, [refresh]);

  const update = useCallback(async (id: string, t: Partial<TicketCreate>) => {
    await api.updateTicket(id, t);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await api.deleteTicket(id);
    await refresh();
  }, [refresh]);

  const addTag = useCallback(async (id: string, tag: string) => {
    await api.addTag(id, tag);
    await refresh();
  }, [refresh]);

  const removeTag = useCallback(async (id: string, tag: string) => {
    await api.removeTag(id, tag);
    await refresh();
  }, [refresh]);

  return { tickets, loading, error, refresh, create, update, remove, addTag, removeTag };
}
