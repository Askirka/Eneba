-- +goose Up
CREATE TABLE product_comments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id text NOT NULL REFERENCES products,
    user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_comments_recent ON product_comments (product_id, id DESC);
CREATE INDEX product_comments_user ON product_comments (user_id);

-- +goose Down
DROP TABLE product_comments;
