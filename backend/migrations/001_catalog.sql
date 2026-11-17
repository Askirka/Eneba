-- +goose Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE platforms (name text PRIMARY KEY);
CREATE TABLE regions (name text PRIMARY KEY);
CREATE TABLE products (
    id text PRIMARY KEY,
    title text NOT NULL,
    platform text NOT NULL REFERENCES platforms,
    region text NOT NULL REFERENCES regions,
    description text NOT NULL,
    activation text NOT NULL
);
CREATE INDEX products_title_trgm ON products USING gin (title gin_trgm_ops);
CREATE TABLE sellers (id integer PRIMARY KEY, name text UNIQUE NOT NULL, rating numeric(3,2) NOT NULL CHECK (rating BETWEEN 0 AND 5));
CREATE TABLE offers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id text NOT NULL REFERENCES products,
    seller_id integer NOT NULL REFERENCES sellers,
    price_cents integer NOT NULL CHECK (price_cents > 0),
    UNIQUE (product_id, seller_id)
);
CREATE TABLE inventory_keys (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    offer_id bigint NOT NULL REFERENCES offers,
    code text UNIQUE NOT NULL,
    redeemed_at timestamptz
);
CREATE INDEX available_inventory ON inventory_keys (offer_id, id) WHERE redeemed_at IS NULL;
CREATE TABLE homepage_blocks (
    type text PRIMARY KEY CHECK (type IN ('hero', 'best_sellers', 'deals')),
    position integer UNIQUE NOT NULL,
    title text NOT NULL,
    copy text NOT NULL DEFAULT '',
    cta_label text NOT NULL,
    cta_url text NOT NULL
);
CREATE TABLE homepage_products (
    block_type text NOT NULL REFERENCES homepage_blocks,
    position integer NOT NULL,
    product_id text NOT NULL REFERENCES products,
    PRIMARY KEY (block_type, position),
    UNIQUE (block_type, product_id)
);

-- +goose Down
DROP TABLE homepage_products, homepage_blocks, inventory_keys, offers, sellers, products, regions, platforms;
