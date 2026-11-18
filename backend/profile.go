package main

import (
	"bytes"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"golang.org/x/crypto/bcrypt"
)

const maxAvatar = 256 * 1024

type profileAPI struct {
	db       *sqlx.DB
	internal func(http.ResponseWriter, *http.Request, error)
}

type accountProfile struct {
	ID        int64  `db:"id" json:"id"`
	Name      string `db:"display_name" json:"name"`
	Email     string `db:"email" json:"email"`
	HasAvatar bool   `db:"has_avatar" json:"hasAvatar"`
}

func mountProfile(r chi.Router, db *sqlx.DB, internal func(http.ResponseWriter, *http.Request, error)) {
	api := profileAPI{db, internal}
	r.Get("/api/products/{id}/ratings", api.ratings)
	r.Get("/api/products/{id}/comments", api.comments)
	r.Post("/api/products/{id}/comments", api.authenticated(api.addComment))
	r.Post("/api/products/{id}/ratings", api.authenticated(api.rate))
	r.Route("/api/account", func(r chi.Router) {
		r.Get("/", api.authenticated(api.profile))
		r.Post("/", api.authenticated(api.update))
		r.Get("/avatar", api.authenticated(api.avatar))
		r.Post("/password", api.authenticated(api.password))
		r.Get("/orders", api.authenticated(api.orders))
		r.Get("/orders/{id}", api.authenticated(api.order))
		r.Get("/items", api.authenticated(api.listings))
		r.Post("/items", api.authenticated(api.createListing))
		r.Delete("/items/{id}", api.authenticated(api.deleteListing))
		r.Post("/items/{id}/restock", api.authenticated(api.restockListing))
		r.Post("/items/{id}/price", api.authenticated(api.updateListingPrice))
	})
}

func (a profileAPI) authenticated(next func(http.ResponseWriter, *http.Request, int64)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if (r.Method == http.MethodPost || r.Method == http.MethodDelete) && (r.Header.Get("X-Game-Market-Request") != "1" || r.Header.Get("Sec-Fetch-Site") == "cross-site") {
			fail(w, 403, "Request rejected.")
			return
		}
		digest := sessionDigest(r)
		if digest == nil {
			fail(w, 401, "Sign in to continue.")
			return
		}
		var id int64
		err := a.db.GetContext(r.Context(), &id, "SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at > now()", digest)
		if errors.Is(err, sql.ErrNoRows) {
			fail(w, 401, "Sign in to continue.")
			return
		}
		if err != nil {
			a.internal(w, r, err)
			return
		}
		next(w, r, id)
	}
}

func readProfileJSON(w http.ResponseWriter, r *http.Request, limit int64, destination any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	d.DisallowUnknownFields()
	if err := d.Decode(destination); err != nil || d.Decode(new(any)) != io.EOF {
		fail(w, 400, "Invalid request data.")
		return false
	}
	return true
}

func (a profileAPI) profile(w http.ResponseWriter, r *http.Request, id int64) {
	var profile accountProfile
	if err := a.db.GetContext(r.Context(), &profile, "SELECT id,email,display_name,avatar IS NOT NULL has_avatar FROM users WHERE id=$1", id); err != nil {
		a.internal(w, r, err)
		return
	}
	reply(w, 200, profile)
}

func (a profileAPI) update(w http.ResponseWriter, r *http.Request, id int64) {
	var input struct {
		Name   string
		Avatar *string
	}
	if !readProfileJSON(w, r, int64(base64.StdEncoding.EncodedLen(maxAvatar)+4096), &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if utf8.RuneCountInString(input.Name) > 60 || strings.ContainsRune(input.Name, 0) {
		fail(w, 400, "Use a name of up to 60 characters.")
		return
	}
	var data []byte
	var mimeType *string
	var avatar any
	if input.Avatar != nil && *input.Avatar != "" {
		var err error
		data, err = base64.StdEncoding.DecodeString(*input.Avatar)
		if err != nil || len(data) > maxAvatar {
			fail(w, 400, "Choose a JPEG or PNG up to 256 KB.")
			return
		}
		config, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || (format != "png" && format != "jpeg") || config.Width > 2048 || config.Height > 2048 || config.Width < 1 || config.Height < 1 {
			fail(w, 400, "Choose a JPEG or PNG up to 2048 pixels on each side.")
			return
		}
		if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
			fail(w, 400, "The image could not be decoded.")
			return
		}
		value := "image/" + format
		mimeType = &value
		avatar = data
	}
	var profile accountProfile
	err := a.db.GetContext(r.Context(), &profile, `UPDATE users SET display_name=$1,
        avatar=CASE WHEN $2 THEN $3 ELSE avatar END,
        avatar_type=CASE WHEN $2 THEN $4 ELSE avatar_type END WHERE id=$5
        RETURNING id,email,display_name,avatar IS NOT NULL has_avatar`, input.Name, input.Avatar != nil, avatar, mimeType, id)
	if err != nil {
		a.internal(w, r, err)
		return
	}
	reply(w, 200, profile)
}

func (a profileAPI) avatar(w http.ResponseWriter, r *http.Request, id int64) {
	var data []byte
	var mimeType string
	err := a.db.QueryRowContext(r.Context(), "SELECT avatar,avatar_type FROM users WHERE id=$1 AND avatar IS NOT NULL", id).Scan(&data, &mimeType)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "Profile picture not found.")
		return
	}
	if err != nil {
		a.internal(w, r, err)
		return
	}
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(data)
}

func (a profileAPI) password(w http.ResponseWriter, r *http.Request, id int64) {
	var input struct {
		Current string
		New     string
	}
	if !readProfileJSON(w, r, 4096, &input) {
		return
	}
	if len(input.Current) > 72 || len(input.New) > 72 || utf8.RuneCountInString(input.New) < 8 || input.Current == input.New {
		fail(w, 400, "Choose a different password with at least 8 characters and at most 72 bytes.")
		return
	}
	ctx := r.Context()
	var oldHash string
	if err := a.db.GetContext(ctx, &oldHash, "SELECT password_hash FROM users WHERE id=$1", id); err != nil {
		a.internal(w, r, err)
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(oldHash), []byte(input.Current)) != nil {
		fail(w, 400, "Current password is incorrect.")
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(input.New), bcrypt.DefaultCost)
	if err != nil {
		a.internal(w, r, err)
		return
	}
	tx, err := a.db.BeginTxx(ctx, nil)
	if err != nil {
		a.internal(w, r, err)
		return
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, "UPDATE users SET password_hash=$1 WHERE id=$2 AND password_hash=$3", string(newHash), id, oldHash)
	if err != nil {
		a.internal(w, r, err)
		return
	}
	count, err := result.RowsAffected()
	if err != nil {
		a.internal(w, r, err)
		return
	}
	if count != 1 {
		fail(w, 409, "Password changed. Sign in again.")
		return
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2", id, sessionDigest(r)); err != nil {
		a.internal(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		a.internal(w, r, err)
		return
	}
	w.WriteHeader(204)
}

type orderSummary struct {
	ID      int64  `db:"id" json:"id"`
	Total   int64  `db:"total_cents" json:"totalCents"`
	Created string `db:"created_at" json:"createdAt"`
}

func (a profileAPI) orders(w http.ResponseWriter, r *http.Request, id int64) {
	orders := []orderSummary{}
	before := int64(9223372036854775807)
	if raw := r.URL.Query().Get("before"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 1 {
			fail(w, 400, "Invalid history page.")
			return
		}
		before = parsed
	}
	if err := a.db.SelectContext(r.Context(), &orders, "SELECT id,total_cents,created_at FROM orders WHERE user_id=$1 AND id<$2 ORDER BY id DESC LIMIT 21", id, before); err != nil {
		a.internal(w, r, err)
		return
	}
	var next int64
	if len(orders) > 20 {
		orders = orders[:20]
		next = orders[len(orders)-1].ID
	}
	reply(w, 200, map[string]any{"items": orders, "next": next})
}

func (a profileAPI) order(w http.ResponseWriter, r *http.Request, id int64) {
	orderID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || orderID < 1 {
		fail(w, 404, "Order not found.")
		return
	}
	var order orderSummary
	err = a.db.GetContext(r.Context(), &order, "SELECT id,total_cents,created_at FROM orders WHERE id=$1 AND user_id=$2", orderID, id)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "Order not found.")
		return
	}
	if err != nil {
		a.internal(w, r, err)
		return
	}
	items, err := receiptItems(r, a.db, orderID)
	if err != nil {
		a.internal(w, r, err)
		return
	}
	reply(w, 200, struct {
		orderSummary
		Items []receiptItem `json:"items"`
	}{order, items})
}

type listing struct {
	OriginalPrice int    `db:"original_price_cents" json:"originalPriceCents"`
	Discount      int    `db:"discount_percent" json:"discountPercent"`
	ID            string `db:"id" json:"id"`
	Title         string `db:"title" json:"title"`
	Price         int    `db:"price_cents" json:"priceCents"`
	Stock         int    `db:"stock" json:"stock"`
}

func (a profileAPI) listings(w http.ResponseWriter, r *http.Request, id int64) {
	items := []listing{}
	err := a.db.SelectContext(r.Context(), &items, `SELECT p.id,p.title,o.effective_price_cents AS price_cents,o.price_cents AS original_price_cents,o.discount_percent,count(k.id) stock
        FROM offers o JOIN products p ON p.id=o.product_id JOIN sellers s ON s.id=o.seller_id
        LEFT JOIN inventory_keys k ON k.offer_id=o.id AND k.redeemed_at IS NULL
        WHERE s.owner_id=$1 AND p.deleted_at IS NULL AND o.deleted_at IS NULL GROUP BY p.id,o.id ORDER BY p.title,p.id`, id)
	if err != nil {
		a.internal(w, r, err)
		return
	}
	reply(w, 200, items)
}

func (a profileAPI) createListing(w http.ResponseWriter, r *http.Request, id int64) {
	var input struct {
		Title, Description, Platform, Region string
		PriceCents                           int
		Quantity                             *int
	}
	if !readProfileJSON(w, r, 8192, &input) {
		return
	}
	quantity := 1
	if input.Quantity != nil {
		quantity = *input.Quantity
	}
	if quantity < 0 || quantity > 100 {
		fail(w, 400, "Enter a quantity from 0 to 100.")
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	if input.Title == "" || utf8.RuneCountInString(input.Title) > 100 || input.Description == "" ||
		utf8.RuneCountInString(input.Description) > 1000 || strings.ContainsRune(input.Title+input.Description, 0) ||
		input.PriceCents < 1 || input.PriceCents > 1000000 ||
		(input.Platform != "Steam" && input.Platform != "Xbox" && input.Platform != "GOG") || (input.Region != "Global" && input.Region != "Europe") {
		fail(w, 400, "Check the title, description, platform, region and price.")
		return
	}
	var suffix [16]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		a.internal(w, r, err)
		return
	}
	productID := "listing-" + hex.EncodeToString(suffix[:])
	var product struct {
		ID    string `db:"id"`
		Title string `db:"title"`
	}
	ctx := r.Context()
	tx, err := a.db.BeginTxx(ctx, nil)
	if err != nil {
		a.internal(w, r, err)
		return
	}
	defer tx.Rollback()
	if err = tx.GetContext(ctx, &product, `INSERT INTO products(id,title,platform,region,description,activation,owner_id)
        VALUES($1,$2,$3,$4,$5,'This listing issues a demonstration key.',$6)
 ON CONFLICT ((lower(btrim(title))),platform,region) WHERE deleted_at IS NULL
 DO UPDATE SET title=products.title RETURNING id,title`, productID, input.Title, input.Platform, input.Region, input.Description, id); err != nil {
		a.internal(w, r, err)
		return
	}
	var seller, offer int64
	if err = tx.GetContext(ctx, &seller, `INSERT INTO sellers(name,rating,owner_id) VALUES($1,0,$2)
        ON CONFLICT(owner_id) DO UPDATE SET owner_id=EXCLUDED.owner_id RETURNING id`, "Member #"+strconv.FormatInt(id, 10), id); err != nil {
		a.internal(w, r, err)
		return
	}
	if err = tx.GetContext(ctx, &offer, "INSERT INTO offers(product_id,seller_id,price_cents) VALUES($1,$2,$3) ON CONFLICT (product_id,seller_id) WHERE deleted_at IS NULL DO NOTHING RETURNING id", product.ID, seller, input.PriceCents); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			fail(w, 409, "You already have an offer for this game.")
			return
		}
		a.internal(w, r, err)
		return
	}
	if err = addListingKeys(ctx, tx, offer, suffix, quantity); err != nil {
		a.internal(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		a.internal(w, r, err)
		return
	}
	reply(w, 201, listing{ID: product.ID, Title: product.Title, Price: input.PriceCents, OriginalPrice: input.PriceCents, Stock: quantity})
}
