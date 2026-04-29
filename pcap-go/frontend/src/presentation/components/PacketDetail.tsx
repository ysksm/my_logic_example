import type { Packet } from "@domain/idl";

interface Props {
  packet: Packet;
}

// Wireshark-style stacked detail. Each layer is its own collapsible section.
export function PacketDetail({ packet }: Props) {
  const L = packet.layers;
  return (
    <div className="packet-detail">
      <Section title={`Frame #${packet.seq}`}>
        <Row k="captured at" v={packet.captured_at} />
        <Row k="interface" v={packet.interface} />
        <Row k="length" v={`${packet.length} (cap ${packet.capture_length})`} />
        <Row k="layers" v={[packet.link_layer, packet.network_layer, packet.transport_layer, packet.application_layer].filter(Boolean).join(" / ")} />
      </Section>

      {L.ethernet && (
        <Section title="Ethernet">
          <Row k="src mac" v={L.ethernet.src_mac} suffix={L.ethernet.src_vendor} />
          <Row k="dst mac" v={L.ethernet.dst_mac} suffix={L.ethernet.dst_vendor} />
          {L.ethernet.ether_type && <Row k="ether type" v={L.ethernet.ether_type} />}
        </Section>
      )}

      {L.ip && (
        <Section title={`IP v${L.ip.version}`}>
          <Row k="src" v={L.ip.src} />
          <Row k="dst" v={L.ip.dst} />
          {L.ip.ttl !== undefined && <Row k={L.ip.version === 6 ? "hop limit" : "ttl"} v={String(L.ip.ttl)} />}
          {L.ip.protocol_name && <Row k="next proto" v={`${L.ip.protocol_name} (${L.ip.protocol})`} />}
          {L.ip.length !== undefined && <Row k="length" v={String(L.ip.length)} />}
          {L.ip.flags && <Row k="flags" v={L.ip.flags} />}
        </Section>
      )}

      {L.tcp && (
        <Section title="TCP">
          <Row k="src port" v={String(L.tcp.src_port)} />
          <Row k="dst port" v={String(L.tcp.dst_port)} />
          {L.tcp.flags && <Row k="flags" v={L.tcp.flags} />}
          {L.tcp.seq !== undefined && <Row k="seq" v={String(L.tcp.seq)} />}
          {L.tcp.ack !== undefined && <Row k="ack" v={String(L.tcp.ack)} />}
          {L.tcp.window !== undefined && <Row k="window" v={String(L.tcp.window)} />}
          {L.tcp.length !== undefined && <Row k="payload" v={`${L.tcp.length} B`} />}
        </Section>
      )}

      {L.udp && (
        <Section title="UDP">
          <Row k="src port" v={String(L.udp.src_port)} />
          <Row k="dst port" v={String(L.udp.dst_port)} />
          {L.udp.length !== undefined && <Row k="length" v={String(L.udp.length)} />}
        </Section>
      )}

      {L.icmp && (
        <Section title="ICMP">
          <Row k="type" v={L.icmp.type} />
          {L.icmp.code !== undefined && <Row k="code" v={String(L.icmp.code)} />}
        </Section>
      )}

      {L.dns && (
        <Section title="DNS">
          <Row k="opcode" v={L.dns.opcode ?? ""} />
          <Row k="response" v={L.dns.response ? "true" : "false"} />
          {L.dns.rcode && <Row k="rcode" v={L.dns.rcode} />}
          {L.dns.questions?.map((q, i) => <Row key={`q${i}`} k={`q[${i}]`} v={q} />)}
          {L.dns.answers?.map((a, i) => <Row key={`a${i}`} k={`a[${i}]`} v={a} />)}
        </Section>
      )}

      {L.http && (
        <Section title="HTTP">
          {L.http.method && <Row k="method" v={L.http.method} />}
          {L.http.path && <Row k="path" v={L.http.path} />}
          {L.http.host && <Row k="host" v={L.http.host} />}
          {L.http.status_code !== undefined && L.http.status_code > 0 && (
            <Row k="status" v={String(L.http.status_code)} />
          )}
          {L.http.user_agent && <Row k="user-agent" v={L.http.user_agent} />}
          {L.http.content_type && <Row k="content-type" v={L.http.content_type} />}
        </Section>
      )}

      {L.tls && (
        <Section title="TLS">
          {L.tls.version && <Row k="version" v={L.tls.version} />}
          {L.tls.handshake && <Row k="handshake" v={L.tls.handshake} />}
          {L.tls.sni && <Row k="sni" v={L.tls.sni} />}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="detail-section" open>
      <summary>{title}</summary>
      <dl>{children}</dl>
    </details>
  );
}

function Row({ k, v, suffix }: { k: string; v: string; suffix?: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>
        <span className="mono">{v}</span>
        {suffix ? <span className="suffix"> ({suffix})</span> : null}
      </dd>
    </>
  );
}
