import type { PacketStream } from "@application/ports";
import type { CaptureSession, Packet, StreamEnvelope } from "@domain/idl";

export class WsPacketStream implements PacketStream {
  subscribe(
    sessionId: string,
    onPacket: (p: Packet) => void,
    onSession?: (s: CaptureSession) => void,
    onError?: (msg: string) => void,
  ): () => void {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/api/v1/sessions/${encodeURIComponent(sessionId)}/stream`;
    const ws = new WebSocket(url);

    ws.addEventListener("message", (ev) => {
      try {
        const env = JSON.parse(ev.data as string) as StreamEnvelope;
        switch (env.type) {
          case "packet":
            onPacket(env.packet);
            break;
          case "session":
            onSession?.(env.session);
            break;
          case "error":
            onError?.(env.message);
            break;
        }
      } catch (e) {
        onError?.(String(e));
      }
    });

    ws.addEventListener("error", () => onError?.("websocket error"));

    return () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }
}
