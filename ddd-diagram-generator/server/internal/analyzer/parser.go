package analyzer

import (
	"regexp"
	"strings"
)

// sanitize replaces string literals, template strings, and both block and
// line comments with spaces so that the downstream regular expressions can
// safely skim the source without tripping over embedded braces or type-like
// tokens inside text. Newlines are preserved so line numbers still line up
// with the original input.
func sanitize(src string) string {
	out := make([]byte, len(src))
	i := 0
	n := len(src)
	for i < n {
		c := src[i]
		if c == '/' && i+1 < n && src[i+1] == '/' {
			for i < n && src[i] != '\n' {
				out[i] = ' '
				i++
			}
			continue
		}
		if c == '/' && i+1 < n && src[i+1] == '*' {
			out[i] = ' '
			out[i+1] = ' '
			i += 2
			for i < n {
				if src[i] == '*' && i+1 < n && src[i+1] == '/' {
					out[i] = ' '
					out[i+1] = ' '
					i += 2
					break
				}
				if src[i] == '\n' {
					out[i] = '\n'
				} else {
					out[i] = ' '
				}
				i++
			}
			continue
		}
		if c == '"' || c == '\'' || c == '`' {
			quote := c
			out[i] = ' '
			i++
			for i < n {
				if src[i] == '\\' && i+1 < n {
					out[i] = ' '
					out[i+1] = ' '
					i += 2
					continue
				}
				if src[i] == quote {
					out[i] = ' '
					i++
					break
				}
				if src[i] == '\n' {
					out[i] = '\n'
				} else {
					out[i] = ' '
				}
				i++
			}
			continue
		}
		out[i] = c
		i++
	}
	return string(out)
}

// findMatchingBrace returns the index (within src) of the `}` that matches the
// `{` at position openIdx. Returns -1 if unbalanced.
func findMatchingBrace(src string, openIdx int) int {
	depth := 0
	for i := openIdx; i < len(src); i++ {
		switch src[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

func lineOfIndex(src string, idx int) int {
	if idx < 0 {
		return 0
	}
	if idx > len(src) {
		idx = len(src)
	}
	return strings.Count(src[:idx], "\n") + 1
}

var (
	reClass     = regexp.MustCompile(`(?m)(^|[\s;}])(export\s+)?(abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)(\s*<[^{]*>)?\s*(extends\s+([A-Za-z_$][A-Za-z0-9_$.]*(?:\s*<[^{]*>)?))?\s*(implements\s+([^{]+))?\s*\{`)
	reInterface = regexp.MustCompile(`(?m)(^|[\s;}])(export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)(\s*<[^{]*>)?\s*(extends\s+([^{]+))?\s*\{`)
	reEnum      = regexp.MustCompile(`(?m)(^|[\s;}])(export\s+)?(const\s+)?enum\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\{`)
	reTypeAlias = regexp.MustCompile(`(?m)(^|[\s;}])(export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)(\s*<[^=]*>)?\s*=\s*([^;]+);`)
	reIdent     = regexp.MustCompile(`[A-Za-z_$][A-Za-z0-9_$]*`)

	reField = regexp.MustCompile(
		`^((?:(?:public|private|protected|readonly|static|declare|abstract|override)\s+)*)` +
			`([A-Za-z_$][A-Za-z0-9_$]*)\s*(\??)\s*:\s*(.+?)(?:\s*=\s*.+)?$`)
	reMethod = regexp.MustCompile(
		`^(?:(?:public|private|protected|static|readonly|abstract|override|async)\s+)*` +
			`([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*(.+?))?$`)
)

func parseFile(file string, src string) []Node {
	clean := sanitize(src)
	var nodes []Node
	nodes = append(nodes, parseClasses(file, src, clean)...)
	nodes = append(nodes, parseInterfaces(file, src, clean)...)
	nodes = append(nodes, parseEnums(file, src, clean)...)
	nodes = append(nodes, parseTypeAliases(file, src, clean)...)
	return nodes
}

func parseClasses(file, src, clean string) []Node {
	var nodes []Node
	matches := reClass.FindAllStringSubmatchIndex(clean, -1)
	for _, m := range matches {
		name := clean[m[8]:m[9]]
		openIdx := m[1] - 1
		for openIdx > 0 && clean[openIdx] != '{' {
			openIdx--
		}
		closeIdx := findMatchingBrace(clean, openIdx)
		if closeIdx < 0 {
			continue
		}
		body := clean[openIdx+1 : closeIdx]
		var extends []string
		if m[14] != -1 {
			extends = append(extends, cleanTypeName(clean[m[14]:m[15]]))
		}
		var implements []string
		if m[18] != -1 {
			implements = splitTypeList(clean[m[18]:m[19]])
		}
		fields, methods := parseMembers(body)
		nodes = append(nodes, Node{
			ID:         nodeID(file, name),
			Name:       name,
			Kind:       KindClass,
			File:       file,
			Line:       lineOfIndex(src, m[0]),
			Extends:    extends,
			Implements: implements,
			Fields:     fields,
			Methods:    methods,
			Exported:   m[4] != -1,
		})
	}
	return nodes
}

func parseInterfaces(file, src, clean string) []Node {
	var nodes []Node
	matches := reInterface.FindAllStringSubmatchIndex(clean, -1)
	for _, m := range matches {
		name := clean[m[6]:m[7]]
		openIdx := m[1] - 1
		for openIdx > 0 && clean[openIdx] != '{' {
			openIdx--
		}
		closeIdx := findMatchingBrace(clean, openIdx)
		if closeIdx < 0 {
			continue
		}
		body := clean[openIdx+1 : closeIdx]
		var extends []string
		if m[12] != -1 {
			extends = splitTypeList(clean[m[12]:m[13]])
		}
		fields, methods := parseMembers(body)
		nodes = append(nodes, Node{
			ID:       nodeID(file, name),
			Name:     name,
			Kind:     KindInterface,
			File:     file,
			Line:     lineOfIndex(src, m[0]),
			Extends:  extends,
			Fields:   fields,
			Methods:  methods,
			Exported: m[4] != -1,
		})
	}
	return nodes
}

func parseEnums(file, src, clean string) []Node {
	var nodes []Node
	matches := reEnum.FindAllStringSubmatchIndex(clean, -1)
	for _, m := range matches {
		name := clean[m[8]:m[9]]
		openIdx := m[1] - 1
		for openIdx > 0 && clean[openIdx] != '{' {
			openIdx--
		}
		closeIdx := findMatchingBrace(clean, openIdx)
		if closeIdx < 0 {
			continue
		}
		body := clean[openIdx+1 : closeIdx]
		var values []string
		for _, part := range strings.Split(body, ",") {
			p := strings.TrimSpace(part)
			if p == "" {
				continue
			}
			if eq := strings.Index(p, "="); eq >= 0 {
				p = strings.TrimSpace(p[:eq])
			}
			values = append(values, p)
		}
		nodes = append(nodes, Node{
			ID:         nodeID(file, name),
			Name:       name,
			Kind:       KindEnum,
			File:       file,
			Line:       lineOfIndex(src, m[0]),
			EnumValues: values,
			Exported:   m[4] != -1,
		})
	}
	return nodes
}

func parseTypeAliases(file, src, clean string) []Node {
	var nodes []Node
	matches := reTypeAlias.FindAllStringSubmatchIndex(clean, -1)
	for _, m := range matches {
		name := clean[m[6]:m[7]]
		rhs := strings.TrimSpace(clean[m[10]:m[11]])
		refs := extractTypeRefs(rhs)
		nodes = append(nodes, Node{
			ID:       nodeID(file, name),
			Name:     name,
			Kind:     KindTypeAlias,
			File:     file,
			Line:     lineOfIndex(src, m[0]),
			Fields:   []Field{{Name: "value", Type: rhs, TypeRefs: refs}},
			Exported: m[4] != -1,
		})
	}
	return nodes
}

// parseMembers walks the top-level body of a class/interface and yields
// fields and method signatures. Statements terminate on:
//   - a `;` at depth 0
//   - a matching `}` that closes a method body
//   - a bare newline at depth 0 (for interface members without `;`)
func parseMembers(body string) ([]Field, []Method) {
	var fields []Field
	var methods []Method
	n := len(body)
	i := 0
	for i < n {
		for i < n && isMemberSkip(body[i]) {
			i++
		}
		if i >= n {
			break
		}
		start := i
		depth := 0
		for i < n {
			c := body[i]
			switch c {
			case '{', '(', '[':
				depth++
			case '}':
				if depth > 0 {
					depth--
					if depth == 0 {
						i++
						goto done
					}
				}
			case ')', ']':
				if depth > 0 {
					depth--
				}
			case ';':
				if depth == 0 {
					i++
					goto done
				}
			case '\n':
				if depth == 0 {
					i++
					goto done
				}
			}
			i++
		}
	done:
		raw := strings.TrimSpace(body[start:i])
		if raw == "" {
			continue
		}
		classifyMember(raw, &fields, &methods)
	}
	return fields, methods
}

// parseConstructorParams extracts TypeScript "parameter property" declarations
// from a constructor signature. These are fields declared inline such as:
//   constructor(public readonly id: OrderId, private lines: OrderLine[]) {}
// Only parameters with one of the access modifiers (public / private /
// protected / readonly) become fields.
func parseConstructorParams(raw string, fields *[]Field) {
	open := strings.Index(raw, "(")
	if open < 0 {
		return
	}
	depth := 1
	end := -1
	for i := open + 1; i < len(raw); i++ {
		switch raw[i] {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				end = i
			}
		}
		if end >= 0 {
			break
		}
	}
	if end < 0 {
		return
	}
	params := raw[open+1 : end]
	for _, p := range splitTopLevel(params, ',') {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		modRe := regexp.MustCompile(`^((?:(?:public|private|protected|readonly|override)\s+)+)(.*)$`)
		m := modRe.FindStringSubmatch(p)
		if m == nil {
			continue
		}
		modifiers := m[1]
		rest := strings.TrimSpace(m[2])
		// rest: `name[?]: Type [= default]`
		nameEnd := strings.IndexAny(rest, "?:")
		if nameEnd < 0 {
			continue
		}
		name := strings.TrimSpace(rest[:nameEnd])
		tail := rest[nameEnd:]
		optional := false
		if strings.HasPrefix(tail, "?") {
			optional = true
			tail = tail[1:]
		}
		tail = strings.TrimSpace(tail)
		if !strings.HasPrefix(tail, ":") {
			continue
		}
		typ := strings.TrimSpace(tail[1:])
		if eq := strings.Index(typ, "="); eq >= 0 {
			typ = strings.TrimSpace(typ[:eq])
		}
		if typ == "" {
			continue
		}
		*fields = append(*fields, Field{
			Name:     name,
			Type:     typ,
			Optional: optional,
			Readonly: strings.Contains(modifiers, "readonly"),
			TypeRefs: extractTypeRefs(typ),
		})
	}
}

func splitTopLevel(s string, sep byte) []string {
	var parts []string
	depth := 0
	var cur strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case '(', '[', '<', '{':
			depth++
		case ')', ']', '>', '}':
			if depth > 0 {
				depth--
			}
		}
		if c == sep && depth == 0 {
			parts = append(parts, cur.String())
			cur.Reset()
			continue
		}
		cur.WriteByte(c)
	}
	if cur.Len() > 0 {
		parts = append(parts, cur.String())
	}
	return parts
}

func isMemberSkip(c byte) bool {
	return c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == ';' || c == ','
}

func classifyMember(raw string, fields *[]Field, methods *[]Method) {
	// Drop the body of a method if one was captured — keep only the signature.
	if brace := strings.Index(raw, "{"); brace >= 0 {
		raw = strings.TrimSpace(raw[:brace])
	}
	// Skip decorators on their own line or leading decorator tokens.
	for strings.HasPrefix(raw, "@") {
		if idx := strings.IndexAny(raw, " \n\t"); idx >= 0 {
			raw = strings.TrimSpace(raw[idx:])
		} else {
			return
		}
	}
	if raw == "" {
		return
	}
	if strings.HasPrefix(raw, "constructor") {
		parseConstructorParams(raw, fields)
		return
	}
	if strings.HasPrefix(raw, "get ") || strings.HasPrefix(raw, "set ") {
		return
	}
	if m := reMethod.FindStringSubmatch(raw); m != nil {
		name := m[1]
		rt := strings.TrimSpace(m[2])
		*methods = append(*methods, Method{
			Name:       name,
			ReturnType: rt,
			TypeRefs:   extractTypeRefs(rt),
		})
		return
	}
	if m := reField.FindStringSubmatch(raw); m != nil {
		modifiers := m[1]
		readonly := strings.Contains(modifiers, "readonly")
		name := m[2]
		optional := m[3] == "?"
		typ := strings.TrimSpace(m[4])
		if typ == "" {
			return
		}
		*fields = append(*fields, Field{
			Name:     name,
			Type:     typ,
			Optional: optional,
			Readonly: readonly,
			TypeRefs: extractTypeRefs(typ),
		})
	}
}

var builtinTypes = map[string]struct{}{
	"Array": {}, "ReadonlyArray": {}, "Map": {}, "ReadonlyMap": {},
	"Set": {}, "ReadonlySet": {}, "Record": {}, "Partial": {}, "Required": {},
	"Readonly": {}, "Pick": {}, "Omit": {}, "Exclude": {}, "Extract": {},
	"NonNullable": {}, "Parameters": {}, "ReturnType": {}, "InstanceType": {},
	"Promise": {}, "Date": {}, "RegExp": {}, "Error": {}, "Function": {},
	"Iterable": {}, "AsyncIterable": {}, "Iterator": {}, "Generator": {},
	"Observable": {}, "Subject": {}, "Buffer": {}, "URL": {}, "URLSearchParams": {},
	"String": {}, "Number": {}, "Boolean": {}, "Object": {}, "Symbol": {}, "BigInt": {},
}

func extractTypeRefs(typ string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, id := range reIdent.FindAllString(typ, -1) {
		if _, ok := builtinTypes[id]; ok {
			continue
		}
		first := id[0]
		if first < 'A' || first > 'Z' {
			continue
		}
		if len(id) == 1 {
			// Single-letter upper-case — almost always a generic parameter.
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func splitTypeList(s string) []string {
	var parts []string
	depth := 0
	var cur strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case '<', '(', '[':
			depth++
		case '>', ')', ']':
			if depth > 0 {
				depth--
			}
		case ',':
			if depth == 0 {
				parts = append(parts, cleanTypeName(cur.String()))
				cur.Reset()
				continue
			}
		}
		cur.WriteByte(c)
	}
	if cur.Len() > 0 {
		parts = append(parts, cleanTypeName(cur.String()))
	}
	return parts
}

func cleanTypeName(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.Index(s, "<"); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

func nodeID(file, name string) string {
	return file + "::" + name
}
