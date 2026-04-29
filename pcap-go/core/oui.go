package core

import (
	"strings"
)

// LookupVendor returns the vendor name for the given MAC address using the
// embedded OUI table. The table is a curated list of common prefixes; for
// fuller coverage, replace it with the IEEE OUI registry.
//
// Returns "" when the prefix is not known. Locally-administered or multicast
// MACs are reported as "Locally Administered" / "Multicast" / "Broadcast".
func LookupVendor(mac string) string {
	mac = strings.ToUpper(strings.TrimSpace(mac))
	if mac == "" {
		return ""
	}
	if mac == "FF:FF:FF:FF:FF:FF" {
		return "Broadcast"
	}
	// Strip separators (':' or '-') and require ≥6 hex chars.
	clean := strings.NewReplacer(":", "", "-", "", ".", "").Replace(mac)
	if len(clean) < 6 {
		return ""
	}
	prefix := clean[:6]

	if v, ok := ouiTable[prefix]; ok {
		return v
	}

	// Bit 0 of the first octet = multicast; bit 1 = locally administered.
	first, err := hexByte(clean[:2])
	if err == nil {
		switch {
		case first&0x01 == 0x01:
			return "Multicast"
		case first&0x02 == 0x02:
			return "Locally Administered"
		}
	}
	return ""
}

func hexByte(s string) (byte, error) {
	if len(s) != 2 {
		return 0, errInvalidHex
	}
	var b byte
	for i := 0; i < 2; i++ {
		c := s[i]
		var n byte
		switch {
		case c >= '0' && c <= '9':
			n = c - '0'
		case c >= 'A' && c <= 'F':
			n = c - 'A' + 10
		case c >= 'a' && c <= 'f':
			n = c - 'a' + 10
		default:
			return 0, errInvalidHex
		}
		b = b<<4 | n
	}
	return b, nil
}

type ouiError string

func (e ouiError) Error() string { return string(e) }

const errInvalidHex = ouiError("invalid hex")
