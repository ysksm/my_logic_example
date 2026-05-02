//go:build linux

package runner

import (
	"os/exec"
	"syscall"
)

// setSysProcAttr asks the kernel to deliver SIGTERM to the child if the
// parent (this process) dies, so generated dev-servers don't outlive us.
func setSysProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Pdeathsig: syscall.SIGTERM,
		Setpgid:   true,
	}
}
