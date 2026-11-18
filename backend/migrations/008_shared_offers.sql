-- +goose Up
ALTER TABLE offers ADD COLUMN deleted_at timestamptz;
ALTER TABLE offers DROP CONSTRAINT offers_product_id_seller_id_key;

CREATE TEMP TABLE shared_catalog ON COMMIT DROP AS
SELECT id, first_value(id) OVER (
    PARTITION BY lower(btrim(title)), platform, region
    ORDER BY (owner_id IS NOT NULL), id
) AS canonical_id
FROM products WHERE deleted_at IS NULL;

-- Prefer the offer already attached to the canonical product for each seller.
WITH ranked AS (
    SELECT o.id, row_number() OVER (
        PARTITION BY c.canonical_id, o.seller_id
        ORDER BY (o.product_id <> c.canonical_id), o.id
    ) AS position
    FROM offers o JOIN shared_catalog c ON c.id=o.product_id
)
UPDATE offers o SET deleted_at=now() FROM ranked r WHERE o.id=r.id AND r.position>1;

UPDATE offers o SET product_id=c.canonical_id FROM shared_catalog c
WHERE o.product_id=c.id AND c.id<>c.canonical_id AND o.deleted_at IS NULL;

INSERT INTO product_ratings(product_id,user_id,grade)
SELECT c.canonical_id,r.user_id,r.grade
FROM product_ratings r JOIN shared_catalog c ON c.id=r.product_id
WHERE c.id<>c.canonical_id ORDER BY r.product_id
ON CONFLICT(product_id,user_id) DO NOTHING;

UPDATE product_comments m SET product_id=c.canonical_id FROM shared_catalog c
WHERE m.product_id=c.id AND c.id<>c.canonical_id;

UPDATE products p SET deleted_at=now() FROM shared_catalog c
WHERE p.id=c.id AND c.id<>c.canonical_id;

CREATE UNIQUE INDEX active_products_identity ON products ((lower(btrim(title))), platform, region)
WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX active_offer_per_seller ON offers (product_id,seller_id) WHERE deleted_at IS NULL;
