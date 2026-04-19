package analyzer

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type Options struct {
	IncludeTests bool
	ExcludeDirs  []string
}

func defaultExcludes() []string {
	return []string{"node_modules", ".git", "dist", "build", "out", ".next", ".turbo", "coverage", ".cache"}
}

// Analyze walks `root`, parses every .ts / .tsx file and builds a graph.
// `root` must be an absolute path to a directory.
func Analyze(root string, opt Options) (*Graph, error) {
	info, err := os.Stat(root)
	if err != nil {
		return nil, fmt.Errorf("stat %s: %w", root, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s is not a directory", root)
	}
	excludes := map[string]struct{}{}
	for _, d := range defaultExcludes() {
		excludes[d] = struct{}{}
	}
	for _, d := range opt.ExcludeDirs {
		if d != "" {
			excludes[d] = struct{}{}
		}
	}

	var files []string
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if _, skip := excludes[d.Name()]; skip {
				return filepath.SkipDir
			}
			return nil
		}
		name := d.Name()
		if !strings.HasSuffix(name, ".ts") && !strings.HasSuffix(name, ".tsx") {
			return nil
		}
		if strings.HasSuffix(name, ".d.ts") {
			return nil
		}
		if !opt.IncludeTests {
			lower := strings.ToLower(name)
			if strings.HasSuffix(lower, ".test.ts") || strings.HasSuffix(lower, ".spec.ts") ||
				strings.HasSuffix(lower, ".test.tsx") || strings.HasSuffix(lower, ".spec.tsx") {
				return nil
			}
		}
		files = append(files, path)
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Strings(files)

	var nodes []Node
	filesScanned := 0
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		rel, _ := filepath.Rel(root, f)
		rel = filepath.ToSlash(rel)
		parsed := parseFile(rel, string(b))
		for i := range parsed {
			parsed[i].Module = moduleOf(rel)
		}
		nodes = append(nodes, parsed...)
		filesScanned++
	}

	nodes = dedupNodes(nodes)

	classify(nodes)
	edges := buildEdges(nodes)
	assignAggregates(nodes, edges)
	modules := buildModules(nodes)
	ensureNonNilSlices(nodes)

	g := &Graph{
		Root:    root,
		Nodes:   nodes,
		Edges:   edges,
		Modules: modules,
		Stats: Stats{
			FilesScanned: filesScanned,
			NodeCount:    len(nodes),
			EdgeCount:    len(edges),
			ModuleCount:  len(modules),
		},
	}
	return g, nil
}

func dedupNodes(nodes []Node) []Node {
	seen := map[string]int{}
	out := nodes[:0]
	for _, n := range nodes {
		if idx, ok := seen[n.ID]; ok {
			out[idx] = mergeNodes(out[idx], n)
			continue
		}
		seen[n.ID] = len(out)
		out = append(out, n)
	}
	return out
}

func mergeNodes(a, b Node) Node {
	if len(b.Fields) > len(a.Fields) {
		a.Fields = b.Fields
	}
	if len(b.Methods) > len(a.Methods) {
		a.Methods = b.Methods
	}
	return a
}

// classify fills in the Stereotype of each node using a mix of the declared
// base classes (extends AggregateRoot, implements ValueObject, …) and name
// conventions (suffixes like Repository / Service / Event / Command / Query).
func classify(nodes []Node) {
	base := func(names []string) map[string]bool {
		set := map[string]bool{}
		for _, n := range names {
			set[n] = true
		}
		return set
	}
	for i := range nodes {
		n := &nodes[i]
		bases := base(append(append([]string{}, n.Extends...), n.Implements...))

		switch {
		case n.Kind == KindEnum:
			n.Stereotype = StereotypeEnum
		case n.Kind == KindTypeAlias:
			n.Stereotype = StereotypeTypeAlias
		case bases["AggregateRoot"] || bases["Aggregate"]:
			n.Stereotype = StereotypeAggregate
		case bases["Entity"] || bases["DomainEntity"]:
			n.Stereotype = StereotypeEntity
		case bases["ValueObject"] || bases["DomainPrimitive"]:
			n.Stereotype = StereotypeValueObject
		case bases["DomainEvent"] || bases["IntegrationEvent"] || strings.HasSuffix(n.Name, "Event"):
			n.Stereotype = StereotypeEvent
		case strings.HasSuffix(n.Name, "Repository"):
			n.Stereotype = StereotypeRepository
		case strings.HasSuffix(n.Name, "Factory"):
			n.Stereotype = StereotypeFactory
		case strings.HasSuffix(n.Name, "Service"):
			n.Stereotype = StereotypeService
		case strings.HasSuffix(n.Name, "Policy") || strings.HasSuffix(n.Name, "Specification"):
			n.Stereotype = StereotypePolicy
		case strings.HasSuffix(n.Name, "Command"):
			n.Stereotype = StereotypeCommand
		case strings.HasSuffix(n.Name, "Query"):
			n.Stereotype = StereotypeQuery
		case n.Kind == KindInterface:
			n.Stereotype = StereotypeInterface
		default:
			// Heuristic: a class with an `id` field that is itself a user-defined
			// value object type is very likely an Entity.
			if looksLikeEntity(n) {
				n.Stereotype = StereotypeEntity
			} else if looksLikeValueObject(n) {
				n.Stereotype = StereotypeValueObject
			} else {
				n.Stereotype = StereotypeClass
			}
		}
	}
}

func looksLikeEntity(n *Node) bool {
	for _, f := range n.Fields {
		if (f.Name == "id" || f.Name == "_id") && len(f.TypeRefs) > 0 {
			return true
		}
	}
	return false
}

func looksLikeValueObject(n *Node) bool {
	if n.Kind != KindClass {
		return false
	}
	if len(n.Fields) == 0 {
		return false
	}
	readonlyCount := 0
	for _, f := range n.Fields {
		if f.Readonly {
			readonlyCount++
		}
	}
	return readonlyCount == len(n.Fields)
}

func buildEdges(nodes []Node) []Edge {
	byName := map[string][]int{}
	for i, n := range nodes {
		byName[n.Name] = append(byName[n.Name], i)
	}
	var edges []Edge
	seen := map[string]struct{}{}
	emit := func(fromID, toID string, kind EdgeKind, label string) {
		if fromID == toID {
			return
		}
		key := fromID + "|" + toID + "|" + string(kind) + "|" + label
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		edges = append(edges, Edge{
			ID:    fmt.Sprintf("e%d", len(edges)),
			From:  fromID,
			To:    toID,
			Kind:  kind,
			Label: label,
		})
	}
	resolve := func(from *Node, targetName string) (string, bool) {
		candidates := byName[targetName]
		if len(candidates) == 0 {
			return "", false
		}
		// prefer same-module target, then any
		for _, idx := range candidates {
			if nodes[idx].Module == from.Module {
				return nodes[idx].ID, true
			}
		}
		return nodes[candidates[0]].ID, true
	}

	for i := range nodes {
		from := &nodes[i]
		for _, base := range from.Extends {
			if toID, ok := resolve(from, base); ok {
				emit(from.ID, toID, EdgeExtends, "")
			}
		}
		for _, iface := range from.Implements {
			if toID, ok := resolve(from, iface); ok {
				emit(from.ID, toID, EdgeImplements, "")
			}
		}
		for _, f := range from.Fields {
			for _, ref := range f.TypeRefs {
				if toID, ok := resolve(from, ref); ok {
					emit(from.ID, toID, EdgeField, f.Name)
				}
			}
		}
		for _, m := range from.Methods {
			for _, ref := range m.TypeRefs {
				if toID, ok := resolve(from, ref); ok {
					emit(from.ID, toID, EdgeMethod, m.Name)
				}
			}
		}
	}
	return edges
}

// assignAggregates walks edges outward from each aggregate and claims any
// entity / value-object directly owned by it (via a field reference).
func assignAggregates(nodes []Node, edges []Edge) {
	byID := map[string]int{}
	for i, n := range nodes {
		byID[n.ID] = i
	}
	out := map[string][]string{}
	for _, e := range edges {
		if e.Kind == EdgeField {
			out[e.From] = append(out[e.From], e.To)
		}
	}
	for i, n := range nodes {
		if n.Stereotype != StereotypeAggregate {
			continue
		}
		visited := map[string]bool{n.ID: true}
		stack := append([]string{}, out[n.ID]...)
		for len(stack) > 0 {
			cur := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if visited[cur] {
				continue
			}
			visited[cur] = true
			idx, ok := byID[cur]
			if !ok {
				continue
			}
			target := &nodes[idx]
			if target.Stereotype != StereotypeEntity && target.Stereotype != StereotypeValueObject {
				continue
			}
			if target.Aggregate == "" {
				target.Aggregate = n.Name
			}
			stack = append(stack, out[cur]...)
		}
		nodes[i].Aggregate = n.Name
	}
}

func buildModules(nodes []Node) []Module {
	byMod := map[string][]string{}
	for _, n := range nodes {
		byMod[n.Module] = append(byMod[n.Module], n.ID)
	}
	var mods []Module
	for k, v := range byMod {
		sort.Strings(v)
		mods = append(mods, Module{
			Name:  k,
			Path:  k,
			Nodes: v,
		})
	}
	sort.Slice(mods, func(i, j int) bool { return mods[i].Name < mods[j].Name })
	return mods
}

// ensureNonNilSlices replaces all nil slices inside the graph with empty
// slices so JSON marshalling always produces [] rather than null. The
// frontend relies on `.length` / `.map` being callable on every collection.
func ensureNonNilSlices(nodes []Node) {
	for i := range nodes {
		n := &nodes[i]
		if n.Extends == nil {
			n.Extends = []string{}
		}
		if n.Implements == nil {
			n.Implements = []string{}
		}
		if n.Fields == nil {
			n.Fields = []Field{}
		}
		if n.Methods == nil {
			n.Methods = []Method{}
		}
		for j := range n.Fields {
			if n.Fields[j].TypeRefs == nil {
				n.Fields[j].TypeRefs = []string{}
			}
		}
		for j := range n.Methods {
			if n.Methods[j].TypeRefs == nil {
				n.Methods[j].TypeRefs = []string{}
			}
		}
	}
}

func moduleOf(rel string) string {
	dir := filepath.ToSlash(filepath.Dir(rel))
	if dir == "." || dir == "" {
		return "(root)"
	}
	return dir
}
