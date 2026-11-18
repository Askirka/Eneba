package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
)

func addListingKeys(ctx context.Context, tx *sqlx.Tx, offer int64, suffix [16]byte, quantity int) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO inventory_keys(offer_id,code)
        SELECT $1,$2 || '-' || n FROM generate_series(1,$3::integer) AS n`,
		offer, "DEMO-LISTING-"+hex.EncodeToString(suffix[:]), quantity)
	return err
}

func (a profileAPI) restockListing(w http.ResponseWriter, r *http.Request, user int64) {
	var input struct {
		Quantity int `json:"quantity"`
	}
	if !readProfileJSON(w, r, 4096, &input) {
		return
	}
	if input.Quantity < 1 || input.Quantity > 100 {
		fail(w, 400, "Enter a quantity from 1 to 100.")
		return
	}
	var suffix [16]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		a.internal(w, r, err)
		return
	}
	ctx := r.Context()
	tx, err := a.db.BeginTxx(ctx, nil)
	if err != nil {
		a.internal(w, r, err)
		return
	}
	defer tx.Rollback()

	id := chi.URLParam(r, "id")
	var product string
	err = tx.GetContext(ctx, &product, "SELECT id FROM products WHERE id=$1 AND deleted_at IS NULL FOR SHARE", id)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "Item not found.")
		return
	}
	if err != nil {
		a.internal(w, r, err)
		return
	}
	var offer int64
	err = tx.GetContext(ctx, &offer, `SELECT o.id FROM offers o JOIN sellers s ON s.id=o.seller_id
        WHERE o.product_id=$1 AND s.owner_id=$2 AND o.deleted_at IS NULL FOR UPDATE OF o`, id, user)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 403, "Only the seller can restock this offer.")
		return
	}
	if err != nil {
		a.internal(w, r, err)
		return
	}

	var available int
	if err = tx.GetContext(ctx, &available, "SELECT count(*) FROM inventory_keys WHERE offer_id=$1 AND redeemed_at IS NULL", offer); err != nil {
		a.internal(w, r, err)
		return
	}
	if available+input.Quantity > 100 {
		fail(w, 409, "An offer can have at most 100 available keys.")
		return
	}
	if err = addListingKeys(ctx, tx, offer, suffix, input.Quantity); err != nil {
		a.internal(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		a.internal(w, r, err)
		return
	}
	reply(w, 200, map[string]int{"stock": available + input.Quantity})
}
