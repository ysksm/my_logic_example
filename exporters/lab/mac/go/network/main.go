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

	"github.com/shirou/gopsutil/v4/net"
)

const sampleInterval = 2 * time.Second

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ifs, err := net.InterfacesWithContext(ctx)
	if err != nil {
		log.Fatalf("net.Interfaces: %v", err)
	}
	fmt.Println("== Network interfaces ==")
	for _, i := range ifs {
		addrs := make([]string, 0, len(i.Addrs))
		for _, a := range i.Addrs {
			addrs = append(addrs, a.Addr)
		}
		fmt.Printf("  %-10s  mtu=%-5d  flags=%v  addrs=%v\n", i.Name, i.MTU, i.Flags, addrs)
	}

	fmt.Printf("\n== Per-interface I/O delta every %s. Press Ctrl-C to stop. ==\n", sampleInterval)

	prev, err := net.IOCountersWithContext(ctx, true)
	if err != nil {
		log.Fatalf("net.IOCounters: %v", err)
	}
	prevAt := time.Now()
	prevByName := indexByName(prev)

	ticker := time.NewTicker(sampleInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			fmt.Println("\nstopped.")
			return
		case t := <-ticker.C:
			cur, err := net.IOCountersWithContext(ctx, true)
			if err != nil {
				log.Printf("net.IOCounters: %v", err)
				continue
			}
			dt := t.Sub(prevAt).Seconds()
			curByName := indexByName(cur)

			names := make([]string, 0, len(curByName))
			for name := range curByName {
				names = append(names, name)
			}
			sort.Strings(names)

			fmt.Printf("[%s]\n", t.Format("15:04:05"))
			for _, name := range names {
				c := curByName[name]
				p, ok := prevByName[name]
				if !ok {
					continue
				}
				rx := float64(c.BytesRecv-p.BytesRecv) / dt
				tx := float64(c.BytesSent-p.BytesSent) / dt
				if rx == 0 && tx == 0 {
					continue
				}
				fmt.Printf("  %-10s  rx=%s/s  tx=%s/s  rx_pkts=%d  tx_pkts=%d  errs(in/out)=%d/%d  drops(in/out)=%d/%d\n",
					name, humanBits(rx), humanBits(tx),
					c.PacketsRecv-p.PacketsRecv, c.PacketsSent-p.PacketsSent,
					c.Errin-p.Errin, c.Errout-p.Errout,
					c.Dropin-p.Dropin, c.Dropout-p.Dropout)
			}
			prev, prevAt, prevByName = cur, t, curByName
		}
	}
}

func indexByName(s []net.IOCountersStat) map[string]net.IOCountersStat {
	m := make(map[string]net.IOCountersStat, len(s))
	for _, c := range s {
		m[c.Name] = c
	}
	return m
}

// humanBits formats bytes/sec as bits/sec (network convention).
func humanBits(bytesPerSec float64) string {
	bps := bytesPerSec * 8
	switch {
	case bps >= 1e9:
		return fmt.Sprintf("%.2f Gbps", bps/1e9)
	case bps >= 1e6:
		return fmt.Sprintf("%.2f Mbps", bps/1e6)
	case bps >= 1e3:
		return fmt.Sprintf("%.2f Kbps", bps/1e3)
	default:
		return fmt.Sprintf("%.0f bps", bps)
	}
}
