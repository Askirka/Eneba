package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"eneba-starter/internal/catalog"
	"eneba-starter/migrations"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
	"github.com/pressly/goose/v3"
	"go.uber.org/zap"
)

func main() {
	log := zap.Must(zap.NewProduction())
	defer log.Sync()
	if err := run(log); err != nil {
		log.Error("server stopped", zap.Error(err))
		os.Exit(1)
	}
}

func run(log *zap.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	db, err := connectDatabase(startup, os.Getenv("DATABASE_URL"))
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(10)
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	if err := goose.UpContext(startup, db.DB, "."); err != nil {
		return err
	}

	service := catalog.Service{Repository: catalog.Repository{DB: db}}
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.Recoverer, middleware.Timeout(5*time.Second))
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { reply(w, 200, map[string]string{"status": "ok"}) })
	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if db.PingContext(r.Context()) != nil {
			fail(w, 503, "Database unavailable.")
			return
		}
		reply(w, 200, map[string]string{"status": "ready"})
	})
	internal := func(w http.ResponseWriter, r *http.Request, err error) {
		log.Error("request failed", zap.String("request_id", middleware.GetReqID(r.Context())), zap.Error(err))
		fail(w, 500, "Something went wrong.")
	}
	if err := mountAuth(r, db, os.Getenv("SESSION_COOKIE_SECURE") == "true", internal); err != nil {
		return err
	}
	r.Get("/api/home", func(w http.ResponseWriter, r *http.Request) {
		blocks, err := service.Home(r.Context(), func(block string, err error) {
			log.Warn("homepage block failed", zap.String("block", block), zap.Error(err))
		})
		if err != nil {
			internal(w, r, err)
			return
		}
		reply(w, 200, blocks)
	})
	list := func(w http.ResponseWriter, r *http.Request) {
		items, total, f, err := service.Search(r.Context(), r.URL.Query())
		if errors.Is(err, catalog.ErrFilters) {
			fail(w, 400, err.Error())
			return
		}
		if err != nil {
			internal(w, r, err)
			return
		}
		reply(w, 200, map[string]any{"items": items, "total": total, "page": f.Page, "limit": f.Limit})
	}
	r.Get("/api/products", list)
	r.Get("/api/search", list)
	r.Get("/api/products/{id}", func(w http.ResponseWriter, r *http.Request) {
		product, offers, err := service.Detail(r.Context(), chi.URLParam(r, "id"))
		if errors.Is(err, sql.ErrNoRows) {
			fail(w, 404, "Game not found.")
			return
		}
		if err != nil {
			internal(w, r, err)
			return
		}
		reply(w, 200, map[string]any{"product": product, "offers": offers})
	})
	r.NotFound(func(w http.ResponseWriter, _ *http.Request) { fail(w, 404, "Endpoint not found.") })
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	server := &http.Server{Addr: ":" + port, Handler: r, ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	stopped := make(chan error, 1)
	go func() { stopped <- server.ListenAndServe() }()
	log.Info("listening", zap.String("address", server.Addr))
	select {
	case err := <-stopped:
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func fail(w http.ResponseWriter, status int, message string) {
	reply(w, status, map[string]string{"error": message})
}

func connectDatabase(ctx context.Context, dsn string) (*sqlx.DB, error) {
	retry := time.NewTicker(time.Second)
	defer retry.Stop()
	for {
		db, err := sqlx.ConnectContext(ctx, "postgres", dsn)
		if err == nil {
			return db, nil
		}
		if db != nil {
			_ = db.Close()
		}
		select {
		case <-ctx.Done():
			return nil, err
		case <-retry.C:
		}
	}
}
