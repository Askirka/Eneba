package main

import (
	"database/sql"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
)

type productComment struct {
	ID        int64     `db:"id" json:"id"`
	Author    string    `db:"author" json:"author"`
	Body      string    `db:"body" json:"body"`
	CreatedAt time.Time `db:"created_at" json:"createdAt"`
}

func (a profileAPI) comments(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	before := int64(math.MaxInt64)
	if value := r.URL.Query().Get("before"); value != "" {
		cursor, err := strconv.ParseInt(value, 10, 64)
		if err != nil || cursor < 1 {
			fail(w, 400, "Invalid comments page.")
			return
		}
		before = cursor
	}
	ctx := r.Context()
	var found string
	err := a.db.GetContext(ctx, &found, "SELECT id FROM products WHERE id=$1 AND deleted_at IS NULL", id)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "Game not found.")
		return
	}
	if err != nil {
		a.internal(w, r, err)
		return
	}
	items := []productComment{}
	err = a.db.SelectContext(ctx, &items, `SELECT c.id,COALESCE(NULLIF(u.display_name,''),'Member #' || u.id) AS author,
        c.body,c.created_at FROM product_comments c JOIN users u ON u.id=c.user_id
        JOIN products p ON p.id=c.product_id
        WHERE p.id=$1 AND p.deleted_at IS NULL AND c.id<$2 ORDER BY c.id DESC LIMIT 21`, id, before)
	if err != nil {
		a.internal(w, r, err)
		return
	}
	var next int64
	if len(items) > 20 {
		items = items[:20]
		next = items[len(items)-1].ID
	}
	reply(w, 200, map[string]any{"items": items, "next": next})
}

func (a profileAPI) addComment(w http.ResponseWriter, r *http.Request, user int64) {
	var input struct {
		Body string `json:"body"`
	}
	if !readProfileJSON(w, r, 8192, &input) {
		return
	}
	body := strings.TrimSpace(input.Body)
	if body == "" || utf8.RuneCountInString(body) > 1000 || strings.ContainsRune(body, 0) {
		fail(w, 400, "Enter a comment of 1 to 1,000 characters.")
		return
	}
	var comment productComment
	err := a.db.GetContext(r.Context(), &comment, `
        WITH added AS (
            INSERT INTO product_comments(product_id,user_id,body)
            SELECT id,$2,$3 FROM products WHERE id=$1 AND deleted_at IS NULL FOR SHARE
            RETURNING id,user_id,body,created_at
        )
        SELECT c.id,COALESCE(NULLIF(u.display_name,''),'Member #' || u.id) AS author,c.body,c.created_at
        FROM added c JOIN users u ON u.id=c.user_id`, chi.URLParam(r, "id"), user, body)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "Game not found.")
		return
	}
	if err != nil {
		a.internal(w, r, err)
		return
	}
	reply(w, 201, comment)
}
