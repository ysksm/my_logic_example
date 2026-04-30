package git

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// Client wraps the local "git" binary for repository operations.
// Using the binary keeps dependencies minimal vs go-git.
type Client struct{}

func New() *Client { return &Client{} }

func (c *Client) run(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// IsRepo verifies the directory is a git repository working tree.
func (c *Client) IsRepo(ctx context.Context, dir string) error {
	out, err := c.run(ctx, dir, "rev-parse", "--is-inside-work-tree")
	if err != nil {
		return err
	}
	if strings.TrimSpace(out) != "true" {
		return errors.New("not a git working tree")
	}
	return nil
}

// ListBranches returns local branch names.
func (c *Client) ListBranches(ctx context.Context, dir string) ([]string, error) {
	out, err := c.run(ctx, dir, "for-each-ref", "--format=%(refname:short)", "refs/heads")
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	res := make([]string, 0, len(lines))
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l != "" {
			res = append(res, l)
		}
	}
	return res, nil
}

// CreateBranch creates a new branch from `from` (optional) and optionally
// checks it out. Does not push.
func (c *Client) CreateBranch(ctx context.Context, dir, branch, from string, checkout bool) error {
	if branch == "" {
		return errors.New("branch name required")
	}
	args := []string{"branch", branch}
	if from != "" {
		args = append(args, from)
	}
	if _, err := c.run(ctx, dir, args...); err != nil {
		return err
	}
	if checkout {
		if _, err := c.run(ctx, dir, "checkout", branch); err != nil {
			return err
		}
	}
	return nil
}
