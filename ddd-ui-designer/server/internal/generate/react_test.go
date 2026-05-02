package generate

import (
	"strings"
	"testing"

	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/domain"
	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/rules"
	"github.com/ysksm/my_logic_example/ddd-ui-designer/server/internal/ui"
)

func smallSpec() ui.AppSpec {
	d := domain.DomainModel{
		ID: "blog", Name: "Blog Demo",
		Aggregates: []domain.Aggregate{
			{
				Name: "Post",
				Root: domain.Entity{Name: "Post", Fields: []domain.Field{
					{Name: "title", Type: domain.FieldString, Required: true},
					{Name: "body", Type: domain.FieldText},
				}},
			},
		},
	}
	return rules.Derive(d, rules.Default())
}

func TestReactEmitsAllExpectedFiles(t *testing.T) {
	files, err := React(smallSpec())
	if err != nil {
		t.Fatal(err)
	}
	must := []string{
		"package.json",
		"vite.config.ts",
		"tsconfig.json",
		"index.html",
		"README.md",
		"src/main.tsx",
		"src/styles.css",
		"src/runtime.tsx",
		"src/db.ts",
		"src/App.tsx",
		"src/screens/index.ts",
	}
	for _, name := range must {
		if _, ok := files[name]; !ok {
			t.Errorf("missing %s", name)
		}
	}
	// One screen file per Screen.
	for _, s := range smallSpec().Screens {
		key := "src/screens/" + s.ID + ".tsx"
		if _, ok := files[key]; !ok {
			t.Errorf("missing screen file %s", key)
		}
	}
}

func TestAppTSXContainsTransitions(t *testing.T) {
	spec := smallSpec()
	files, err := React(spec)
	if err != nil {
		t.Fatal(err)
	}
	app := string(files["src/App.tsx"])
	for _, tr := range spec.Transitions {
		needle := "from: \"" + tr.From + "\""
		if !strings.Contains(app, needle) {
			t.Errorf("App.tsx missing transition %s", needle)
		}
	}
}

func TestPascalCase(t *testing.T) {
	cases := map[string]string{
		"scr_Order_master":    "ScrOrderMaster",
		"scr_Customer_modal":  "ScrCustomerModal",
		"a_b_c":               "ABC",
		"":                    "",
	}
	for in, want := range cases {
		if got := pascal(in); got != want {
			t.Errorf("pascal(%q)=%q want %q", in, got, want)
		}
	}
}

func TestTarGzRoundtrip(t *testing.T) {
	files, err := React(smallSpec())
	if err != nil {
		t.Fatal(err)
	}
	data, err := TarGz(files, "blog-app")
	if err != nil {
		t.Fatal(err)
	}
	if len(data) < 100 {
		t.Fatalf("tar.gz too small: %d bytes", len(data))
	}
	// gzip magic
	if data[0] != 0x1f || data[1] != 0x8b {
		t.Fatalf("not gzip-magic: %x %x", data[0], data[1])
	}
}
