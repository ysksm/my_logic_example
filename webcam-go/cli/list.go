package cli

import (
	"fmt"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"
)

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List available camera devices",
	RunE: func(cmd *cobra.Command, args []string) error {
		devs, err := manager.Devices()
		if err != nil {
			return err
		}
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "ID\tNAME\tMODES\tDESCRIPTION")
		for _, d := range devs {
			modes := make([]string, 0, len(d.Modes))
			for _, m := range d.Modes {
				modes = append(modes, fmt.Sprintf("%dx%d@%d", m.Width, m.Height, m.Framerate))
			}
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\n",
				d.ID, d.Name, strings.Join(modes, ","), d.Description)
		}
		return w.Flush()
	},
}
