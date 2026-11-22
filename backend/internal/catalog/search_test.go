package catalog

import (
	"context"
	"net/url"
	"os"
	"testing"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
)

func TestSearchAgainstPostgres(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to a migrated demo database")
	}
	db, err := sqlx.Connect("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	service := Service{Repository{DB: db}}
	cases := []struct{ query, id string }{
		{"Cyberpunk 2077", "cyberpunk-2077"},
		{"cyber", "cyberpunk-2077"},
		{"cyberpnk", "cyberpunk-2077"},
		{"witchr", "the-witcher-3"},
	}
	for _, tc := range cases {
		t.Run(tc.query, func(t *testing.T) {
			items, _, _, err := service.Search(context.Background(), url.Values{"q": {tc.query}})
			if err != nil {
				t.Fatal(err)
			}
			if len(items) == 0 || items[0].ID != tc.id {
				t.Fatalf("expected first result %s, got %v", tc.id, items)
			}
		})
	}
	items, _, _, err := service.Search(context.Background(), url.Values{"q": {"%_"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatal("search treated SQL wildcard characters as wildcards")
	}
}
