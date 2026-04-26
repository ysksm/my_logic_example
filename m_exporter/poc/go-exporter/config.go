package main

import (
	"fmt"
	"os"
	"time"

	"github.com/BurntSushi/toml"
)

type Config struct {
	Server    ServerConfig    `toml:"server"`
	Collector CollectorConfig `toml:"collector"`
}

type ServerConfig struct {
	ListenAddr  string `toml:"listen_addr"`
	MetricsPath string `toml:"metrics_path"`
}

type CollectorConfig struct {
	Interval duration `toml:"interval"`
	Unit     string   `toml:"unit"` // "ratio" (0-1) or "percent" (0-100)
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
		Server:    ServerConfig{ListenAddr: "0.0.0.0:9100", MetricsPath: "/metrics"},
		Collector: CollectorConfig{Interval: duration{5 * time.Second}, Unit: "ratio"},
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
	if c.Server.MetricsPath == "" {
		c.Server.MetricsPath = "/metrics"
	}
	if c.Collector.Interval.Duration <= 0 {
		c.Collector.Interval.Duration = 5 * time.Second
	}
	if c.Collector.Unit == "" {
		c.Collector.Unit = "ratio"
	}
	if c.Collector.Unit != "ratio" && c.Collector.Unit != "percent" {
		return nil, fmt.Errorf("collector.unit %q invalid: must be \"ratio\" or \"percent\"", c.Collector.Unit)
	}
	return c, nil
}
