-- +goose Up
ALTER TABLE offers ADD COLUMN discount_percent integer NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 99);
ALTER TABLE offers ADD COLUMN effective_price_cents integer GENERATED ALWAYS AS (
    GREATEST(1, (price_cents::bigint * (100 - discount_percent) + 50) / 100)
) STORED;

-- +goose Down
ALTER TABLE offers DROP COLUMN effective_price_cents, DROP COLUMN discount_percent;
