import type { AppDoc, AppDocWire, DataModel, Domain, Field } from "./types";
import { fromWire } from "./types";

// All requests go through Vite's /api proxy to the Go server.
async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  listModels: () => http<DataModel[]>("/api/models"),
  saveModel: (m: DataModel) =>
    http<DataModel>("/api/models", { method: "POST", body: JSON.stringify(m) }),
  deleteModel: (name: string) =>
    http<void>(`/api/models/${encodeURIComponent(name)}`, { method: "DELETE" }),
  scaffold: async (name: string): Promise<AppDoc> => {
    const wire = await http<AppDocWire>(
      `/api/models/${encodeURIComponent(name)}/scaffold`,
      { method: "POST" },
    );
    return fromWire(wire);
  },

  listApps: async (): Promise<AppDoc[]> => {
    const wire = await http<AppDocWire[]>("/api/apps");
    return wire.map(fromWire);
  },
  getApp: async (id: string): Promise<AppDoc> =>
    fromWire(await http<AppDocWire>(`/api/apps/${encodeURIComponent(id)}`)),
  saveApp: async (a: AppDoc): Promise<AppDoc> => {
    const wire = {
      ...a,
      screens: JSON.stringify(a.screens),
      transitions: JSON.stringify(a.transitions),
      stateVariables: JSON.stringify(a.stateVariables ?? {}),
    };
    const out = await http<AppDocWire>("/api/apps", { method: "POST", body: JSON.stringify(wire) });
    return fromWire(out);
  },
  deleteApp: (id: string) =>
    http<void>(`/api/apps/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listRecords: <T = Record<string, unknown>>(model: string) =>
    http<{ id: string; values: T }[]>(`/api/records/${encodeURIComponent(model)}`),
  saveRecord: <T = Record<string, unknown>>(model: string, id: string, values: T) =>
    http<{ id: string; values: T }>(`/api/records/${encodeURIComponent(model)}`, {
      method: "POST",
      body: JSON.stringify({ id, values }),
    }),
  deleteRecord: (model: string, id: string) =>
    http<void>(
      `/api/records/${encodeURIComponent(model)}/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  listDomains: () => http<Domain[]>("/api/domains"),
  getDomain: (id: string) => http<Domain>(`/api/domains/${encodeURIComponent(id)}`),
  saveDomain: (d: Domain) =>
    http<Domain>("/api/domains", { method: "POST", body: JSON.stringify(d) }),
  deleteDomain: (id: string) =>
    http<void>(`/api/domains/${encodeURIComponent(id)}`, { method: "DELETE" }),
  scaffoldDomain: (id: string) =>
    http<DataModel[]>(`/api/domains/${encodeURIComponent(id)}/scaffold`, { method: "POST" }),
};

export function emptyModel(): DataModel {
  return { name: "", fields: [] };
}

export function emptyField(): Field {
  return { name: "", type: "string" };
}
