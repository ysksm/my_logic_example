// IDL types — kept in sync with idl/pcap.proto and core/models.go.
// This file MUST be a 1:1 mirror of the proto schema. Do not extend it with
// derived data; that belongs in domain/ types.

export interface NetworkInterface {
  name: string;
  description: string;
  addresses: string[];
  is_loopback: boolean;
  is_up: boolean;
}

export interface Packet {
  seq: number;
  captured_at: string;
  length: number;
  capture_length: number;
  interface: string;
  link_layer: string;
  network_layer: string;
  transport_layer: string;
  application_layer: string;
  src: string;
  dst: string;
  summary: string;
  payload?: string; // base64
}

export type SessionState = "running" | "stopped" | "error";

export interface CaptureSession {
  id: string;
  interface: string;
  bpf_filter: string;
  snaplen: number;
  promiscuous: boolean;
  state: SessionState;
  started_at: string;
  stopped_at?: string;
  packet_count: number;
  error?: string;
}

export interface ListInterfacesResponse {
  interfaces: NetworkInterface[];
}

export interface StartCaptureRequest {
  interface: string;
  bpf_filter: string;
  snaplen: number;
  promiscuous: boolean;
}

export interface StartCaptureResponse {
  session: CaptureSession;
}

export interface StopCaptureResponse {
  session: CaptureSession;
}

export interface ListSessionsResponse {
  sessions: CaptureSession[];
}

export interface ListPacketsResponse {
  packets: Packet[];
  next_seq: number;
}

export type StreamEnvelope =
  | { type: "packet"; packet: Packet }
  | { type: "session"; session: CaptureSession }
  | { type: "error"; message: string };
