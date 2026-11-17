# Game Market

Educational digital game marketplace. The starter includes a PostgreSQL-backed catalog, homepage blocks, search, seller offers, and user accounts.

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
| POST /api/auth/register | Create an account and sign in |
| POST /api/auth/login | Start a session for an existing account |
| GET /api/auth/me | Return the current account |
| POST /api/auth/logout | Revoke the current session |
| GET /healthz | Process health |
| GET /readyz | Database readiness |

Catalog filters are `platform`, `region`, `min`, and `max`; price bounds are integer EUR cents. Sort by `relevance`, `price_asc`, `price_desc`, or `title`. Use `page` and `limit` for pagination. PostgreSQL ranks exact titles before substring matches and uses `pg_trgm` word similarity for misspellings. Minimum prices come from offers with available keys.

Homepage configuration comes from `homepage_blocks`. Each listing block has its own ordered product collection in `homepage_products`. The API composes those collections with live catalog prices. The hero reads its copy and CTA from its configuration row.

## Accounts

Open **Create account** or **Log in** from the header. PostgreSQL stores normalized email addresses, bcrypt password hashes, and hashes of session tokens. Registration signs the user in immediately. A session expires after seven days, and logging out revokes it in the database.

Authentication POST requests require the same-origin header `X-Game-Market-Request: 1`. Registration and login accept a JSON object with `email` and `password`. The browser receives an HttpOnly, SameSite=Lax cookie. Set `SESSION_COOKIE_SECURE=true` for an HTTPS deployment.

## Verify

- In `backend`, run `go test ./...` and `go vet ./...`.
- In `frontend`, run `npm ci` and `npm run build`.
- With Compose running, execute `node scripts/smoke.mjs` and `node scripts/auth-smoke.mjs` from the project root. The auth test registers a unique `@example.test` account and revokes its session when finished.

The next milestone covers guest cart persistence, transactional simulated checkout, order history, and final visual assets. GitHub publication, public hosting, and the full AI conversation transcript are pending. The active GoLand Air session contains the original messages. Keep its transcript with the submission once exported or copied from the IDE.
