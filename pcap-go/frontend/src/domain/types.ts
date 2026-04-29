// Domain types are richer than wire types: they include client-side helpers
// and invariants that must hold regardless of UI framework.

import type { CaptureSession, NetworkInterface, Packet } from "./idl";

export type { CaptureSession, NetworkInterface, Packet };

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

export function describePacket(p: Packet): string {
  const layers = [p.link_layer, p.network_layer, p.transport_layer, p.application_layer]
    .filter(Boolean)
    .join("/");
  return `${layers || "frame"}  ${p.src} → ${p.dst}  ${p.summary}`;
}

export function isCapturable(iface: NetworkInterface): boolean {
  return iface.is_up && !iface.is_loopback;
}
