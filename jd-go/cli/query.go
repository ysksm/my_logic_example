package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

var queryJSON bool

var queryCmd = &cobra.Command{
	Use:   `query "SQL"`,
	Short: "Execute SQL against the DuckDB database",
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		db := newDB()
		defer db.Close()

		results, columns, err := db.ExecuteQuery(args[0])
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}

		if queryJSON {
			enc := json.NewEncoder(os.Stdout)
			enc.SetIndent("", "  ")
			enc.Encode(results)
			return
		}

		if len(results) == 0 {
			fmt.Println("(no results)")
			return
		}

		// Calculate column widths
		widths := make([]int, len(columns))
		for i, col := range columns {
			widths[i] = len(col)
		}
		for _, row := range results {
			for i, col := range columns {
				val := fmt.Sprintf("%v", row[col])
				if len(val) > widths[i] {
					widths[i] = len(val)
				}
				if widths[i] > 50 {
					widths[i] = 50
				}
			}
		}

		// Print header
		var header []string
		var sep []string
		for i, col := range columns {
			header = append(header, fmt.Sprintf("%-*s", widths[i], col))
			sep = append(sep, strings.Repeat("-", widths[i]))
		}
		fmt.Println(strings.Join(header, " | "))
		fmt.Println(strings.Join(sep, "-+-"))

		// Print rows
		for _, row := range results {
			var vals []string
			for i, col := range columns {
				val := fmt.Sprintf("%v", row[col])
				if len(val) > 50 {
					val = val[:47] + "..."
				}
				vals = append(vals, fmt.Sprintf("%-*s", widths[i], val))
			}
			fmt.Println(strings.Join(vals, " | "))
		}
		fmt.Printf("\n%d rows\n", len(results))
	},
}

func init() {
	queryCmd.Flags().BoolVar(&queryJSON, "json", false, "Output results as JSON")
}
