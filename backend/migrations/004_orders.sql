-- +goose Up
CREATE TABLE orders (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users,
    request_id uuid NOT NULL,
    request_hash bytea NOT NULL,
    total_cents bigint NOT NULL CHECK (total_cents > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, request_id)
);
CREATE TABLE order_items (
    order_id bigint NOT NULL REFERENCES orders,
    key_id bigint NOT NULL UNIQUE REFERENCES inventory_keys,
    title text NOT NULL,
    seller text NOT NULL,
    price_cents integer NOT NULL CHECK (price_cents > 0),
    PRIMARY KEY (order_id, key_id)
);

-- +goose Down
DROP TABLE order_items, orders;
