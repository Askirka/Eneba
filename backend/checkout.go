package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"slices"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
)

type quoteItem struct {
	SellerID  int64  `db:"seller_id" json:"sellerId"`
	ProductID string `db:"product_id" json:"productId"`
	OfferID   int64  `db:"offer_id" json:"offerId"`
	Title     string `db:"title" json:"title"`
	Seller    string `db:"seller" json:"seller"`
	Price     int64  `db:"price" json:"priceCents"`
	Available bool   `db:"available" json:"available"`
}

type purchaseInput struct {
	Offers    []int64 `json:"offers"`
	Total     int64   `json:"totalCents"`
	RequestID string  `json:"requestId"`
	Decline   bool    `json:"decline"`
}

type receiptItem struct {
	Title  string `db:"title" json:"title"`
	Seller string `db:"seller" json:"seller"`
	Price  int64  `db:"price_cents" json:"priceCents"`
	Code   string `db:"code" json:"code"`
}

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func mountCheckout(r chi.Router, db *sqlx.DB, internal func(http.ResponseWriter, *http.Request, error)) {
	r.Post("/api/cart/quote", func(w http.ResponseWriter, r *http.Request) {
		input, ok := readPurchase(w, r)
		if !ok {
			return
		}
		items := make([]quoteItem, 0, len(input.Offers))
		var total int64
		for _, id := range input.Offers {
			item := quoteItem{OfferID: id, Title: "Unavailable offer"}
			err := db.GetContext(r.Context(), &item, `SELECT o.id offer_id,p.id product_id,p.title,s.id seller_id,s.name seller,o.effective_price_cents price,
                EXISTS (SELECT 1 FROM inventory_keys k WHERE k.offer_id=o.id AND k.redeemed_at IS NULL) available
                FROM offers o JOIN products p ON p.id=o.product_id JOIN sellers s ON s.id=o.seller_id WHERE o.id=$1 AND p.deleted_at IS NULL AND o.deleted_at IS NULL`, id)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				internal(w, r, err)
				return
			}
			if item.Available {
				total += item.Price
			}
			items = append(items, item)
		}
		reply(w, 200, map[string]any{"items": items, "totalCents": total})
	})
	r.Post("/api/checkout", func(w http.ResponseWriter, r *http.Request) {
		input, ok := readPurchase(w, r)
		if !ok {
			return
		}
		if len(input.Offers) == 0 || input.Total <= 0 || !uuidPattern.MatchString(input.RequestID) {
			fail(w, 400, "Invalid checkout confirmation.")
			return
		}
		digest := sessionDigest(r)
		if digest == nil {
			fail(w, 401, "Sign in to continue.")
			return
		}
		ctx := r.Context()
		tx, err := db.BeginTxx(ctx, nil)
		if err != nil {
			internal(w, r, err)
			return
		}
		defer tx.Rollback()
		var userID int64
		err = tx.GetContext(ctx, &userID, `SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id
            WHERE s.token_hash=$1 AND s.expires_at > now() FOR UPDATE OF u`, digest)
		if errors.Is(err, sql.ErrNoRows) {
			fail(w, 401, "Sign in to continue.")
			return
		}
		if err != nil {
			internal(w, r, err)
			return
		}
		slices.Sort(input.Offers)
		payload, _ := json.Marshal(input)
		requestHash := sha256.Sum256(payload)
		var prior struct {
			ID   int64  `db:"id"`
			Hash []byte `db:"request_hash"`
		}
		err = tx.GetContext(ctx, &prior, "SELECT id, request_hash FROM orders WHERE user_id=$1 AND request_id=$2", userID, input.RequestID)
		if err == nil {
			if !slices.Equal(prior.Hash, requestHash[:]) {
				fail(w, 409, "This checkout reference already belongs to another request.")
				return
			}
			sendReceipt(w, r, tx, prior.ID, input.Total, internal)
			return
		}
		if !errors.Is(err, sql.ErrNoRows) {
			internal(w, r, err)
			return
		}
		if input.Decline {
			fail(w, 402, "Demo payment declined.")
			return
		}
		// Lock products in a consistent order before locking their offers or keys.
		var products []string
		if err := tx.SelectContext(ctx, &products, `SELECT p.id FROM products p
            WHERE p.id IN (SELECT product_id FROM offers WHERE id=ANY($1))
            ORDER BY p.id FOR SHARE`, pq.Array(input.Offers)); err != nil {
			internal(w, r, err)
			return
		}
		type allocation struct {
			ID     int64  `db:"id"`
			Title  string `db:"title"`
			Seller string `db:"seller"`
			Price  int64  `db:"price_cents"`
		}
		keys := make([]allocation, 0, len(input.Offers))
		var total int64
		for _, id := range input.Offers {
			var key allocation
			err := tx.GetContext(ctx, &key, `SELECT k.id,p.title,s.name seller,o.effective_price_cents AS price_cents
                FROM inventory_keys k JOIN offers o ON o.id=k.offer_id
                JOIN products p ON p.id=o.product_id JOIN sellers s ON s.id=o.seller_id
                WHERE k.offer_id=$1 AND k.redeemed_at IS NULL AND p.deleted_at IS NULL AND o.deleted_at IS NULL ORDER BY k.id LIMIT 1 FOR UPDATE OF k,o`, id)
			if errors.Is(err, sql.ErrNoRows) {
				fail(w, 409, "An offer is sold out. Refresh your cart.")
				return
			}
			if err != nil {
				internal(w, r, err)
				return
			}
			total += key.Price
			keys = append(keys, key)
		}
		if total != input.Total {
			fail(w, 409, "Prices changed. Review the updated total and try again.")
			return
		}
		var orderID int64
		err = tx.GetContext(ctx, &orderID, `INSERT INTO orders(user_id,request_id,request_hash,total_cents)
            VALUES($1,$2,$3,$4) RETURNING id`, userID, input.RequestID, requestHash[:], total)
		if err != nil {
			internal(w, r, err)
			return
		}
		for _, key := range keys {
			if _, err := tx.ExecContext(ctx, "UPDATE inventory_keys SET redeemed_at=now() WHERE id=$1", key.ID); err != nil {
				internal(w, r, err)
				return
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO order_items(order_id,key_id,title,seller,price_cents) VALUES($1,$2,$3,$4,$5)`,
				orderID, key.ID, key.Title, key.Seller, key.Price); err != nil {
				internal(w, r, err)
				return
			}
		}
		items, err := receiptItems(r, tx, orderID)
		if err != nil {
			internal(w, r, err)
			return
		}
		if err := tx.Commit(); err != nil {
			internal(w, r, err)
			return
		}
		reply(w, 200, map[string]any{"id": orderID, "totalCents": total, "items": items})
	})
}

func receiptItems(r *http.Request, db sqlx.QueryerContext, orderID int64) ([]receiptItem, error) {
	var items []receiptItem
	err := sqlx.SelectContext(r.Context(), db, &items, `SELECT i.title,i.seller,i.price_cents,k.code
        FROM order_items i JOIN inventory_keys k ON k.id=i.key_id WHERE i.order_id=$1 ORDER BY i.key_id`, orderID)
	return items, err
}

func sendReceipt(w http.ResponseWriter, r *http.Request, tx *sqlx.Tx, orderID, total int64, internal func(http.ResponseWriter, *http.Request, error)) {
	items, err := receiptItems(r, tx, orderID)
	if err != nil {
		internal(w, r, err)
		return
	}
	reply(w, 200, map[string]any{"id": orderID, "totalCents": total, "items": items})
}

func readPurchase(w http.ResponseWriter, r *http.Request) (purchaseInput, bool) {
	w.Header().Set("Cache-Control", "no-store")
	var input purchaseInput
	if r.Header.Get("X-Game-Market-Request") != "1" || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		fail(w, 403, "Request rejected.")
		return input, false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || decoder.Decode(new(any)) != io.EOF || len(input.Offers) > 30 {
		fail(w, 400, "Invalid purchase request.")
		return input, false
	}
	seen := make(map[int64]bool, len(input.Offers))
	for _, id := range input.Offers {
		if id <= 0 || seen[id] {
			fail(w, 400, "Invalid offer selection.")
			return input, false
		}
		seen[id] = true
	}
	return input, true
}
