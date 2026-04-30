// Infrastructure layer: thin HTTP client for the OpenAPI-defined backend.
// Higher layers depend on the methods exposed here, never on fetch directly.

import type {
  Ticket,
  TicketCreate,
  Tag,
  TimeEntry,
  TimeEntryCreate,
  CalendarItem,
  CalendarEvent,
  CalendarEventCreate,
  Repository,
  RepositoryCreate,
  BranchCreate,
  TableDump,
} from "@/domain/types";

const BASE = ""; // proxied via vite dev server in development

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return "";
  const u = new URLSearchParams();
  for (const [k, v] of entries) u.set(k, String(v));
  return "?" + u.toString();
}

export const api = {
  health: () => request<{ status: string; maintenance: boolean }>("GET", "/api/health"),

  // tickets
  listTickets: (params: { type?: string; status?: string; parent_id?: string; tag?: string } = {}) =>
    request<Ticket[]>("GET", "/api/tickets" + qs(params)),
  getTicket: (id: string) => request<Ticket>("GET", `/api/tickets/${id}`),
  createTicket: (t: TicketCreate) => request<Ticket>("POST", "/api/tickets", t),
  updateTicket: (id: string, t: Partial<TicketCreate>) =>
    request<Ticket>("PUT", `/api/tickets/${id}`, t),
  deleteTicket: (id: string) => request<void>("DELETE", `/api/tickets/${id}`),
  addTag: (id: string, tag: string) =>
    request<void>("POST", `/api/tickets/${id}/tags`, { tag }),
  removeTag: (id: string, tag: string) =>
    request<void>("DELETE", `/api/tickets/${id}/tags?tag=${encodeURIComponent(tag)}`),

  // tags
  listTags: () => request<Tag[]>("GET", "/api/tags"),

  // time entries
  listTimeEntries: (params: { ticket_id?: string; from?: string; to?: string } = {}) =>
    request<TimeEntry[]>("GET", "/api/time-entries" + qs(params)),
  createTimeEntry: (e: TimeEntryCreate) =>
    request<TimeEntry>("POST", "/api/time-entries", e),
  deleteTimeEntry: (id: string) => request<void>("DELETE", `/api/time-entries/${id}`),

  // calendar
  calendarRange: (from: string, to: string) =>
    request<CalendarItem[]>("GET", `/api/calendar${qs({ from, to })}`),
  listEvents: () => request<CalendarEvent[]>("GET", "/api/calendar/events"),
  createEvent: (e: CalendarEventCreate) =>
    request<CalendarEvent>("POST", "/api/calendar/events", e),
  deleteEvent: (id: string) => request<void>("DELETE", `/api/calendar/events/${id}`),

  // repositories
  listRepositories: () => request<Repository[]>("GET", "/api/repositories"),
  createRepository: (r: RepositoryCreate) =>
    request<Repository>("POST", "/api/repositories", r),
  deleteRepository: (id: string) => request<void>("DELETE", `/api/repositories/${id}`),
  listBranches: (id: string) => request<string[]>("GET", `/api/repositories/${id}/branches`),
  createBranch: (id: string, b: BranchCreate) =>
    request<{ branch: string }>("POST", `/api/repositories/${id}/branches`, b),

  // maintenance
  maintenanceStatus: () => request<{ enabled: boolean }>("GET", "/api/maintenance/status"),
  enableMaintenance: (token?: string) =>
    request<{ enabled: boolean }>("POST", "/api/maintenance/enable", { token: token ?? "" }),
  disableMaintenance: () =>
    request<{ enabled: boolean }>("POST", "/api/maintenance/disable"),
  maintenanceTables: () => request<string[]>("GET", "/api/maintenance/tables"),
  maintenanceDump: (name: string, limit = 200) =>
    request<TableDump>("GET", `/api/maintenance/tables/${encodeURIComponent(name)}${qs({ limit })}`),
  maintenanceQuery: (sql: string) =>
    request<TableDump>("POST", "/api/maintenance/query", { sql }),
};
