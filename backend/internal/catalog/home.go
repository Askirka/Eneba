package catalog

import "context"

type Banner struct {
	ID    int    `db:"id" json:"id"`
	Title string `db:"title" json:"title"`
	Copy  string `db:"copy" json:"copy"`
	Label string `db:"cta_label" json:"label"`
	URL   string `db:"cta_url" json:"url"`
	Image string `db:"image_path" json:"image"`
}

func (r Repository) Banners(ctx context.Context) ([]Banner, error) {
	banners := []Banner{}
	err := r.DB.SelectContext(ctx, &banners, "SELECT id,title,copy,cta_label,cta_url,image_path FROM home_banners ORDER BY id")
	return banners, err
}

func (r Repository) HomeBlock(ctx context.Context, kind string) (Block, error) {
	var block Block
	if err := r.DB.GetContext(ctx, &block, "SELECT type,title,copy,cta_label,cta_url FROM homepage_blocks WHERE type=$1", kind); err != nil {
		return block, err
	}
	if kind != "deals" {
		items, err := r.BlockProducts(ctx, kind)
		block.Products = items
		return block, err
	}
	block.Products = []Product{}
	err := r.DB.SelectContext(ctx, &block.Products, productQuery+
		" WHERE p.deleted_at IS NULL AND best.discount_percent>0 ORDER BY best.discount_percent DESC, best.price_cents, p.id LIMIT 4")
	return block, err
}
