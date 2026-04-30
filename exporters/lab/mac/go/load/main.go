package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
)

const sampleInterval = 2 * time.Second

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	info, err := host.InfoWithContext(ctx)
	if err != nil {
		log.Fatalf("host.Info: %v", err)
	}
	fmt.Println("== Host info ==")
	fmt.Printf("  hostname=%s  os=%s  platform=%s %s  kernel=%s  arch=%s\n",
		info.Hostname, info.OS, info.Platform, info.PlatformVersion, info.KernelVersion, info.KernelArch)
	fmt.Printf("  uptime=%s  boot_time=%s\n",
		time.Duration(info.Uptime)*time.Second,
		time.Unix(int64(info.BootTime), 0).Format(time.RFC3339))

	fmt.Printf("\n== Load average + misc counters every %s. Press Ctrl-C to stop. ==\n", sampleInterval)

	ticker := time.NewTicker(sampleInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			fmt.Println("\nstopped.")
			return
		case t := <-ticker.C:
			avg, err := load.AvgWithContext(ctx)
			if err != nil {
				log.Printf("load.Avg: %v", err)
				continue
			}
			misc, err := load.MiscWithContext(ctx)
			if err != nil {
				log.Printf("load.Misc: %v", err)
				continue
			}
			fmt.Printf("[%s] load1=%5.2f  load5=%5.2f  load15=%5.2f  procs_running=%d  procs_blocked=%d  procs_total=%d  ctx_switches=%d\n",
				t.Format("15:04:05"),
				avg.Load1, avg.Load5, avg.Load15,
				misc.ProcsRunning, misc.ProcsBlocked, misc.ProcsTotal, misc.Ctxt,
			)
		}
	}
}
