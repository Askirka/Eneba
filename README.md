# Game Market

Educational digital game marketplace. The starter includes a PostgreSQL-backed catalog, homepage blocks, search, seller offers, and user accounts.

## Run locally

```sh
docker compose up --build -d
```

Open http://localhost:3000. The Go API listens on http://localhost:8080. On first startup, Goose creates the tables and seeds 40 games, three sellers, offers, and synthetic inventory. PostgreSQL persists in a named volume.

The Compose default password is for the local demo. Copy `.env.example` to `.env` to override it on first initialization. For standalone development, provide `DATABASE_URL` to the Go API and run `npm ci && npm run dev` in `frontend`.

## Deployment

Live URL: _pending deployment_.

1. Create a Free project on [Neon](https://neon.com/docs/connect/connect-from-any-app). Copy the direct connection URL from Connect. Set sslmode=verify-full and omit channel_binding because the lib/pq version used here does not accept that option. The database role needs to create tables and enable pg_trgm.
2. On Render choose New > Blueprint and select this repository and branch. Enter the Neon URI as secret DATABASE_URL and enter your expected frontend origin for ALLOWED_ORIGINS. The Free Docker service inherits PORT and runs Goose migrations at startup. Confirm /healthz and /readyz over HTTPS.
3. Replace https://your-render-service.onrender.com in frontend/vercel.json with your Render service origin and push the config. On Vercel Hobby import the repository with root directory frontend, framework Vite, build command npm run build and output directory dist.
4. Set ALLOWED_ORIGINS on Render to the actual Vercel production origin, without a trailing slash. Separate multiple trusted origins with commas. Keep SESSION_COOKIE_SECURE=true and store the Neon URI only in Render.
5. On the Vercel URL confirm /api/products returns JSON, register a demo account, refresh, complete a demo purchase and open its order. Record the verified URL above.

Vercel forwards /api before the SPA fallback so cookies stay on the frontend origin. Read requests retry temporary startup responses while showing loading. See [Render Free](https://render.com/docs/free) and [Vercel rewrites](https://vercel.com/docs/routing/rewrites). Set DB_PORT in a local .env file to override port 5433. Keep secrets outside Git.

## API

| Request | Response |
| --- | --- |
| GET /api/home/{block} | Independent banners, best-sellers, deals, and new-releases sources |
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

Banners read from `home_banners`. Best sellers and new releases use separate curated collections in `homepage_products`. Deals query discounted, available offers. Each block is fetched and rendered independently.

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

## CI/CD

The GitHub Actions workflow checks pull requests and pushes to main. It builds the Compose stack, waits for readiness, runs Go checks against PostgreSQL, runs API smoke tests, and runs the Playwright checkout. Render automatically deploys main after CI checks pass.

For Vercel, add VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID as GitHub Actions secrets. Add the repository variable VERCEL_CD_ENABLED with value true. Use the Vercel project from Deployment above. Run the workflow manually for the initial deploy if it is already enabled, or push to main. The frontend deployment job runs after verification and uploads a prebuilt production deployment. Git-triggered deploys in Vercel are disabled to avoid duplicate builds. See [Vercel CI configuration](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel).

## Scope and decisions

The demo focuses on comparing offers and completing a purchase for a digital game. Checkout allocates synthetic keys and simulates success or decline. Real payments, real keys, email recovery, and separate software and gift-card catalogs are outside the demo. The storefront supports English and EUR. Wishlist and guest cart are stored in the browser. Accounts, listings, purchases, and issued keys are stored in PostgreSQL.

| Layer | Responsibility |
| --- | --- |
| React + TypeScript | Navigation, filters, independently loaded home blocks, account and checkout screens |
| Go + chi | Input validation, session checks, offer management, transactional checkout |
| PostgreSQL + Goose | Schema and seed data, search with pg_trgm, inventory, orders, comments and ratings |

```mermaid
flowchart LR
  Browser -->|same-origin API| Proxy --> Go --> PostgreSQL
  PostgreSQL --> Catalog[Product has seller offers and keys]
  PostgreSQL --> Accounts[User has sessions, seller offers and orders]
  PostgreSQL --> Home[Home sources and curated collections]
```

Stock is counted from unredeemed keys. Checkout locks the relevant offer and inventory rows, validates the total, and stores the price and issued key with the order. An idempotency key scoped to the buyer allows a safe retry.

## Verify

- In `backend`, run `go test ./...` and `go vet ./...`.
- In `frontend`, run `npm ci`, `npm run build`, `npx playwright install chromium`, and `npm run test:e2e` against the running stack.
- For Go integration tests set `TEST_WEB_ORIGIN=http://localhost:8080` and `TEST_DATABASE_URL=postgres://games:games@localhost:5433/games?sslmode=disable` before running `go test ./... -count=1` in `backend`. These are local demo defaults.
- With Compose running, execute `node scripts/smoke.mjs` and `node scripts/auth-smoke.mjs` from the project root. Run `node scripts/checkout-smoke.mjs` to verify checkout with seeded inventory. The auth test registers a unique `@example.test` account and revokes its session when finished.

The current session's visible conversation is in [docs/ai-log.md](docs/ai-log.md). Paste earlier conversations into the marked section before submission.
