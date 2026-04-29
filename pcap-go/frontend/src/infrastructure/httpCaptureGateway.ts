import type { CaptureGateway } from "@application/ports";
import type {
  CaptureSession,
  ListInterfacesResponse,
  ListSessionsResponse,
  NetworkInterface,
  StartCaptureRequest,
  StartCaptureResponse,
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
