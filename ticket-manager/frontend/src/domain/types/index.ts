// Domain layer: business entity types mirroring the OpenAPI IDL.
// This file is hand-aligned with idl/openapi.yaml.

export type TicketType = "EPIC" | "STORY" | "TASK" | "SUBTASK";
export type TicketStatus = "TODO" | "IN_PROGRESS" | "DONE";

export const TICKET_TYPES: TicketType[] = ["EPIC", "STORY", "TASK", "SUBTASK"];
export const TICKET_STATUSES: TicketStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

export interface Ticket {
  id: string;
  parent_id: string | null;
  title: string;
  description: string;
  type: TicketType;
  status: TicketStatus;
  assignee: string | null;
  estimate_hours: number | null;
  due_date: string | null;
  repository_id: string | null;
  branch: string | null;
  sprint_id: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface TicketCreate {
  parent_id?: string | null;
  title: string;
  description?: string;
  type: TicketType;
  status?: TicketStatus;
  assignee?: string | null;
  estimate_hours?: number | null;
  due_date?: string | null;
  repository_id?: string | null;
  branch?: string | null;
  sprint_id?: string | null;
  tags?: string[];
}

export type SprintState = "PLANNED" | "ACTIVE" | "CLOSED";
export const SPRINT_STATES: SprintState[] = ["PLANNED", "ACTIVE", "CLOSED"];

export interface Sprint {
  id: string;
  name: string;
  goal: string;
  state: SprintState;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

export interface SprintCreate {
  name: string;
  goal?: string;
  state?: SprintState;
  start_date?: string | null;
  end_date?: string | null;
}

export interface Tag {
  name: string;
  usage_count: number;
}

export interface TimeEntry {
  id: string;
  ticket_id: string | null;
  ticket_title?: string;
  user: string;
  hours: number;
  work_date: string;
  start_at?: string | null;
  end_at?: string | null;
  note: string;
  created_at: string;
}

export interface TimeEntryCreate {
  ticket_id?: string | null;
  user?: string;
  hours: number;
  work_date: string;
  start_at?: string | null;
  end_at?: string | null;
  note?: string;
}

export interface CalendarItem {
  kind: "TICKET_DUE" | "TIME_ENTRY" | "EVENT";
  date: string;
  title: string;
  ticket_id?: string | null;
  hours?: number | null;
  status?: TicketStatus;
  event_id?: string | null;
  entry_id?: string | null;
  start_at?: string | null;
  end_at?: string | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  start_date: string;
  end_date: string | null;
  start_at?: string | null;
  end_at?: string | null;
  ticket_id?: string | null;
  ticket_title?: string | null;
}

export interface CalendarEventCreate {
  title: string;
  description?: string;
  start_date: string;
  end_date?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  ticket_id?: string | null;
}

export interface Repository {
  id: string;
  name: string;
  path: string;
  default_branch: string;
  created_at: string;
}

export interface RepositoryCreate {
  name: string;
  path: string;
  default_branch?: string;
}

export interface BranchCreate {
  branch: string;
  from?: string;
  checkout?: boolean;
}

export interface TableDump {
  columns: string[];
  rows: unknown[][];
  row_count: number;
}
