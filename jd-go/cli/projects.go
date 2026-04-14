package cli

import (
	"context"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var projectsCmd = &cobra.Command{
	Use:   "projects",
	Short: "List all Jira projects",
	Run: func(cmd *cobra.Command, args []string) {
		client := newClient()
		projects, err := client.FetchProjects(context.Background())
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}

		fmt.Printf("%-10s %-40s %s\n", "KEY", "NAME", "ID")
		fmt.Println("---------- ---------------------------------------- ----------")
		for _, p := range projects {
			key, _ := p["key"].(string)
			name, _ := p["name"].(string)
			id, _ := p["id"].(string)
			fmt.Printf("%-10s %-40s %s\n", key, name, id)
		}
		fmt.Printf("\nTotal: %d projects\n", len(projects))
	},
}
