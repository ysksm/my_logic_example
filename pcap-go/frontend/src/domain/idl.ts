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

export interface EthernetLayer {
  src_mac: string;
  dst_mac: string;
  src_vendor?: string;
  dst_vendor?: string;
  ether_type?: string;
}

export interface IPLayer {
  version: number; // 4 or 6
  src: string;
  dst: string;
  ttl?: number;
  protocol?: number;
  protocol_name?: string;
  length?: number;
  flags?: string;
}

export interface TCPLayer {
  src_port: number;
  dst_port: number;
  seq?: number;
  ack?: number;
  window?: number;
  flags?: string;
  length?: number;
}

export interface UDPLayer {
  src_port: number;
  dst_port: number;
  length?: number;
}

export interface ICMPLayer {
  type: string;
  code?: number;
}

export interface DNSLayer {
  opcode?: string;
  response: boolean;
  rcode?: string;
  questions?: string[];
  answers?: string[];
}

export interface HTTPLayer {
  method?: string;
  path?: string;
  host?: string;
  status_code?: number;
  user_agent?: string;
  content_type?: string;
}

export interface TLSLayer {
  version?: string;
  handshake?: string;
  sni?: string;
}

export interface Layers {
  ethernet?: EthernetLayer;
  ip?: IPLayer;
  tcp?: TCPLayer;
  udp?: UDPLayer;
  icmp?: ICMPLayer;
  dns?: DNSLayer;
  http?: HTTPLayer;
  tls?: TLSLayer;
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
  payload?: string;
  layers: Layers;
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

export type PeerKind = "ip" | "mac";

export interface Peer {
  kind: PeerKind;
  address: string;
  vendor?: string;
  packets: number;
  bytes: number;
  sent: number;
  received: number;
  first_seen: string;
  last_seen: string;
}

export interface ListPeersResponse {
  peers: Peer[];
}

export interface ProtocolStat {
  name: string;
  count: number;
  bytes: number;
}

export interface RateBucket {
  ts: string;
  count: number;
  bytes: number;
}

export interface StatsResponse {
  total_packets: number;
  total_bytes: number;
  transport: ProtocolStat[];
  application: ProtocolStat[];
  top_peers: Peer[];
  rate: RateBucket[];
}

export interface OUIResponse {
  mac: string;
  vendor: string;
}

export type StreamEnvelope =
  | { type: "packet"; packet: Packet }
  | { type: "session"; session: CaptureSession }
  | { type: "error"; message: string };
