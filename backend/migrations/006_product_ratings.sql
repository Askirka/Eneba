-- +goose Up
ALTER TABLE products ADD COLUMN deleted_at timestamptz;
CREATE TABLE product_ratings (
    product_id text NOT NULL REFERENCES products,
    user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
    grade smallint NOT NULL CHECK (grade BETWEEN 0 AND 10),
    PRIMARY KEY (product_id, user_id)
);

-- +goose Down
DROP TABLE product_ratings;
ALTER TABLE products DROP COLUMN deleted_at;
