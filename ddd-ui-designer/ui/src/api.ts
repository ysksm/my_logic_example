import type { AppSpec, DomainModel, RulesConfig } from "./types";

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${await r.text()}`);
  return (await r.json()) as T;
}

export const api = {
  health: () => fetch("/api/health").then((r) => json<{ status: string }>(r)),
  rules: () =>
    fetch("/api/rules").then((r) =>
      json<{
        config: RulesConfig;
        patterns: { id: string; label: string; when: string }[];
      }>(r),
    ),
  listDomains: () => fetch("/api/domains").then((r) => json<DomainModel[]>(r)),
  getDomain: (id: string) =>
    fetch(`/api/domains/${id}`).then((r) => json<DomainModel>(r)),
  saveDomain: (d: DomainModel) =>
    fetch("/api/domains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    }).then((r) => json<DomainModel>(r)),
  deleteDomain: (id: string) =>
    fetch(`/api/domains/${id}`, { method: "DELETE" }),
  derive: (domain: DomainModel, config?: RulesConfig) =>
    fetch("/api/derive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, config }),
    }).then((r) => json<AppSpec>(r)),
};
