package cli

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
	"github.com/spf13/cobra"
	"github.com/ysksm/jd-go/core"
)

var cfg core.Config

var rootCmd = &cobra.Command{
	Use:   "jd-go",
	Short: "Jira DB Sync - Sync Jira issues to DuckDB",
	PersistentPreRun: func(cmd *cobra.Command, args []string) {
		// Load .env file
		envFile, _ := cmd.Flags().GetString("env-file")
		godotenv.Load(envFile)

		// Override from env if flags are not set
		if cfg.JiraBaseURL == "" {
			cfg.JiraBaseURL = os.Getenv("JIRA_BASE_URL")
		}
		if cfg.JiraUsername == "" {
			cfg.JiraUsername = os.Getenv("JIRA_USERNAME")
		}
		if cfg.JiraAPIToken == "" {
			cfg.JiraAPIToken = os.Getenv("JIRA_API_TOKEN")
		}
		if cfg.DBPath == "" {
			cfg.DBPath = os.Getenv("JIRA_DB_PATH")
		}
		if cfg.DBPath == "" {
			cfg.DBPath = "./data/jira.duckdb"
		}
		if cfg.SyncStatePath == "" {
			cfg.SyncStatePath = "./data/sync_state.json"
		}
	},
}

func init() {
	rootCmd.PersistentFlags().StringVar(&cfg.JiraBaseURL, "url", "", "Jira base URL (env: JIRA_BASE_URL)")
	rootCmd.PersistentFlags().StringVar(&cfg.JiraUsername, "username", "", "Jira username (env: JIRA_USERNAME)")
	rootCmd.PersistentFlags().StringVar(&cfg.JiraAPIToken, "token", "", "Jira API token (env: JIRA_API_TOKEN)")
	rootCmd.PersistentFlags().StringVar(&cfg.DBPath, "db", "", "DuckDB file path (env: JIRA_DB_PATH)")
	rootCmd.PersistentFlags().String("env-file", ".env", "Path to .env file")

	rootCmd.AddCommand(projectsCmd)
	rootCmd.AddCommand(syncCmd)
	rootCmd.AddCommand(queryCmd)
	rootCmd.AddCommand(serveCmd)
	rootCmd.AddCommand(desktopCmd)
}

// Execute runs the root command.
func Execute(version string) {
	rootCmd.Version = version
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func newClient() *core.JiraClient {
	if cfg.JiraBaseURL == "" || cfg.JiraUsername == "" || cfg.JiraAPIToken == "" {
		fmt.Fprintln(os.Stderr, "Error: Jira credentials required (--url, --username, --token or .env)")
		os.Exit(1)
	}
	return core.NewJiraClient(cfg.JiraBaseURL, cfg.JiraUsername, cfg.JiraAPIToken)
}

func newDB() *core.Database {
	db, err := core.NewDatabase(cfg.DBPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to open database: %v\n", err)
		os.Exit(1)
	}
	return db
}
