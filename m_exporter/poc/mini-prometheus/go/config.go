package main

import (
	"fmt"
	"os"
	"time"

	"github.com/BurntSushi/toml"
)

type Config struct {
	Server  ServerConfig    `toml:"server"`
	Storage StorageConfig   `toml:"storage"`
	Scrape  []*ScrapeConfig `toml:"scrape_configs"`
}

type ServerConfig struct {
	ListenAddr string `toml:"listen_addr"`
}

type StorageConfig struct {
	RetentionSamples int      `toml:"retention_samples"`
	DataDir          string   `toml:"data_dir"`
	SnapshotInterval duration `toml:"snapshot_interval"`
}

type ScrapeConfig struct {
	JobName        string   `toml:"job_name"`
	ScrapeInterval duration `toml:"scrape_interval"`
	ScrapeTimeout  duration `toml:"scrape_timeout"`
	MetricsPath    string   `toml:"metrics_path"`
	Scheme         string   `toml:"scheme"`
	Targets        []string `toml:"targets"`
}

type duration struct{ time.Duration }

func (d *duration) UnmarshalText(b []byte) error {
	v, err := time.ParseDuration(string(b))
	if err != nil {
		return err
	}
	d.Duration = v
	return nil
}

func loadConfig(path string) (*Config, error) {
	c := &Config{
		Server:  ServerConfig{ListenAddr: "0.0.0.0:9092"},
		Storage: StorageConfig{RetentionSamples: 720},
	}
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return c, nil
		}
		return nil, err
	}
	if _, err := toml.DecodeFile(path, c); err != nil {
		return nil, fmt.Errorf("decode %s: %w", path, err)
	}
	if c.Server.ListenAddr == "" {
		c.Server.ListenAddr = "0.0.0.0:9092"
	}
	if c.Storage.RetentionSamples <= 0 {
		c.Storage.RetentionSamples = 720
	}
	if c.Storage.SnapshotInterval.Duration < 0 {
		c.Storage.SnapshotInterval.Duration = 0
	}
	for _, s := range c.Scrape {
		if s.MetricsPath == "" {
			s.MetricsPath = "/metrics"
		}
		if s.Scheme == "" {
			s.Scheme = "http"
		}
		if s.ScrapeInterval.Duration <= 0 {
			s.ScrapeInterval.Duration = 15 * time.Second
		}
		if s.ScrapeTimeout.Duration <= 0 {
			s.ScrapeTimeout.Duration = 10 * time.Second
		}
	}
	return c, nil
}
