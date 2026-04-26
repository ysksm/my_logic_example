package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sort"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v4/disk"
)

const sampleInterval = 2 * time.Second

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	parts, err := disk.PartitionsWithContext(ctx, false)
	if err != nil {
		log.Fatalf("disk.Partitions: %v", err)
	}
	fmt.Println("== Mounted partitions ==")
	for _, p := range parts {
		usage, err := disk.UsageWithContext(ctx, p.Mountpoint)
		if err != nil {
			log.Printf("disk.Usage(%s): %v", p.Mountpoint, err)
			continue
		}
		fmt.Printf("  %-20s  fs=%-8s  used=%s/%s (%5.1f%%)\n",
			p.Mountpoint, p.Fstype,
			humanBytes(usage.Used), humanBytes(usage.Total), usage.UsedPercent)
	}

	fmt.Printf("\n== Disk I/O delta every %s. Press Ctrl-C to stop. ==\n", sampleInterval)

	prev, err := disk.IOCountersWithContext(ctx)
	if err != nil {
		log.Fatalf("disk.IOCounters: %v", err)
	}
	prevAt := time.Now()

	ticker := time.NewTicker(sampleInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			fmt.Println("\nstopped.")
			return
		case t := <-ticker.C:
			cur, err := disk.IOCountersWithContext(ctx)
			if err != nil {
				log.Printf("disk.IOCounters: %v", err)
				continue
			}
			dt := t.Sub(prevAt).Seconds()
			names := make([]string, 0, len(cur))
			for name := range cur {
				names = append(names, name)
			}
			sort.Strings(names)

			fmt.Printf("[%s]\n", t.Format("15:04:05"))
			for _, name := range names {
				c := cur[name]
				p, ok := prev[name]
				if !ok {
					continue
				}
				rdBytes := float64(c.ReadBytes-p.ReadBytes) / dt
				wrBytes := float64(c.WriteBytes-p.WriteBytes) / dt
				rdOps := float64(c.ReadCount-p.ReadCount) / dt
				wrOps := float64(c.WriteCount-p.WriteCount) / dt
				fmt.Printf("  %-12s  read=%s/s (%5.0f iops)  write=%s/s (%5.0f iops)\n",
					name, humanBytes(uint64(rdBytes)), rdOps, humanBytes(uint64(wrBytes)), wrOps)
			}
			prev, prevAt = cur, t
		}
	}
}

func humanBytes(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%dB", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f%ciB", float64(b)/float64(div), "KMGTPE"[exp])
}
