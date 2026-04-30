//go:build !dev && !production

// Package desktop has a stub when neither `dev` nor `production` build tag is
// active so the default `go build` (web server only) does not require the
// Wails toolchain.
package desktop

import (
	"errors"

	"github.com/ysksm/my_logic_example/ticket-manager/server/internal/app"
)

// Run reports that the binary was not built with desktop support.
func Run(_ app.Config) error {
	return errors.New("desktop mode is not available in this build (rebuild with -tags dev or -tags production)")
}
