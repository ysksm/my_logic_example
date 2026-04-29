package cli

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/ysksm/my_logic_example/pcap-go/core"
)

var (
	captureIface       string
	captureFilter      string
	captureSnaplen     uint32
	capturePromisc     bool
	captureCount       int
	captureDurationSec int
)

var captureCmd = &cobra.Command{
	Use:   "capture",
	Short: "Capture packets from an interface and print summaries",
	RunE: func(cmd *cobra.Command, args []string) error {
		if captureIface == "" {
			return fmt.Errorf("--iface is required")
		}

		s, err := manager.Start(core.StartCaptureRequest{
			Interface:   captureIface,
			BPFFilter:   captureFilter,
			Snaplen:     captureSnaplen,
			Promiscuous: capturePromisc,
		})
		if err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "[session %s] capturing on %s ...\n", s.ID, s.Interface)

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		if captureDurationSec > 0 {
			ctx, cancel = context.WithTimeout(ctx, time.Duration(captureDurationSec)*time.Second)
			defer cancel()
		}

		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
		go func() {
			<-sigCh
			cancel()
		}()

		ch := make(chan core.Packet, 256)
		lid, err := manager.Subscribe(s.ID, ch)
		if err != nil {
			return err
		}
		defer manager.Unsubscribe(s.ID, lid)

		printed := 0
	loop:
		for {
			select {
			case <-ctx.Done():
				break loop
			case p, ok := <-ch:
				if !ok {
					break loop
				}
				fmt.Printf("%s #%d %s %s → %s  %s\n",
					p.CapturedAt, p.Seq, layerSummary(p), p.Src, p.Dst, p.Summary)
				printed++
				if captureCount > 0 && printed >= captureCount {
					break loop
				}
			}
		}

		final, _ := manager.Stop(s.ID)
		fmt.Fprintf(os.Stderr, "[session %s] %s, %d packets\n", final.ID, final.State, final.PacketCount)
		return nil
	},
}

func layerSummary(p core.Packet) string {
	parts := make([]string, 0, 4)
	for _, s := range []string{p.LinkLayer, p.NetworkLayer, p.TransportLayer, p.ApplicationLayer} {
		if s != "" {
			parts = append(parts, s)
		}
	}
	if len(parts) == 0 {
		return "-"
	}
	out := parts[0]
	for _, p := range parts[1:] {
		out += "/" + p
	}
	return out
}

func init() {
	captureCmd.Flags().StringVarP(&captureIface, "iface", "i", "", "Interface to capture on (e.g. en0)")
	captureCmd.Flags().StringVarP(&captureFilter, "filter", "f", "", "BPF filter expression (e.g. \"tcp port 80\")")
	captureCmd.Flags().Uint32Var(&captureSnaplen, "snaplen", 65535, "Snapshot length")
	captureCmd.Flags().BoolVar(&capturePromisc, "promiscuous", false, "Enable promiscuous mode")
	captureCmd.Flags().IntVarP(&captureCount, "count", "c", 0, "Stop after N packets (0 = unlimited)")
	captureCmd.Flags().IntVar(&captureDurationSec, "duration", 0, "Stop after N seconds (0 = unlimited)")
}
