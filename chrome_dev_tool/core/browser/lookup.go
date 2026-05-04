// Package browser handles Chromium discovery, download and launch.
package browser

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// LookupChrome returns the path to a Chrome / Chromium / Edge binary already
// installed on the machine. It returns ErrNotFound if nothing is found.
func LookupChrome() (string, error) {
	candidates := platformCandidates()
	// Absolute paths first.
	for _, p := range candidates {
		if filepath.IsAbs(p) {
			if fileExecutable(p) {
				return p, nil
			}
			continue
		}
		if found, err := exec.LookPath(p); err == nil {
			return found, nil
		}
	}
	return "", ErrNotFound
}

// ErrNotFound is returned by LookupChrome when nothing on PATH matches.
var ErrNotFound = errors.New("browser: no Chrome / Chromium binary found")

func platformCandidates() []string {
	switch runtime.GOOS {
	case "darwin":
		return []string{
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"google-chrome",
			"chromium",
		}
	case "linux":
		return []string{
			"google-chrome",
			"google-chrome-stable",
			"chromium",
			"chromium-browser",
			"microsoft-edge",
		}
	case "windows":
		programFiles := os.Getenv("ProgramFiles")
		programFilesX86 := os.Getenv("ProgramFiles(x86)")
		localAppData := os.Getenv("LocalAppData")
		out := []string{}
		if programFiles != "" {
			out = append(out,
				filepath.Join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
				filepath.Join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
			)
		}
		if programFilesX86 != "" {
			out = append(out,
				filepath.Join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
				filepath.Join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
			)
		}
		if localAppData != "" {
			out = append(out, filepath.Join(localAppData, "Google", "Chrome", "Application", "chrome.exe"))
		}
		out = append(out, "chrome.exe", "msedge.exe")
		return out
	}
	return nil
}

func fileExecutable(p string) bool {
	st, err := os.Stat(p)
	if err != nil {
		return false
	}
	if st.IsDir() {
		return false
	}
	if runtime.GOOS == "windows" {
		return true
	}
	return st.Mode().Perm()&0o111 != 0
}
