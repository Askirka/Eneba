package catalog

import (
	"context"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

var ErrFilters = errors.New("Invalid catalog filters.")

type Service struct{ Repository }

func (s Service) Search(ctx context.Context, query url.Values) ([]Product, int, Filter, error) {
	f := Filter{Search: strings.TrimSpace(query.Get("q")), Platform: query.Get("platform"), Region: query.Get("region"), Sort: query.Get("sort"), Page: 1, Limit: 12, Deals: query.Get("deals") == "1"}
	if utf8.RuneCountInString(f.Search) > 100 || len(f.Platform) > 40 || len(f.Region) > 40 {
		return nil, 0, f, ErrFilters
	}
	for _, field := range []struct {
		name     string
		value    *int
		min, max int
	}{
		{"page", &f.Page, 1, 1000}, {"limit", &f.Limit, 1, 48}, {"min", &f.Min, 0, 1000000}, {"max", &f.Max, 0, 1000000},
	} {
		if raw := query.Get(field.name); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < field.min || n > field.max {
				return nil, 0, f, ErrFilters
			}
			*field.value = n
		}
	}
	switch f.Sort {
	case "", "relevance", "price_asc", "price_desc", "title":
	default:
		return nil, 0, f, ErrFilters
	}
	if f.Max > 0 && f.Max < f.Min {
		return nil, 0, f, ErrFilters
	}
	escaped := strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(f.Search)
	products, total, err := s.List(ctx, f, escaped)
	return products, total, f, err
}
