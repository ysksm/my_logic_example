// Package runner manages generated apps as long-lived child processes:
// it writes generated files to disk, installs npm dependencies (cached
// across regenerations), and starts a Vite dev server on a free port.
package runner

import (
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

type Status string

const (
	StatusGenerating Status = "generating"
	StatusInstalling Status = "installing"
	StatusStarting   Status = "starting"
	StatusReady      Status = "ready"
	StatusStopped    Status = "stopped"
	StatusError      Status = "error"
)

// Run represents one generated app instance.
type Run struct {
	DomainID  string    `json:"domainId"`
	Path      string    `json:"path"`
	Port      int       `json:"port"`
	URL       string    `json:"url,omitempty"`
	Status    Status    `json:"status"`
	Error     string    `json:"error,omitempty"`
	StartedAt time.Time `json:"startedAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	LogPath   string    `json:"logPath,omitempty"`

	cmd *exec.Cmd
}

// LaunchOptions configures what to do after writing files.
type LaunchOptions struct {
	Install bool `json:"install"`
	Start   bool `json:"start"`
}

// Manager owns all running app instances and their on-disk folders.
type Manager struct {
	rootDir string
	mu      sync.RWMutex
	runs    map[string]*Run
}

// New opens the root directory under which all generated apps live.
func New(rootDir string) (*Manager, error) {
	abs, err := filepath.Abs(rootDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, err
	}
	return &Manager{rootDir: abs, runs: map[string]*Run{}}, nil
}

// Path returns the absolute folder where the named domain's app lives.
func (m *Manager) Path(domainID string) string {
	return filepath.Join(m.rootDir, slug(domainID)+"-app")
}

// Get returns a snapshot of the run for the given domain (or nil).
func (m *Manager) Get(domainID string) *Run {
	m.mu.RLock()
	defer m.mu.RUnlock()
	r, ok := m.runs[domainID]
	if !ok {
		return nil
	}
	cp := *r
	return &cp
}

// List returns snapshots of all currently-tracked runs.
func (m *Manager) List() []*Run {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*Run, 0, len(m.runs))
	for _, r := range m.runs {
		cp := *r
		out = append(out, &cp)
	}
	return out
}

// Stop terminates the dev server (if running) but leaves files on disk.
func (m *Manager) Stop(domainID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[domainID]
	if !ok {
		return nil
	}
	if r.cmd != nil && r.cmd.Process != nil {
		_ = r.cmd.Process.Kill()
	}
	r.Status = StatusStopped
	r.UpdatedAt = time.Now()
	return nil
}

// StopAll is intended for graceful shutdown of the parent process.
func (m *Manager) StopAll() {
	m.mu.RLock()
	ids := make([]string, 0, len(m.runs))
	for id := range m.runs {
		ids = append(ids, id)
	}
	m.mu.RUnlock()
	for _, id := range ids {
		_ = m.Stop(id)
	}
}

// writeFiles overwrites all generated files but preserves node_modules and
// package-lock.json so subsequent launches don't re-download dependencies.
func (m *Manager) writeFiles(domainID string, files map[string][]byte) (string, error) {
	p := m.Path(domainID)
	if entries, err := os.ReadDir(p); err == nil {
		for _, e := range entries {
			n := e.Name()
			if n == "node_modules" || n == ".git" || n == "package-lock.json" {
				continue
			}
			_ = os.RemoveAll(filepath.Join(p, n))
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	for name, content := range files {
		full := filepath.Join(p, name)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return "", err
		}
		if err := os.WriteFile(full, content, 0o644); err != nil {
			return "", err
		}
	}
	return p, nil
}

// Launch writes the files, then asynchronously runs npm install (if missing
// node_modules) and starts the dev server. It returns immediately with the
// initial Run; callers should poll Get() to observe transitions.
func (m *Manager) Launch(domainID string, files map[string][]byte, opts LaunchOptions) (*Run, error) {
	// Stop any prior instance for the same id; reuse its folder.
	_ = m.Stop(domainID)

	path, err := m.writeFiles(domainID, files)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	r := &Run{
		DomainID:  domainID,
		Path:      path,
		Status:    StatusGenerating,
		StartedAt: now,
		UpdatedAt: now,
		LogPath:   filepath.Join(path, ".dev.log"),
	}
	m.mu.Lock()
	m.runs[domainID] = r
	m.mu.Unlock()

	if !opts.Install && !opts.Start {
		m.update(domainID, func(x *Run) { x.Status = StatusReady })
		return m.Get(domainID), nil
	}

	go m.lifecycle(domainID, path, opts)
	return m.Get(domainID), nil
}

func (m *Manager) lifecycle(domainID, path string, opts LaunchOptions) {
	if opts.Install {
		nodeModules := filepath.Join(path, "node_modules")
		if _, err := os.Stat(nodeModules); err != nil {
			m.update(domainID, func(x *Run) { x.Status = StatusInstalling })
			logF, _ := os.Create(filepath.Join(path, ".install.log"))
			cmd := exec.Command("npm", "install", "--no-audit", "--no-fund", "--silent")
			cmd.Dir = path
			cmd.Stdout = logF
			cmd.Stderr = logF
			err := cmd.Run()
			if logF != nil {
				_ = logF.Close()
			}
			if err != nil {
				m.update(domainID, func(x *Run) {
					x.Status = StatusError
					x.Error = "npm install failed (see .install.log): " + err.Error()
				})
				return
			}
		}
	}

	if !opts.Start {
		m.update(domainID, func(x *Run) { x.Status = StatusReady })
		return
	}

	port, err := freePort()
	if err != nil {
		m.update(domainID, func(x *Run) { x.Status = StatusError; x.Error = err.Error() })
		return
	}
	m.update(domainID, func(x *Run) {
		x.Status = StatusStarting
		x.Port = port
		x.URL = fmt.Sprintf("http://localhost:%d/", port)
	})

	logF, _ := os.Create(filepath.Join(path, ".dev.log"))
	cmd := exec.Command("npm", "run", "dev", "--", "--port", strconv.Itoa(port), "--strictPort", "--host", "127.0.0.1")
	cmd.Dir = path
	cmd.Stdout = logF
	cmd.Stderr = logF
	setSysProcAttr(cmd)

	if err := cmd.Start(); err != nil {
		if logF != nil {
			_ = logF.Close()
		}
		m.update(domainID, func(x *Run) { x.Status = StatusError; x.Error = err.Error() })
		return
	}
	m.mu.Lock()
	if r, ok := m.runs[domainID]; ok {
		r.cmd = cmd
	}
	m.mu.Unlock()

	// Reap exit so we don't accumulate zombies; mark Stopped if it dies.
	go func() {
		err := cmd.Wait()
		m.update(domainID, func(x *Run) {
			if x.Status != StatusStopped {
				x.Status = StatusStopped
				if err != nil {
					x.Error = err.Error()
				}
			}
		})
	}()

	if waitForPort(port, 30*time.Second) {
		m.update(domainID, func(x *Run) { x.Status = StatusReady; x.Error = "" })
	} else {
		_ = cmd.Process.Kill()
		m.update(domainID, func(x *Run) {
			x.Status = StatusError
			x.Error = "dev server did not become ready within 30s (see .dev.log)"
		})
	}
}

func (m *Manager) update(domainID string, mutate func(*Run)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[domainID]
	if !ok {
		return
	}
	mutate(r)
	r.UpdatedAt = time.Now()
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func waitForPort(port int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 200*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return true
		}
		time.Sleep(200 * time.Millisecond)
	}
	return false
}

// slug normalises a domain id into a safe directory fragment.
func slug(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			out = append(out, r)
		case r == '-' || r == '_':
			out = append(out, '-')
		}
	}
	if len(out) == 0 {
		return "ddd"
	}
	return string(out)
}
