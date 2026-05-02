import type {
  AppSpec,
  DomainModel,
  Run,
  RulesConfig,
  Sample,
  SampleInfo,
} from "./types";

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
  generate: async (
    domain: DomainModel,
    config?: RulesConfig,
  ): Promise<{ blob: Blob; filename: string }> => {
    const r = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, config, format: "react" }),
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const blob = await r.blob();
    const root = r.headers.get("X-App-Root") ?? "ddd-app";
    return { blob, filename: `${root}.tar.gz` };
  },
  launch: (domain: DomainModel, config?: RulesConfig) =>
    fetch("/api/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, config }),
    }).then((r) => json<Run>(r)),
  getRun: (id: string) =>
    fetch(`/api/runs/${encodeURIComponent(id)}`).then((r) => json<Run>(r)),
  listRuns: () => fetch("/api/runs").then((r) => json<Run[]>(r)),
  stopRun: (id: string) =>
    fetch(`/api/runs/${encodeURIComponent(id)}/stop`, { method: "POST" }).then(
      (r) => json<Run>(r),
    ),
  listSamples: () => fetch("/api/samples").then((r) => json<SampleInfo[]>(r)),
  getSample: (id: string) =>
    fetch(`/api/samples/${encodeURIComponent(id)}`).then((r) => json<Sample>(r)),
  loadSample: (id: string) =>
    fetch(`/api/samples/${encodeURIComponent(id)}/load`, { method: "POST" }).then(
      (r) => json<DomainModel>(r),
    ),
};
