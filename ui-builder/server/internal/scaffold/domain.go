// Package scaffold also flattens a DDD Domain into one or more DataModels.
//
// Each Entity becomes a DataModel. Attributes typed as a ValueObject are
// expanded inline using `vo_field` naming, since the persistence layer is
// table-shaped. Identifier VOs collapse to the underlying primitive of
// their first attribute, defaulting to "string". Entity references
// become "ref" fields pointing at the target entity name.
package scaffold

import (
	"github.com/ysksm/my_logic_example/ui-builder/server/internal/storage"
)

// FromDomain returns a DataModel for every Entity in the domain.
func FromDomain(d storage.Domain) []storage.DataModel {
	vos := map[string]storage.ValueObject{}
	for _, v := range d.ValueObjects {
		vos[v.Name] = v
	}

	out := make([]storage.DataModel, 0, len(d.Entities))
	for _, e := range d.Entities {
		m := storage.DataModel{Name: e.Name}

		// Identifier always becomes the first field (named after the entity's
		// IdentifierName, typically "id"). Pick the primitive type from the
		// VO's first attribute, falling back to "string".
		idType := primitiveOf(vos, e.IdentifierType)
		idName := e.IdentifierName
		if idName == "" {
			idName = "id"
		}
		m.Fields = append(m.Fields, storage.Field{Name: idName, Type: idType, Required: true})

		// Regular attributes: primitive → straight copy, VO → expanded.
		for _, a := range e.Attributes {
			if isPrimitive(a.Type) {
				m.Fields = append(m.Fields, storage.Field{
					Name: a.Name, Type: dataType(a.Type), Required: a.Required,
				})
				continue
			}
			vo, ok := vos[a.Type]
			if !ok {
				// Unknown type — store as plain string for safety.
				m.Fields = append(m.Fields, storage.Field{Name: a.Name, Type: "string"})
				continue
			}
			if vo.IsIdentifier {
				m.Fields = append(m.Fields, storage.Field{
					Name: a.Name, Type: primitiveOf(vos, vo.Name), Required: a.Required,
				})
				continue
			}
			for _, sub := range vo.Attributes {
				m.Fields = append(m.Fields, storage.Field{
					Name: a.Name + "_" + sub.Name,
					Type: dataType(sub.Type),
				})
			}
		}

		// References → ref fields.
		for _, r := range e.References {
			m.Fields = append(m.Fields, storage.Field{
				Name: r.Name, Type: "ref", Ref: r.Target,
			})
		}

		out = append(out, m)
	}
	return out
}

func isPrimitive(t string) bool {
	switch t {
	case "string", "text", "int", "float", "bool", "date", "datetime":
		return true
	}
	return false
}

// dataType maps DDD primitives onto the DataModel field type vocabulary
// (which doesn't distinguish float / datetime).
func dataType(t string) string {
	switch t {
	case "float":
		return "int"
	case "datetime":
		return "date"
	}
	if isPrimitive(t) {
		return t
	}
	return "string"
}

func primitiveOf(vos map[string]storage.ValueObject, name string) string {
	vo, ok := vos[name]
	if !ok || len(vo.Attributes) == 0 {
		return "string"
	}
	return dataType(vo.Attributes[0].Type)
}
