package browser

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"time"
)

// LaunchOptions tells Launch how to bring up Chromium.
type LaunchOptions struct {
	// ExecPath, if non-empty, overrides Chrome detection / download.
	ExecPath string
	// Port for --remote-debugging-port. 0 → pick a free one.
	Port int
	// Headless launches without a window.
	Headless bool
	// URL to open at startup. Empty for about:blank.
	URL string
	// UserDataDir for --user-data-dir. Empty → ephemeral temp dir.
	UserDataDir string
	// ChromiumRevision used when ExecPath is empty and no system Chrome is
	// found. Empty → DefaultRevision.
	ChromiumRevision string
}

// Process is a running Chromium that we are responsible for.
type Process struct {
	cmd      *exec.Cmd
	Port     int
	UserData string
	tempUser bool
	binary   string
	done     chan struct{}
	doneOnce sync.Once
}

// Launch resolves a Chromium binary, then starts it with --remote-debugging-port.
// If ExecPath is unset it tries LookupChrome() and, on miss, EnsureChromium().
func Launch(ctx context.Context, opts LaunchOptions) (*Process, error) {
	bin := opts.ExecPath
	if bin == "" {
		if found, err := LookupChrome(); err == nil {
			bin = found
		} else if errors.Is(err, ErrNotFound) {
			downloaded, derr := EnsureChromium(ctx, opts.ChromiumRevision)
			if derr != nil {
				return nil, fmt.Errorf("no system chrome and download failed: %w", derr)
			}
			bin = downloaded
		} else {
			return nil, err
		}
	}

	port := opts.Port
	if port == 0 {
		p, err := freePort()
		if err != nil {
			return nil, err
		}
		port = p
	}

	userData := opts.UserDataDir
	tempUser := false
	if userData == "" {
		dir, err := os.MkdirTemp("", "chrome_dev_tool-userdata-")
		if err != nil {
			return nil, err
		}
		userData = dir
		tempUser = true
	}

	args := []string{
		"--remote-debugging-port=" + strconv.Itoa(port),
		"--user-data-dir=" + userData,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-features=Translate",
	}
	if opts.Headless {
		args = append(args, "--headless=new")
	}
	url := opts.URL
	if url == "" {
		url = "about:blank"
	}
	args = append(args, url)

	cmd := exec.Command(bin, args...)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		if tempUser {
			os.RemoveAll(userData)
		}
		return nil, err
	}

	p := &Process{
		cmd:      cmd,
		Port:     port,
		UserData: userData,
		tempUser: tempUser,
		binary:   bin,
		done:     make(chan struct{}),
	}
	go func() {
		_ = cmd.Wait()
		p.doneOnce.Do(func() { close(p.done) })
	}()

	if err := waitForDebugger(ctx, port, 15*time.Second); err != nil {
		_ = cmd.Process.Kill()
		<-p.done
		if tempUser {
			os.RemoveAll(userData)
		}
		return nil, fmt.Errorf("waiting for chrome debugger: %w", err)
	}
	return p, nil
}

// Stop kills the Chromium process we started.
func (p *Process) Stop() error {
	if p.cmd == nil || p.cmd.Process == nil {
		return nil
	}
	_ = p.cmd.Process.Kill()
	<-p.done
	if p.tempUser && p.UserData != "" {
		_ = os.RemoveAll(p.UserData)
	}
	return nil
}

// Done returns a channel closed when the process has exited.
func (p *Process) Done() <-chan struct{} { return p.done }

// Binary is the resolved chromium executable path.
func (p *Process) Binary() string { return p.binary }

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func waitForDebugger(ctx context.Context, port int, timeout time.Duration) error {
	url := fmt.Sprintf("http://127.0.0.1:%d/json/version", port)
	deadline := time.Now().Add(timeout)
	for {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		res, err := http.DefaultClient.Do(req)
		if err == nil {
			res.Body.Close()
			if res.StatusCode == http.StatusOK {
				return nil
			}
		}
		if time.Now().After(deadline) {
			return errors.New("timed out waiting for /json/version")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(150 * time.Millisecond):
		}
	}
}

