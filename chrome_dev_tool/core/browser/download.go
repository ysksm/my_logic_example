package browser

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// DefaultRevision is the Chromium snapshot revision used when none is given.
// Bump this if a newer pinned build is desired.
const DefaultRevision = "1300313"

// CacheDir returns ~/.cache/chrome_dev_tool/chromium/<revision>/.
func CacheDir(revision string) (string, error) {
	home, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "chrome_dev_tool", "chromium", revision), nil
}

// EnsureChromium returns the path to a usable Chromium binary, downloading
// and unpacking the snapshot at `revision` if it is not already cached.
func EnsureChromium(ctx context.Context, revision string) (string, error) {
	if revision == "" {
		revision = DefaultRevision
	}
	dir, err := CacheDir(revision)
	if err != nil {
		return "", err
	}
	bin, err := chromiumExecPath(dir)
	if err != nil {
		return "", err
	}
	if fileExecutable(bin) {
		return bin, nil
	}
	if err := downloadAndExtract(ctx, revision, dir); err != nil {
		return "", err
	}
	bin, err = chromiumExecPath(dir)
	if err != nil {
		return "", err
	}
	if !fileExecutable(bin) {
		return "", fmt.Errorf("chromium binary not executable: %s", bin)
	}
	return bin, nil
}

func snapshotPlatform() (folder, archiveName string, err error) {
	switch runtime.GOOS {
	case "darwin":
		if runtime.GOARCH == "arm64" {
			return "Mac_Arm", "chrome-mac.zip", nil
		}
		return "Mac", "chrome-mac.zip", nil
	case "linux":
		if runtime.GOARCH == "amd64" {
			return "Linux_x64", "chrome-linux.zip", nil
		}
	case "windows":
		if runtime.GOARCH == "amd64" {
			return "Win_x64", "chrome-win.zip", nil
		}
	}
	return "", "", fmt.Errorf("browser: no chromium snapshot for %s/%s", runtime.GOOS, runtime.GOARCH)
}

func chromiumExecPath(dir string) (string, error) {
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"), nil
	case "linux":
		return filepath.Join(dir, "chrome-linux", "chrome"), nil
	case "windows":
		return filepath.Join(dir, "chrome-win", "chrome.exe"), nil
	}
	return "", fmt.Errorf("browser: unsupported platform %s/%s", runtime.GOOS, runtime.GOARCH)
}

func downloadAndExtract(ctx context.Context, revision, dir string) error {
	folder, archiveName, err := snapshotPlatform()
	if err != nil {
		return err
	}
	url := fmt.Sprintf("https://commondatastorage.googleapis.com/chromium-browser-snapshots/%s/%s/%s",
		folder, revision, archiveName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	zipPath := filepath.Join(dir, archiveName)
	if err := downloadFile(ctx, url, zipPath); err != nil {
		return fmt.Errorf("download %s: %w", url, err)
	}
	if err := unzipInto(zipPath, dir); err != nil {
		return fmt.Errorf("unzip %s: %w", zipPath, err)
	}
	_ = os.Remove(zipPath)
	return nil
}

func downloadFile(ctx context.Context, url, dst string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return errors.New(res.Status)
	}
	tmp := dst + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, res.Body); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

func unzipInto(zipPath, dst string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, zf := range r.File {
		if err := extractZipEntry(zf, dst); err != nil {
			return err
		}
	}
	return nil
}

func extractZipEntry(zf *zip.File, dst string) error {
	target := filepath.Join(dst, zf.Name)
	rel, err := filepath.Rel(dst, target)
	if err != nil || strings.HasPrefix(rel, "..") {
		return fmt.Errorf("zip entry escapes destination: %s", zf.Name)
	}
	if zf.FileInfo().IsDir() {
		return os.MkdirAll(target, zf.Mode())
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	in, err := zf.Open()
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, zf.Mode())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
