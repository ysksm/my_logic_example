package main

import (
	"flag"
	"log"
	"net/http"
	"strings"

	"github.com/ysksm/my_logic_example/ddd-diagram-generator/server/internal/api"
)

func main() {
	addr := flag.String("addr", ":8090", "HTTP listen address")
	rootsArg := flag.String("roots", "", "Comma-separated list of allowed root directories; empty = any")
	flag.Parse()

	var roots []string
	if *rootsArg != "" {
		for _, r := range strings.Split(*rootsArg, ",") {
			if r = strings.TrimSpace(r); r != "" {
				roots = append(roots, r)
			}
		}
	}

	srv := api.New(roots)
	log.Printf("ddd-diagram-generator listening on %s", *addr)
	if err := http.ListenAndServe(*addr, srv.Handler()); err != nil {
		log.Fatal(err)
	}
}
