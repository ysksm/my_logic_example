// Domain types are richer than wire types: they include client-side helpers
// and invariants that must hold regardless of UI framework.

import type { CaptureSession, NetworkInterface, Packet, Peer } from "./idl";

export type { CaptureSession, NetworkInterface, Packet, Peer };

export interface CaptureFormValues {
  interface: string;
  bpfFilter: string;
  snaplen: number;
  promiscuous: boolean;
}

export const DEFAULT_FORM: CaptureFormValues = {
  interface: "",
  bpfFilter: "",
  snaplen: 65535,
  promiscuous: false,
};

export interface PacketFilter {
  text: string; // free-text substring match
  protocols: Set<string>; // empty = all
  address: string; // ip or mac substring
  port: string; // numeric src/dst port
}

export const EMPTY_FILTER: PacketFilter = {
  text: "",
  protocols: new Set(),
  address: "",
  port: "",
};

export const PROTOCOL_OPTIONS = ["TCP", "UDP", "ICMPv4", "DNS", "TLS", "HTTP"] as const;

export function applyFilter(packets: Packet[], f: PacketFilter): Packet[] {
  if (
    !f.text &&
    f.protocols.size === 0 &&
    !f.address &&
    !f.port
  ) {
    return packets;
  }
  const text = f.text.toLowerCase();
  const addr = f.address.toLowerCase();
  const port = f.port.trim();
  return packets.filter((p) => {
    if (f.protocols.size > 0) {
      const protos = [
        p.transport_layer,
        p.application_layer,
      ].filter(Boolean);
      const hit = protos.some((proto) => f.protocols.has(proto));
      if (!hit) return false;
    }
    if (text) {
      const haystack =
        `${p.src} ${p.dst} ${p.summary} ${p.layers.ethernet?.src_vendor ?? ""} ${p.layers.ethernet?.dst_vendor ?? ""} ${p.layers.http?.host ?? ""} ${p.layers.tls?.sni ?? ""} ${p.layers.dns?.questions?.join(" ") ?? ""}`.toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    if (addr) {
      const fields = [
        p.src,
        p.dst,
        p.layers.ethernet?.src_mac,
        p.layers.ethernet?.dst_mac,
        p.layers.ip?.src,
        p.layers.ip?.dst,
      ]
        .filter(Boolean)
        .map((s) => s!.toLowerCase());
      if (!fields.some((f) => f.includes(addr))) return false;
    }
    if (port) {
      const ports = [
        p.layers.tcp?.src_port,
        p.layers.tcp?.dst_port,
        p.layers.udp?.src_port,
        p.layers.udp?.dst_port,
      ].filter((n): n is number => typeof n === "number");
      if (!ports.map(String).includes(port)) return false;
    }
    return true;
  });
}

export function describePacket(p: Packet): string {
  const layers = [p.link_layer, p.network_layer, p.transport_layer, p.application_layer]
    .filter(Boolean)
    .join("/");
  return `${layers || "frame"}  ${p.src} → ${p.dst}  ${p.summary}`;
}

export function isCapturable(iface: NetworkInterface): boolean {
  return iface.is_up && !iface.is_loopback;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}
