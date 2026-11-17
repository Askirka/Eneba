# Game Market

Educational digital game marketplace. The starter includes a PostgreSQL-backed catalog, homepage blocks, search, and seller offers.

## Run locally

```sh
docker compose up --build -d
```

Open http://localhost:3000. The Go API listens on http://localhost:8080. On first startup, Goose creates the tables and seeds 22 games, three sellers, offers, and synthetic inventory. PostgreSQL persists in a named volume.

The Compose default password is for the local demo. Copy `.env.example` to `.env` to override it on first initialization. For standalone development, provide `DATABASE_URL` to the Go API and run `npm ci && npm run dev` in `frontend`.

## API

| Request | Response |
| --- | --- |
| GET /api/home | Ordered hero, best sellers, and deals |
| GET /api/products?q=cyberpnk | Paginated game catalog |
| GET /api/search?q=witchr | Same search and filter contract as the catalog |
| GET /api/products/hades | Game details and seller offers |
| GET /healthz | Process health |
| GET /readyz | Database readiness |

Catalog filters are `platform`, `region`, `min`, and `max`; price bounds are integer EUR cents. Sort by `relevance`, `price_asc`, `price_desc`, or `title`. Use `page` and `limit` for pagination. PostgreSQL ranks exact titles before substring matches and uses `pg_trgm` word similarity for misspellings. Minimum prices come from offers with available keys.

Homepage configuration comes from `homepage_blocks`. Each listing block has its own ordered product collection in `homepage_products`. The API composes those collections with live catalog prices. The hero reads its copy and CTA from its configuration row.

## Verify

- In `backend`, run `go test ./...` and `go vet ./...`.
- In `frontend`, run `npm ci` and `npm run build`.
- With Compose running, execute `node scripts/smoke.mjs` from the project root.

The next milestone covers guest cart persistence, account sessions, transactional simulated checkout, order history, and final visual assets. GitHub publication, public hosting, and the full AI conversation transcript are pending. The active GoLand Air session contains the original messages. Keep its transcript with the submission once exported or copied from the IDE.
