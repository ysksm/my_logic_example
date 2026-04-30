// Use-cases for the capture feature. Pure logic — no React, no fetch.

import type { CaptureFormValues } from "@domain/types";
import type { CaptureGateway } from "./ports";

export class CaptureService {
  constructor(private readonly gw: CaptureGateway) {}

  listInterfaces() {
    return this.gw.listInterfaces();
  }

  listSessions() {
    return this.gw.listSessions();
  }

  start(values: CaptureFormValues) {
    if (!values.interface) {
      throw new Error("interface is required");
    }
    return this.gw.startCapture({
      interface: values.interface,
      bpf_filter: values.bpfFilter,
      snaplen: values.snaplen || 65535,
      promiscuous: values.promiscuous,
    });
  }

  stop(id: string) {
    return this.gw.stopCapture(id);
  }

  peers(id: string, kind?: "ip" | "mac") {
    return this.gw.listPeers(id, kind);
  }

  stats(id: string, top?: number) {
    return this.gw.stats(id, top);
  }

  vendor(mac: string) {
    return this.gw.lookupVendor(mac);
  }

  ipRangesStatus() {
    return this.gw.ipRangesStatus();
  }

  ipRangesUpdate() {
    return this.gw.ipRangesUpdate();
  }

  reverseDNS(ip: string) {
    return this.gw.reverseDNS(ip);
  }
}
