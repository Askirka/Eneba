package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/mail"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

const sessionCookie = "game_market_session"
const sessionLifetime = 7 * 24 * time.Hour

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type account struct {
	ID    int64  `db:"id" json:"id"`
	Email string `db:"email" json:"email"`
}

type authHandler struct {
	db        *sqlx.DB
	secure    bool
	dummyHash []byte
	internal  func(http.ResponseWriter, *http.Request, error)
}

func mountAuth(r chi.Router, db *sqlx.DB, secure bool, internal func(http.ResponseWriter, *http.Request, error)) error {
	dummyHash, err := bcrypt.GenerateFromPassword([]byte("unused-password-for-timing"), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	auth := authHandler{db: db, secure: secure, dummyHash: dummyHash, internal: internal}
	attempts := &authLimiter{attempts: make(map[string]int)}
	r.Route("/api/auth", func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "no-store")
				if r.Method == http.MethodPost && (r.Header.Get("X-Game-Market-Request") != "1" || r.Header.Get("Sec-Fetch-Site") == "cross-site") {
					fail(w, http.StatusForbidden, "Request rejected.")
					return
				}
				next.ServeHTTP(w, r)
			})
		})
		r.With(attempts.limit).Post("/register", auth.register)
		r.With(attempts.limit).Post("/login", auth.login)
		r.Post("/logout", auth.logout)
		r.Get("/me", auth.me)
	})
	return nil
}

// The direct API has a bounded per-peer limit. The web proxy also limits by client IP.
type authLimiter struct {
	mu       sync.Mutex
	window   time.Time
	attempts map[string]int
}

func (l *authLimiter) limit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			host = r.RemoteAddr
		}
		now := time.Now()
		l.mu.Lock()
		if now.Sub(l.window) >= time.Minute {
			clear(l.attempts)
			l.window = now
		}
		allowed := l.attempts[host] < 60 && (len(l.attempts) < 4096 || l.attempts[host] > 0)
		if allowed {
			l.attempts[host]++
		}
		l.mu.Unlock()
		if !allowed {
			w.Header().Set("Retry-After", "60")
			fail(w, http.StatusTooManyRequests, "Too many attempts. Try again in a minute.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func readCredentials(w http.ResponseWriter, r *http.Request) (credentials, bool) {
	var input credentials
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaType != "application/json" {
		fail(w, http.StatusUnsupportedMediaType, "Use application/json.")
		return input, false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || decoder.Decode(new(any)) != io.EOF {
		fail(w, http.StatusBadRequest, "Invalid request body.")
		return input, false
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	address, err := mail.ParseAddress(input.Email)
	if err != nil || address.Address != input.Email || len(input.Email) > 254 || len(input.Password) == 0 || len(input.Password) > 72 {
		fail(w, http.StatusBadRequest, "Enter a valid email and a password of at most 72 bytes.")
		return input, false
	}
	return input, true
}

func (a authHandler) register(w http.ResponseWriter, r *http.Request) {
	input, ok := readCredentials(w, r)
	if !ok {
		return
	}
	if len([]rune(input.Password)) < 8 {
		fail(w, http.StatusBadRequest, "Use at least eight characters for your password.")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
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
	var user account
	err = tx.GetContext(ctx, &user, "INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id,email", input.Email, string(hash))
	var pgError *pq.Error
	if errors.As(err, &pgError) && pgError.Code == "23505" {
		fail(w, http.StatusConflict, "An account already exists for this email.")
		return
	}
	if err != nil {
		a.internal(w, r, err)
		return
	}
	a.finishSignIn(w, r, tx, user, http.StatusCreated)
}

func (a authHandler) login(w http.ResponseWriter, r *http.Request) {
	input, ok := readCredentials(w, r)
	if !ok {
		return
	}
	var user account
	var hash string
	err := a.db.QueryRowContext(r.Context(), "SELECT id,email,password_hash FROM users WHERE email=$1", input.Email).Scan(&user.ID, &user.Email, &hash)
	missing := errors.Is(err, sql.ErrNoRows)
	if err != nil && !missing {
		a.internal(w, r, err)
		return
	}
	if missing {
		hash = string(a.dummyHash)
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(input.Password)) != nil || missing {
		fail(w, http.StatusUnauthorized, "Email or password is incorrect.")
		return
	}

	tx, err := a.db.BeginTxx(r.Context(), nil)
	if err != nil {
		a.internal(w, r, err)
		return
	}
	defer tx.Rollback()
	a.finishSignIn(w, r, tx, user, http.StatusOK)
}

func (a authHandler) finishSignIn(w http.ResponseWriter, r *http.Request, tx *sqlx.Tx, user account, status int) {
	var secret [32]byte
	if _, err := rand.Read(secret[:]); err != nil {
		a.internal(w, r, err)
		return
	}
	token := base64.RawURLEncoding.EncodeToString(secret[:])
	digest := sha256.Sum256(secret[:])
	expires := time.Now().Add(sessionLifetime)
	ctx := r.Context()
	if err := deleteSession(ctx, tx, r); err != nil {
		a.internal(w, r, err)
		return
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at <= now()"); err != nil {
		a.internal(w, r, err)
		return
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)", digest[:], user.ID, expires); err != nil {
		a.internal(w, r, err)
		return
	}
	if err := tx.Commit(); err != nil {
		a.internal(w, r, err)
		return
	}
	http.SetCookie(w, a.cookie(token, expires, int(sessionLifetime.Seconds())))
	reply(w, status, user)
}

func sessionDigest(r *http.Request) []byte {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil
	}
	secret, err := base64.RawURLEncoding.Strict().DecodeString(cookie.Value)
	if err != nil || len(secret) != 32 {
		return nil
	}
	digest := sha256.Sum256(secret)
	return digest[:]
}

func deleteSession(ctx context.Context, db interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, r *http.Request) error {
	digest := sessionDigest(r)
	if digest == nil {
		return nil
	}
	_, err := db.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash=$1", digest)
	return err
}

func (a authHandler) cookie(value string, expires time.Time, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name: sessionCookie, Value: value, Path: "/", Expires: expires, MaxAge: maxAge,
		HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteLaxMode,
	}
}

func (a authHandler) logout(w http.ResponseWriter, r *http.Request) {
	if err := deleteSession(r.Context(), a.db, r); err != nil {
		a.internal(w, r, err)
		return
	}
	http.SetCookie(w, a.cookie("", time.Unix(0, 0), -1))
	w.WriteHeader(http.StatusNoContent)
}

func (a authHandler) me(w http.ResponseWriter, r *http.Request) {
	digest := sessionDigest(r)
	if digest == nil {
		fail(w, http.StatusUnauthorized, "Sign in to continue.")
		return
	}
	var user account
	err := a.db.GetContext(r.Context(), &user, `SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=$1 AND s.expires_at > now()`, digest)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, http.StatusUnauthorized, "Sign in to continue.")
		return
	}
	if err != nil {
		a.internal(w, r, err)
		return
	}
	reply(w, http.StatusOK, user)
}
