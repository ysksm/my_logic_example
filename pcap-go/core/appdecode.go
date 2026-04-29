package core

import (
	"bufio"
	"bytes"
	"net/http"
	"strconv"
	"strings"
)

// decodeHTTP attempts to parse an HTTP request or response from a TCP payload.
// Returns nil when the payload is not recognizable HTTP.
func decodeHTTP(payload []byte) *HTTPLayer {
	if len(payload) < 16 {
		return nil
	}
	prefix := payload[:min(16, len(payload))]
	switch {
	case bytes.HasPrefix(prefix, []byte("GET ")),
		bytes.HasPrefix(prefix, []byte("POST ")),
		bytes.HasPrefix(prefix, []byte("PUT ")),
		bytes.HasPrefix(prefix, []byte("DELETE ")),
		bytes.HasPrefix(prefix, []byte("HEAD ")),
		bytes.HasPrefix(prefix, []byte("OPTIONS ")),
		bytes.HasPrefix(prefix, []byte("PATCH ")):
		req, err := http.ReadRequest(bufio.NewReader(bytes.NewReader(payload)))
		if err != nil {
			return nil
		}
		return &HTTPLayer{
			Method:    req.Method,
			Path:      req.URL.RequestURI(),
			Host:      req.Host,
			UserAgent: req.UserAgent(),
		}
	case bytes.HasPrefix(prefix, []byte("HTTP/1.")):
		resp, err := http.ReadResponse(bufio.NewReader(bytes.NewReader(payload)), nil)
		if err != nil {
			return nil
		}
		_ = resp.Body.Close()
		return &HTTPLayer{
			StatusCode:  uint32(resp.StatusCode),
			ContentType: resp.Header.Get("Content-Type"),
		}
	}
	return nil
}

// decodeTLSHandshake performs a tiny best-effort TLS record/handshake decode
// to extract version + handshake type + SNI. Returns nil when the payload is
// not a recognisable TLS record.
func decodeTLSHandshake(payload []byte) *TLSLayer {
	if len(payload) < 5 {
		return nil
	}
	contentType := payload[0]
	if contentType != 0x14 && contentType != 0x15 && contentType != 0x16 && contentType != 0x17 {
		return nil
	}
	major, minor := payload[1], payload[2]
	if major != 0x03 {
		return nil
	}
	t := &TLSLayer{Version: tlsVersion(major, minor)}
	recLen := int(payload[3])<<8 | int(payload[4])
	end := 5 + recLen
	if end > len(payload) {
		end = len(payload)
	}
	body := payload[5:end]

	if contentType != 0x16 || len(body) < 4 {
		return t
	}
	hsType := body[0]
	t.Handshake = handshakeType(hsType)

	if hsType == 0x01 && len(body) >= 38 { // ClientHello
		// Skip 2 (version) + 32 (random) + session_id_len + session_id
		i := 4 + 2 + 32
		if i >= len(body) {
			return t
		}
		sidLen := int(body[i])
		i++
		i += sidLen
		if i+2 > len(body) {
			return t
		}
		csLen := int(body[i])<<8 | int(body[i+1])
		i += 2 + csLen
		if i >= len(body) {
			return t
		}
		compLen := int(body[i])
		i += 1 + compLen
		if i+2 > len(body) {
			return t
		}
		extLen := int(body[i])<<8 | int(body[i+1])
		i += 2
		extEnd := i + extLen
		for i+4 <= extEnd && i+4 <= len(body) {
			extType := int(body[i])<<8 | int(body[i+1])
			extDataLen := int(body[i+2])<<8 | int(body[i+3])
			i += 4
			if extType == 0x00 && i+5 <= len(body) { // server_name
				// list_length(2) + name_type(1) + name_length(2) + name
				nameLen := int(body[i+3])<<8 | int(body[i+4])
				if i+5+nameLen <= len(body) {
					t.SNI = string(body[i+5 : i+5+nameLen])
				}
				return t
			}
			i += extDataLen
		}
	}
	return t
}

func tlsVersion(_, minor byte) string {
	switch minor {
	case 0x01:
		return "TLS 1.0"
	case 0x02:
		return "TLS 1.1"
	case 0x03:
		return "TLS 1.2"
	case 0x04:
		return "TLS 1.3"
	}
	return "TLS"
}

func handshakeType(t byte) string {
	switch t {
	case 0x01:
		return "ClientHello"
	case 0x02:
		return "ServerHello"
	case 0x0b:
		return "Certificate"
	case 0x0d:
		return "CertificateRequest"
	case 0x10:
		return "ClientKeyExchange"
	case 0x14:
		return "Finished"
	}
	return "Type" + strconv.Itoa(int(t))
}

// FormatBytes is a tiny helper used by the UI/CLI; lives here for symmetry
// with decoders since both deal in payload bytes.
func FormatBytes(n uint64) string {
	switch {
	case n < 1024:
		return strconv.FormatUint(n, 10) + " B"
	case n < 1024*1024:
		return strings.TrimRight(strings.TrimRight(strconv.FormatFloat(float64(n)/1024, 'f', 1, 64), "0"), ".") + " KiB"
	default:
		return strings.TrimRight(strings.TrimRight(strconv.FormatFloat(float64(n)/1024/1024, 'f', 2, 64), "0"), ".") + " MiB"
	}
}
