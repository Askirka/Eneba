package main

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"

	"eneba-starter/internal/catalog"
	"github.com/go-chi/chi/v5"
)

func mountSellers(r chi.Router, repo catalog.Repository, internal func(http.ResponseWriter, *http.Request, error)) {
	r.Get("/api/sellers/{id}", func(w http.ResponseWriter, r *http.Request) {
		sellerID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 32)
		if err != nil || sellerID < 1 {
			fail(w, 404, "Seller not found.")
			return
		}
		page := 1
		if value := r.URL.Query().Get("page"); value != "" {
			page, err = strconv.Atoi(value)
			if err != nil || page < 1 || page > 1000 {
				fail(w, 400, "Invalid seller page.")
				return
			}
		}
		seller, items, next, err := repo.SellerProducts(r.Context(), sellerID, page)
		if errors.Is(err, sql.ErrNoRows) {
			fail(w, 404, "Seller not found.")
			return
		}
		if err != nil {
			internal(w, r, err)
			return
		}
		reply(w, 200, map[string]any{"seller": seller, "items": items, "next": next, "page": page})
	})
}
