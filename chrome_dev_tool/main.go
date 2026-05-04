package main

import (
	"fmt"
	"os"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/cli"
)

func main() {
	if err := cli.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
