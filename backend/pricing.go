package main

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (a profileAPI) updateListingPrice(w http.ResponseWriter, r *http.Request, user int64) {
	var input struct {
		Price    int `json:"priceCents"`
		Discount int `json:"discountPercent"`
	}
	if !readProfileJSON(w, r, 4096, &input) {
		return
	}
	if input.Price < 1 || input.Price > 1000000 {
		fail(w, 400, "Enter a price from EUR 0.01 to EUR 10,000.")
		return
	}
	if input.Discount < 0 || input.Discount > 99 {
		fail(w, 400, "Enter a discount from 0 to 99 percent.")
		return
	}
	id := chi.URLParam(r, "id")
	ctx := r.Context()
	var price int
	err := a.db.GetContext(ctx, &price, `UPDATE offers o SET price_cents=$1,discount_percent=$2
        FROM sellers s, products p
        WHERE o.seller_id=s.id AND s.owner_id=$3 AND o.product_id=p.id AND p.id=$4
          AND o.deleted_at IS NULL AND p.deleted_at IS NULL
        RETURNING o.effective_price_cents`, input.Price, input.Discount, user, id)
	if errors.Is(err, sql.ErrNoRows) {
		var exists bool
		err = a.db.GetContext(ctx, &exists, "SELECT EXISTS(SELECT 1 FROM products WHERE id=$1 AND deleted_at IS NULL)", id)
		if err != nil {
			a.internal(w, r, err)
			return
		}
		if !exists {
			fail(w, 404, "Item not found.")
			return
		}
		fail(w, 403, "Only the seller can change this offer price.")
		return
	}
	if err != nil {
		a.internal(w, r, err)
		return
	}
	reply(w, 200, map[string]int{"priceCents": price, "originalPriceCents": input.Price, "discountPercent": input.Discount})
}
