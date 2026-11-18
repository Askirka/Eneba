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

## Cart and demo purchases

Add a game from the catalog or select a seller on its product page. The catalog action selects the lowest-priced available offer. Offers from different sellers share one product page when their title, platform, and region match. The Best price section shows the lowest listed price and indicates when that offer is sold out. The cart stays in the browser and checkout requires an account. **Buy now** on a product checks out that offer directly. PostgreSQL saves successful orders and allocates one synthetic key per selected offer in the same transaction. The checkout can simulate a declined payment, and the API checks the quoted total again before committing.

Product cover images come from the respective publishers' Steam library assets and are served locally. All purchases are simulated and use demonstration keys.

| Request | Response |
| --- | --- |
| POST /api/cart/quote | Current availability and prices for offer IDs |
| POST /api/checkout | Confirm purchase for the current account and return demo keys |

## Personal account

Open **My account** after signing in. Update the display name and upload or remove a JPEG or PNG profile picture. **Reset password** changes the password using the current password and revokes other sessions. Purchase history includes order details and demo keys and is accessible only to each buyer. **My items** lists the signed-in member’s published items. Creating a listing publishes it in the catalog with the selected quantity of synthetic keys. Use **Edit price** in My items to change the base price and apply or remove a percentage discount. The checkout uses the discounted price. Use **Restock** in My items to add demo keys to an existing offer, up to 100 available keys. Seller names link to public storefronts showing their own offers.

Run `node scripts/profile-smoke.mjs` against the running app to check account settings, order ownership, and authenticated listings. This test creates demo accounts, a listing, and an order.

## Verify

- In `backend`, run `go test ./...` and `go vet ./...`.
- In `frontend`, run `npm ci` and `npm run build`.
- With Compose running, execute `node scripts/smoke.mjs` and `node scripts/auth-smoke.mjs` from the project root. Run `node scripts/checkout-smoke.mjs` to verify checkout with seeded inventory. The auth test registers a unique `@example.test` account and revokes its session when finished.

 GitHub publication, public hosting, and the full AI conversation transcript are pending. The active GoLand Air session contains the original messages. Keep its transcript with the submission once exported or copied from the IDE.
