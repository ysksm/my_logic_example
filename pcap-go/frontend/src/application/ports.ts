// Ports define what the application layer asks of the outside world.
// Concrete REST/WebSocket clients live in infrastructure/ and implement these.

import type {
  CaptureSession,
  NetworkInterface,
  Packet,
  Peer,
  StartCaptureRequest,
  StatsResponse,
} from "@domain/idl";

export interface CaptureGateway {
  listInterfaces(): Promise<NetworkInterface[]>;
  listSessions(): Promise<CaptureSession[]>;
  startCapture(req: StartCaptureRequest): Promise<CaptureSession>;
  stopCapture(id: string): Promise<CaptureSession>;
  listPeers(id: string, kind?: "ip" | "mac"): Promise<Peer[]>;
  stats(id: string, top?: number): Promise<StatsResponse>;
  lookupVendor(mac: string): Promise<string>;
}

export interface PacketStream {
  // Open a live stream of packets for sessionId. Returns an unsubscribe fn.
  subscribe(
    sessionId: string,
    onPacket: (p: Packet) => void,
    onSession?: (s: CaptureSession) => void,
    onError?: (msg: string) => void,
  ): () => void;
}
