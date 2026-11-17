package catalog

import (
	"context"
	"github.com/jmoiron/sqlx"
)

type Product struct {
	BestOfferID *int64 `db:"offer_id" json:"bestOfferId"`
	ID          string `db:"id" json:"id"`
	Title       string `db:"title" json:"title"`
	Platform    string `db:"platform" json:"platform"`
	Region      string `db:"region" json:"region"`
	Price       *int   `db:"price_cents" json:"priceCents"`
	Description string `db:"description" json:"description"`
	Activation  string `db:"activation" json:"activation"`
}

type Offer struct {
	ID     int64   `db:"id" json:"id"`
	Seller string  `db:"seller" json:"seller"`
	Rating float64 `db:"rating" json:"rating"`
	Price  int     `db:"price_cents" json:"priceCents"`
	Stock  int     `db:"stock" json:"stock"`
}

type Block struct {
	Type     string    `db:"type" json:"type"`
	Title    string    `db:"title" json:"title"`
	Copy     string    `db:"copy" json:"copy"`
	Label    string    `db:"cta_label" json:"label"`
	URL      string    `db:"cta_url" json:"url"`
	Products []Product `db:"-" json:"products"`
}

type Filter struct {
	Search, Platform, Region, Sort string
	Min, Max, Page, Limit          int
}

type Repository struct{ DB *sqlx.DB }

const productQuery = `SELECT p.id, p.title, p.platform, p.region, p.description, p.activation, best.price_cents, best.offer_id FROM products p
LEFT JOIN LATERAL (
    SELECT o.price_cents, o.id AS offer_id
    FROM offers o WHERE o.product_id = p.id AND EXISTS (
        SELECT 1 FROM inventory_keys k WHERE k.offer_id = o.id AND k.redeemed_at IS NULL
    )
ORDER BY o.price_cents, o.id LIMIT 1
) best ON true`

const filterQuery = ` WHERE
($1 = '' OR p.title ILIKE '%' || $2 || '%' ESCAPE '!' OR (length($1) >= 3 AND word_similarity($1,p.title) >= 0.38))
AND ($3 = '' OR p.platform = $3)
AND ($4 = '' OR p.region = $4)
AND ($5::integer = 0 OR best.price_cents >= $5)
AND ($6::integer = 0 OR best.price_cents <= $6)`

func (r Repository) List(ctx context.Context, f Filter, escapedSearch string) ([]Product, int, error) {
	args := []any{f.Search, escapedSearch, f.Platform, f.Region, f.Min, f.Max}
	rank := `CASE WHEN lower(title) = lower($1) THEN 0 WHEN title ILIKE '%' || $2 || '%' ESCAPE '!' THEN 1 ELSE 2 END, word_similarity($1,title) DESC, title`
	orders := map[string]string{"relevance": rank, "price_asc": "price_cents ASC NULLS LAST", "price_desc": "price_cents DESC NULLS LAST", "title": "title ASC"}
	order, ok := orders[f.Sort]
	if !ok {
		order = rank
	}
	var total int
	if err := r.DB.GetContext(ctx, &total, "SELECT count(*) FROM ("+productQuery+filterQuery+") matching", args...); err != nil {
		return nil, 0, err
	}
	products := []Product{}
	args = append(args, f.Limit, (f.Page-1)*f.Limit)
	err := r.DB.SelectContext(ctx, &products, productQuery+filterQuery+" ORDER BY "+order+", id LIMIT $7 OFFSET $8", args...)
	return products, total, err
}

func (r Repository) Detail(ctx context.Context, id string) (Product, []Offer, error) {
	var product Product
	if err := r.DB.GetContext(ctx, &product, productQuery+" WHERE p.id=$1", id); err != nil {
		return product, nil, err
	}
	offers := []Offer{}
	err := r.DB.SelectContext(ctx, &offers, `SELECT o.id,s.name seller,s.rating,o.price_cents,count(k.id) stock
 FROM offers o JOIN sellers s ON s.id=o.seller_id
 LEFT JOIN inventory_keys k ON k.offer_id=o.id AND k.redeemed_at IS NULL
 WHERE o.product_id=$1 GROUP BY o.id,s.id ORDER BY o.price_cents,o.id`, id)
	return product, offers, err
}

func (r Repository) Blocks(ctx context.Context) ([]Block, error) {
	blocks := []Block{}
	err := r.DB.SelectContext(ctx, &blocks, "SELECT type,title,copy,cta_label,cta_url FROM homepage_blocks ORDER BY position")
	return blocks, err
}

func (r Repository) BlockProducts(ctx context.Context, blockType string) ([]Product, error) {
	products := []Product{}
	err := r.DB.SelectContext(ctx, &products, productQuery+` JOIN homepage_products hp ON hp.product_id=p.id
 WHERE hp.block_type=$1 ORDER BY hp.position`, blockType)
	return products, err
}
