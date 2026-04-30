import { useCallback, useEffect, useState } from "react";
import { api } from "@/infrastructure/api/client";
import type { CalendarItem, CalendarEvent, CalendarEventCreate } from "@/domain/types";

export function useCalendarRange(from: string, to: string) {
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.calendarRange(from, to));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, loading, error, refresh };
}

export function useEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEvents(await api.listEvents());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (e: CalendarEventCreate) => {
    await api.createEvent(e);
    await refresh();
  }, [refresh]);

  const update = useCallback(async (id: string, e: Partial<CalendarEvent>) => {
    await api.updateEvent(id, e);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await api.deleteEvent(id);
    await refresh();
  }, [refresh]);

  return { events, loading, error, refresh, create, update, remove };
}
