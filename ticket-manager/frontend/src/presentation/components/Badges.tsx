import type { TicketStatus, TicketType } from "@/domain/types";

export function StatusBadge({ value }: { value: TicketStatus }) {
  const cls = value === "TODO" ? "todo" : value === "IN_PROGRESS" ? "inprog" : "done";
  const label = value === "IN_PROGRESS" ? "進行中" : value === "TODO" ? "TODO" : "DONE";
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function TypeBadge({ value }: { value: TicketType }) {
  const cls = value.toLowerCase();
  return <span className={`badge ${cls}`}>{value}</span>;
}
