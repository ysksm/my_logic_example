//go:build !linux

package runner

import "os/exec"

// setSysProcAttr is a no-op on non-Linux: we rely on Stop()/StopAll() to
// clean up child processes.
func setSysProcAttr(_ *exec.Cmd) {}
