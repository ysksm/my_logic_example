package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v4/mem"
)

const sampleInterval = 1 * time.Second

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		fmt.Printf("Total memory: %s\n", humanBytes(vm.Total))
	} else {
		log.Fatalf("mem.VirtualMemory: %v", err)
	}
	fmt.Printf("Sampling every %s. Press Ctrl-C to stop.\n", sampleInterval)

	ticker := time.NewTicker(sampleInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			fmt.Println("\nstopped.")
			return
		case t := <-ticker.C:
			vm, err := mem.VirtualMemoryWithContext(ctx)
			if err != nil {
				log.Printf("mem.VirtualMemory: %v", err)
				continue
			}
			sm, err := mem.SwapMemoryWithContext(ctx)
			if err != nil {
				log.Printf("mem.SwapMemory: %v", err)
				continue
			}

			fmt.Printf("[%s] used=%s/%s (%5.1f%%)  available=%s  free=%s  active=%s  inactive=%s  wired=%s  swap=%s/%s (%5.1f%%)\n",
				t.Format("15:04:05"),
				humanBytes(vm.Used), humanBytes(vm.Total), vm.UsedPercent,
				humanBytes(vm.Available),
				humanBytes(vm.Free),
				humanBytes(vm.Active),
				humanBytes(vm.Inactive),
				humanBytes(vm.Wired),
				humanBytes(sm.Used), humanBytes(sm.Total), sm.UsedPercent,
			)
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
