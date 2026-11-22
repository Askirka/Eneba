-- +goose Up
CREATE TABLE home_banners (
    id integer PRIMARY KEY,
    title text NOT NULL,
    copy text NOT NULL,
    cta_label text NOT NULL,
    cta_url text NOT NULL,
    image_path text NOT NULL
);
INSERT INTO home_banners VALUES
    (1, 'Your next game starts here', 'Compare digital game offers from multiple sellers.', 'Browse games', '/store', '/covers/cyberpunk-2077.jpg'),
    (2, 'Save on your next adventure', 'Browse offers with an active discount.', 'Browse deals', '/store?deals=1', '/covers/hades.jpg'),
    (3, 'Discover a new favorite', 'Explore more games across Steam, Xbox, GOG and Epic.', 'Browse games', '/store', '/covers/hades-ii.jpg');

ALTER TABLE homepage_blocks DROP CONSTRAINT homepage_blocks_type_check;
ALTER TABLE homepage_blocks ADD CHECK (type IN ('hero','best_sellers','deals','new_releases'));
UPDATE homepage_blocks SET cta_label='Show all' WHERE type IN ('best_sellers','deals');
UPDATE homepage_blocks SET cta_url='/store?deals=1' WHERE type='deals';
INSERT INTO homepage_blocks(type,position,title,copy,cta_label,cta_url)
VALUES ('new_releases',4,'New releases','','Show all','/store');
INSERT INTO homepage_products VALUES
    ('new_releases',1,'hades-ii'), ('new_releases',2,'hollow-knight-silksong'),
    ('new_releases',3,'elden-ring'), ('new_releases',4,'baldurs-gate-3')
ON CONFLICT DO NOTHING;
