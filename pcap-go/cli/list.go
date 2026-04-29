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
	Short: "List capturable network interfaces",
	RunE: func(cmd *cobra.Command, args []string) error {
		ifs, err := manager.Interfaces()
		if err != nil {
			return err
		}
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "NAME\tUP\tLOOPBACK\tADDRESSES\tDESCRIPTION")
		for _, ni := range ifs {
			fmt.Fprintf(w, "%s\t%v\t%v\t%s\t%s\n",
				ni.Name, ni.IsUp, ni.IsLoopback,
				strings.Join(ni.Addresses, ","), ni.Description)
		}
		return w.Flush()
	},
}
