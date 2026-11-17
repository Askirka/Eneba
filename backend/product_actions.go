package main

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type gradeSummary struct {
	Average *float64 `db:"average" json:"average"`
	Count   int64    `db:"count" json:"count"`
	Mine    *int     `db:"mine" json:"mine"`
}

func (a profileAPI) ratings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var summary gradeSummary
	err := a.db.GetContext(r.Context(), &summary, `
        SELECT avg(g.grade)::float8 AS average,count(g.grade) AS count,
            max(g.grade) FILTER (WHERE g.user_id = (
                SELECT user_id FROM sessions WHERE token_hash=$2 AND expires_at > now()
            )) AS mine
        FROM products p LEFT JOIN product_ratings g ON g.product_id=p.id
        WHERE p.id=$1 AND p.deleted_at IS NULL GROUP BY p.id`, chi.URLParam(r, "id"), sessionDigest(r))
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "Game not found.")
		return
	}
	if err != nil {
		a.internal(w, r, err)
		return
	}
	reply(w, 200, summary)
}

func (a profileAPI) rate(w http.ResponseWriter, r *http.Request, user int64) {
	var input struct {
		Grade *int `json:"grade"`
	}
	if !readProfileJSON(w, r, 4096, &input) {
		return
	}
	if input.Grade == nil || *input.Grade < 0 || *input.Grade > 10 {
		fail(w, 400, "Choose a whole number from 0 to 10.")
		return
	}
	var grade int
	err := a.db.GetContext(r.Context(), &grade, `
        INSERT INTO product_ratings(product_id,user_id,grade)
        SELECT id,$2,$3 FROM products WHERE id=$1 AND deleted_at IS NULL FOR UPDATE
        ON CONFLICT(product_id,user_id) DO UPDATE SET grade=EXCLUDED.grade RETURNING grade`,
		chi.URLParam(r, "id"), user, *input.Grade)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "Game not found.")
		return
	}
	if err != nil {
		a.internal(w, r, err)
		return
	}
	w.WriteHeader(204)
}

func (a profileAPI) deleteListing(w http.ResponseWriter, r *http.Request, user int64) {
	id := chi.URLParam(r, "id")
	result, err := a.db.ExecContext(r.Context(), `UPDATE products SET deleted_at=now()
        WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL`, id, user)
	if err != nil {
		a.internal(w, r, err)
		return
	}
	count, err := result.RowsAffected()
	if err != nil {
		a.internal(w, r, err)
		return
	}
	if count == 0 {
		var owner sql.NullInt64
		err = a.db.GetContext(r.Context(), &owner, "SELECT owner_id FROM products WHERE id=$1 AND deleted_at IS NULL", id)
		if errors.Is(err, sql.ErrNoRows) {
			fail(w, 404, "Item not found.")
			return
		}
		if err != nil {
			a.internal(w, r, err)
			return
		}
		fail(w, 403, "Only the creator can delete this item.")
		return
	}
	w.WriteHeader(204)
}
