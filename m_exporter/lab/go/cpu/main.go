package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
)

const sampleInterval = 1 * time.Second

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	logical, err := cpu.Counts(true)
	if err != nil {
		log.Fatalf("cpu.Counts(logical): %v", err)
	}
	physical, err := cpu.Counts(false)
	if err != nil {
		log.Fatalf("cpu.Counts(physical): %v", err)
	}
	fmt.Printf("CPU cores: physical=%d logical=%d\n", physical, logical)
	fmt.Printf("Sampling every %s. Press Ctrl-C to stop.\n", sampleInterval)

	ticker := time.NewTicker(sampleInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			fmt.Println("\nstopped.")
			return
		case t := <-ticker.C:
			total, err := cpu.PercentWithContext(ctx, 0, false)
			if err != nil {
				log.Printf("cpu.Percent(total): %v", err)
				continue
			}
			perCore, err := cpu.PercentWithContext(ctx, 0, true)
			if err != nil {
				log.Printf("cpu.Percent(perCore): %v", err)
				continue
			}

			fmt.Printf("[%s] total=%5.1f%%", t.Format("15:04:05"), total[0])
			for i, p := range perCore {
				fmt.Printf("  cpu%d=%5.1f%%", i, p)
			}
			fmt.Println()
		}
	}
}
