-- +goose Up
INSERT INTO platforms VALUES ('Steam'), ('Xbox'), ('GOG');
INSERT INTO regions VALUES ('Global'), ('Europe');
INSERT INTO products
SELECT id, title, platform, region, 'Digital edition of ' || title || '.', 'Redeem the demo code in your ' || platform || ' account.'
FROM (VALUES
 ('cyberpunk-2077','Cyberpunk 2077','GOG','Global'),
 ('the-witcher-3','The Witcher 3: Wild Hunt','GOG','Global'),
 ('hades','Hades','Steam','Global'),
 ('celeste','Celeste','Steam','Europe'),
 ('stardew-valley','Stardew Valley','Steam','Global'),
 ('dead-cells','Dead Cells','Steam','Europe'),
 ('hollow-knight','Hollow Knight','Steam','Global'),
 ('ori','Ori and the Will of the Wisps','Xbox','Europe'),
 ('forza','Forza Horizon 5','Xbox','Global'),
 ('tunic','Tunic','Xbox','Europe'),
 ('bastion','Bastion','Steam','Global'),
 ('transistor','Transistor','Steam','Europe'),
 ('disco-elysium','Disco Elysium','GOG','Global'),
 ('outer-wilds','Outer Wilds','Steam','Europe'),
 ('slay-the-spire','Slay the Spire','Steam','Global'),
 ('into-the-breach','Into the Breach','GOG','Global'),
 ('cuphead','Cuphead','Xbox','Europe'),
 ('inside','Inside','Steam','Global'),
 ('limbo','Limbo','GOG','Europe'),
 ('portal-2','Portal 2','Steam','Global'),
 ('terraria','Terraria','Steam','Global'),
 ('undertale','Undertale','Steam','Europe')
) AS demo(id,title,platform,region);
INSERT INTO sellers VALUES (1,'Pixel Harbor',4.70),(2,'Cartridge Club',4.90),(3,'Key Orchard',4.85);
INSERT INTO offers (product_id,seller_id,price_cents)
SELECT p.id,s.id, (3 + length(p.title)) * 100 + s.id * 75
FROM products p CROSS JOIN sellers s WHERE s.id = 1 OR length(p.title) % 2 = 0;
INSERT INTO inventory_keys (offer_id,code)
SELECT offers.id, 'DEMO-' || offers.id || '-' || seq FROM offers CROSS JOIN generate_series(1,15) AS seq;
INSERT INTO homepage_blocks VALUES
 ('hero',1,'Your next game starts here','Explore digital editions across Steam, Xbox, and GOG.','Browse games','/store'),
 ('best_sellers',2,'Best sellers','','View all','/store'),
 ('deals',3,'Featured deals','','Shop deals','/store?sort=price_asc');
INSERT INTO homepage_products VALUES
 ('best_sellers',1,'cyberpunk-2077'),('best_sellers',2,'the-witcher-3'),('best_sellers',3,'hades'),('best_sellers',4,'forza'),
 ('deals',1,'tunic'),('deals',2,'ori'),('deals',3,'inside'),('deals',4,'limbo');

-- +goose Down
DELETE FROM homepage_products;
DELETE FROM homepage_blocks;
DELETE FROM inventory_keys;
DELETE FROM offers;
DELETE FROM sellers;
DELETE FROM products;
DELETE FROM platforms;
DELETE FROM regions;
