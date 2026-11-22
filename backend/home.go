package main

import (
	"eneba-starter/internal/catalog"
	"github.com/go-chi/chi/v5"
	"net/http"
)

func mountHome(r chi.Router, repo catalog.Repository, internal func(http.ResponseWriter, *http.Request, error)) {
	r.Get("/api/home/banners", func(w http.ResponseWriter, r *http.Request) {
		banners, err := repo.Banners(r.Context())
		if err != nil {
			internal(w, r, err)
			return
		}
		reply(w, 200, banners)
	})
	routes := []struct{ path, kind string }{
		{"best-sellers", "best_sellers"}, {"deals", "deals"}, {"new-releases", "new_releases"},
	}
	for _, route := range routes {
		r.Get("/api/home/"+route.path, func(w http.ResponseWriter, r *http.Request) {
			block, err := repo.HomeBlock(r.Context(), route.kind)
			if err != nil {
				internal(w, r, err)
				return
			}
			reply(w, 200, block)
		})
	}
}
