-- +goose Up
INSERT INTO platforms(name) VALUES ('Epic') ON CONFLICT DO NOTHING;
INSERT INTO regions(name) VALUES ('North America') ON CONFLICT DO NOTHING;

INSERT INTO products(id,title,platform,region,description,activation)
SELECT id,title,platform,region,
       'Digital edition of ' || title || ' for ' || platform || '.',
       'Open the redemption screen in your ' || platform || ' account. Demo keys are for this marketplace only.'
FROM (VALUES
    ('baldurs-gate-3', 'Baldur''s Gate 3', 'GOG', 'Global'),
    ('elden-ring', 'Elden Ring', 'Steam', 'Europe'),
    ('disco-elysium-steam', 'Disco Elysium', 'Steam', 'North America'),
    ('hades-ii', 'Hades II', 'Steam', 'Global'),
    ('hollow-knight-silksong', 'Hollow Knight: Silksong', 'Steam', 'Global'),
    ('balatro', 'Balatro', 'Steam', 'Europe'),
    ('dave-the-diver', 'Dave the Diver', 'Steam', 'North America'),
    ('dredge', 'Dredge', 'GOG', 'Global'),
    ('sea-of-stars', 'Sea of Stars', 'Xbox', 'Europe'),
    ('return-of-the-obra-dinn', 'Return of the Obra Dinn', 'GOG', 'Global'),
    ('factorio', 'Factorio', 'Steam', 'Global'),
    ('rimworld', 'RimWorld', 'Steam', 'North America'),
    ('subnautica', 'Subnautica', 'Epic', 'Global'),
    ('control', 'Control Ultimate Edition', 'Epic', 'Europe'),
    ('death-stranding', 'Death Stranding Director''s Cut', 'Epic', 'Global'),
    ('persona-5-royal', 'Persona 5 Royal', 'Xbox', 'North America'),
    ('resident-evil-4', 'Resident Evil 4', 'Steam', 'Europe'),
    ('doom-eternal', 'DOOM Eternal', 'Xbox', 'Global')
) AS games(id,title,platform,region)
ON CONFLICT ((lower(btrim(title))),platform,region) WHERE deleted_at IS NULL DO NOTHING;

-- Only seed marketplace-owned products and the three demo sellers.
WITH added AS (
    INSERT INTO offers(product_id,seller_id,price_cents,discount_percent)
    SELECT p.id,s.id,800 + (length(p.title) * 43) + s.id * 175,
           CASE WHEN s.id=1 AND length(p.title)%2=0 THEN 25
                WHEN s.id=2 AND length(p.title)%3=0 THEN 15 ELSE 0 END
    FROM products p CROSS JOIN sellers s
    WHERE p.owner_id IS NULL AND p.deleted_at IS NULL AND s.id IN (1,2,3)
    ON CONFLICT (product_id,seller_id) WHERE deleted_at IS NULL DO NOTHING
    RETURNING id,seller_id
)
INSERT INTO inventory_keys(offer_id,code)
SELECT added.id,'DEMO-SEED-' || added.id || '-' || serial
FROM added CROSS JOIN LATERAL generate_series(1,(6+2*added.seller_id)::integer) AS serial;

UPDATE offers o SET discount_percent=20
FROM products p
WHERE o.product_id=p.id AND p.owner_id IS NULL AND o.seller_id=1
  AND p.id IN ('tunic','ori','inside','limbo','dead-cells','hollow-knight');
