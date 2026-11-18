package catalog

import "context"

type Seller struct {
	ID     int64   `db:"id" json:"id"`
	Name   string  `db:"name" json:"name"`
	Rating float64 `db:"rating" json:"rating"`
}

func (r Repository) SellerProducts(ctx context.Context, id int64, page int) (Seller, []Product, bool, error) {
	var seller Seller
	if err := r.DB.GetContext(ctx, &seller, "SELECT id,name,rating FROM sellers WHERE id=$1", id); err != nil {
		return seller, nil, false, err
	}
	const pageSize = 12
	items := []Product{}
	err := r.DB.SelectContext(ctx, &items, `
        SELECT p.id,p.title,p.platform,p.region,p.description,p.activation,
               CASE WHEN available.has_keys THEN o.effective_price_cents END AS price_cents,
 CASE WHEN available.has_keys THEN o.price_cents END AS original_price_cents,
 CASE WHEN available.has_keys THEN o.discount_percent ELSE 0 END AS discount_percent,
               CASE WHEN available.has_keys THEN o.id END AS offer_id
        FROM offers o JOIN products p ON p.id=o.product_id
        CROSS JOIN LATERAL (SELECT EXISTS (
            SELECT 1 FROM inventory_keys k WHERE k.offer_id=o.id AND k.redeemed_at IS NULL
        ) AS has_keys) available
        WHERE o.seller_id=$1 AND o.deleted_at IS NULL AND p.deleted_at IS NULL
        ORDER BY p.title,p.id LIMIT $2 OFFSET $3`, id, pageSize+1, (page-1)*pageSize)
	if err != nil {
		return seller, nil, false, err
	}
	next := len(items) > pageSize && page < 1000
	if len(items) > pageSize {
		items = items[:pageSize]
	}
	return seller, items, next, nil
}
