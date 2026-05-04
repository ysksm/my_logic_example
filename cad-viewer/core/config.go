package core

// Config holds runtime configuration shared between the web server and the
// desktop (Wails) wrapper.
type Config struct {
	// MaxUploadBytes caps the size of an uploaded CAD file. 0 means default
	// (64 MiB).
	MaxUploadBytes int64
}

// DefaultConfig returns sensible defaults.
func DefaultConfig() Config {
	return Config{
		MaxUploadBytes: 64 * 1024 * 1024,
	}
}

// Normalize fills in zero-valued fields with defaults.
func (c Config) Normalize() Config {
	d := DefaultConfig()
	if c.MaxUploadBytes <= 0 {
		c.MaxUploadBytes = d.MaxUploadBytes
	}
	return c
}
