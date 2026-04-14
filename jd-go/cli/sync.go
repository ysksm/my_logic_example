package cli

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"
	"github.com/ysksm/jd-go/core"
)

var syncMode string

var syncCmd = &cobra.Command{
	Use:   "sync <project-key>",
	Short: "Sync a Jira project to DuckDB",
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		projectKey := args[0]
		client := newClient()
		db := newDB()
		defer db.Close()

		syncState := core.NewSyncState(cfg.SyncStatePath)
		svc := core.NewSyncService(client, db, syncState)

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		// Handle Ctrl+C gracefully
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		go func() {
			<-sigCh
			fmt.Println("\nCancelling sync...")
			cancel()
		}()

		// Fetch metadata
		fmt.Println("Fetching metadata...")
		rawProjects, err := client.FetchProjects(ctx)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error fetching projects: %v\n", err)
			os.Exit(1)
		}
		projects := core.TransformRawProjects(rawProjects)

		// Find project ID for issue types
		var projectID string
		for _, p := range rawProjects {
			if k, _ := p["key"].(string); k == projectKey {
				projectID, _ = p["id"].(string)
				break
			}
		}

		statuses, err := client.FetchProjectStatuses(ctx, projectKey)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error fetching statuses: %v\n", err)
			os.Exit(1)
		}

		rawPriorities, err := client.FetchPriorities(ctx)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error fetching priorities: %v\n", err)
			os.Exit(1)
		}
		priorities := core.TransformRawPriorities(rawPriorities)

		var issueTypes []core.IssueTypeMeta
		if projectID != "" {
			rawIssueTypes, err := client.FetchIssueTypes(ctx, projectID)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error fetching issue types: %v\n", err)
				os.Exit(1)
			}
			issueTypes = core.TransformRawIssueTypes(rawIssueTypes)
		}

		rawFields, err := client.FetchFields(ctx)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error fetching fields: %v\n", err)
			os.Exit(1)
		}
		fields := core.TransformRawFields(rawFields)

		// Execute sync
		fmt.Printf("Starting %s sync for %s...\n", syncMode, projectKey)
		result, err := svc.Execute(ctx, core.SyncOptions{
			ProjectKey: projectKey,
			Mode:       syncMode,
			Projects:   projects,
			Statuses:   statuses,
			Priorities: priorities,
			IssueTypes: issueTypes,
			Fields:     fields,
			OnProgress: func(fetched, total int) {
				fmt.Printf("\rFetching issues... %d/%d", fetched, total)
			},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "\nError: %v\n", err)
			os.Exit(1)
		}

		fmt.Printf("\n\nSync completed!\n")
		fmt.Printf("  Mode:     %s\n", result.Mode)
		fmt.Printf("  Fetched:  %d issues\n", result.Fetched)
		fmt.Printf("  History:  %d records\n", result.History)
		fmt.Printf("  Expanded: %d issues, %d columns (%d custom)\n",
			result.Expanded.Expanded, result.Expanded.Columns, result.Expanded.CustomFields)
		fmt.Printf("  DB Total: %d issues, %d history\n",
			result.Summary.Issues, result.Summary.History)
	},
}

func init() {
	syncCmd.Flags().StringVar(&syncMode, "mode", "full", "Sync mode: full, incremental, resume")
}
