package main

import (
	"net/http"
	"strings"
)

func originPolicy(config string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool)
	for _, origin := range strings.Split(config, ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			allowed[origin] = true
		}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin == "" || len(allowed) == 0 {
				next.ServeHTTP(w, r)
				return
			}
			w.Header().Add("Vary", "Origin")
			if !allowed[origin] {
				if r.Method != http.MethodGet && r.Method != http.MethodHead {
					fail(w, http.StatusForbidden, "Origin is not allowed.")
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Game-Market-Request")
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
