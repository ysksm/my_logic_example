package main

import "github.com/ysksm/my_logic_example/pcap-go/cli"

var version = "dev"

func main() {
	cli.Execute(version)
}
