import type { CaptureGateway } from "@application/ports";
import type {
  CaptureSession,
  IPRangesStatus,
  IPRangesUpdateResponse,
  ListInterfacesResponse,
  ListPeersResponse,
  ListSessionsResponse,
  NetworkInterface,
  OUIResponse,
  Peer,
  ReverseDNSResponse,
  StartCaptureRequest,
  StartCaptureResponse,
  StatsResponse,
  StopCaptureResponse,
} from "@domain/idl";

export class HttpCaptureGateway implements CaptureGateway {
  constructor(private readonly baseUrl: string = "") {}

  async listInterfaces(): Promise<NetworkInterface[]> {
    const r = await fetch(`${this.baseUrl}/api/v1/interfaces`);
    await throwIfErr(r);
    const body = (await r.json()) as ListInterfacesResponse;
    return body.interfaces ?? [];
  }

  async listSessions(): Promise<CaptureSession[]> {
    const r = await fetch(`${this.baseUrl}/api/v1/sessions`);
    await throwIfErr(r);
    const body = (await r.json()) as ListSessionsResponse;
    return body.sessions ?? [];
  }

  async startCapture(req: StartCaptureRequest): Promise<CaptureSession> {
    const r = await fetch(`${this.baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    await throwIfErr(r);
    const body = (await r.json()) as StartCaptureResponse;
    return body.session;
  }

  async stopCapture(id: string): Promise<CaptureSession> {
    const r = await fetch(`${this.baseUrl}/api/v1/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await throwIfErr(r);
    const body = (await r.json()) as StopCaptureResponse;
    return body.session;
  }

  async listPeers(id: string, kind?: "ip" | "mac"): Promise<Peer[]> {
    const url = new URL(
      `${this.baseUrl || location.origin}/api/v1/sessions/${encodeURIComponent(id)}/peers`,
    );
    if (kind) url.searchParams.set("kind", kind);
    const r = await fetch(url.toString().replace(location.origin, this.baseUrl));
    await throwIfErr(r);
    const body = (await r.json()) as ListPeersResponse;
    return body.peers ?? [];
  }

  async stats(id: string, top?: number): Promise<StatsResponse> {
    const url = new URL(
      `${this.baseUrl || location.origin}/api/v1/sessions/${encodeURIComponent(id)}/stats`,
    );
    if (top) url.searchParams.set("top", String(top));
    const r = await fetch(url.toString().replace(location.origin, this.baseUrl));
    await throwIfErr(r);
    return (await r.json()) as StatsResponse;
  }

  async lookupVendor(mac: string): Promise<string> {
    const r = await fetch(`${this.baseUrl}/api/v1/oui/${encodeURIComponent(mac)}`);
    await throwIfErr(r);
    const body = (await r.json()) as OUIResponse;
    return body.vendor;
  }

  async ipRangesStatus(): Promise<IPRangesStatus> {
    const r = await fetch(`${this.baseUrl}/api/v1/ipranges/status`);
    await throwIfErr(r);
    return (await r.json()) as IPRangesStatus;
  }

  async ipRangesUpdate(): Promise<IPRangesUpdateResponse> {
    const r = await fetch(`${this.baseUrl}/api/v1/ipranges/update`, { method: "POST" });
    await throwIfErr(r);
    return (await r.json()) as IPRangesUpdateResponse;
  }

  async reverseDNS(ip: string): Promise<ReverseDNSResponse> {
    const r = await fetch(`${this.baseUrl}/api/v1/dns/reverse/${encodeURIComponent(ip)}`);
    await throwIfErr(r);
    return (await r.json()) as ReverseDNSResponse;
  }
}

async function throwIfErr(r: Response): Promise<void> {
  if (r.ok) return;
  let detail = "";
  try {
    const body = (await r.json()) as { error?: string };
    detail = body.error ?? "";
  } catch {
    detail = await r.text();
  }
  throw new Error(`${r.status} ${r.statusText}${detail ? `: ${detail}` : ""}`);
}
