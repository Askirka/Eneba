import { apiFetch } from './api-fetch'
import { FormEvent, ReactNode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import './styles.css'
import { SearchBox } from './search-box'
import { WishlistButton, WishlistLink, WishlistPage, WishlistProvider } from './wishlist'
import { Cover } from './cover'
import { ProductRating } from './rating'
import { OfferPrice } from './price'
import { ProductComments } from './comments'
import { OrderPage, ProfilePage } from './profile'
import { CartProvider, OfferActions, PurchasePage, useCart } from './cart'
import { AccountControls, AuthPage } from './account'

type Product = { id: string; title: string; platform: string; region: string; priceCents: number | null; originalPriceCents: number | null; discountPercent: number; bestOfferId: number | null; description: string; activation: string }
type Offer = { id: number; sellerId: number; seller: string; rating: number; priceCents: number; originalPriceCents: number; discountPercent: number; stock: number }
type Block = { type: string; title: string; copy: string; label: string; url: string; products: Product[] }
type Page = { items: Product[]; page: number; limit: number; total: number }

class RequestError extends Error {
  constructor(readonly status: number) { super('Request failed') }
}

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await apiFetch('/api' + path, { signal })
  if (!response.ok) throw new RequestError(response.status)
  return response.json()
}


function Header() {
  const cart = useCart()
  const location = useLocation()
  return <header>
    <div className="utility-bar">
      <label>Language <select aria-label="Language"><option>English</option></select></label>
      <label>Currency <select aria-label="Currency"><option>EUR</option></select></label>
      <WishlistLink />
    </div>
    <div className="masthead">
      <Link className="brand" to="/">Game Market</Link>
      <SearchBox key={location.pathname + location.search} />
      <Link className="cart-link" to="/cart">Cart <span>{cart.ids.length}</span></Link>
      <AccountControls />
    </div>
    <nav className="site-nav" aria-label="Main navigation">
      <Link to="/store">Games</Link><Link to="/store?platform=Steam">Steam</Link>
      <Link to="/store?platform=Xbox">Xbox</Link><Link to="/store?platform=GOG">GOG</Link>
      <Link to="/store?platform=Epic">Epic</Link><Link to="/store?deals=1">Deals</Link>
    </nav>
  </header>
}

function Footer() {
  return <footer className="site-footer">
    <div><strong>Game Market</strong><p>Educational marketplace demo</p></div>
    <nav aria-label="Footer store"><strong>Explore</strong><Link to="/store">Games</Link><Link to="/store?deals=1">Deals</Link></nav>
    <nav aria-label="Footer account"><strong>Your account</strong><Link to="/account">My account</Link><Link to="/wishlist">Wishlist</Link><Link to="/cart">Cart</Link></nav>
  </footer>
}

function Grid({ products }: { products: Product[] }) {
  return <div className="grid">{products.map(product => {
    const path = '/games/' + product.id
    return <article key={product.id} className="card">
      <Link className="card-media" to={path} aria-label={'View ' + product.title}>
        <Cover product={product} /><span className="card-platform">{product.platform}</span>
      </Link>
      <div className="card-details">
        <div className="card-title-row"><Link className="card-title" to={path}>{product.title}</Link><WishlistButton game={product} /></div>
        <span className="meta">{product.region}</span>
        <div className="card-price">{product.priceCents === null ? 'Not available right now' : <><small>From</small><OfferPrice offer={product} /></>}</div>
        {product.bestOfferId !== null && <OfferActions id={product.bestOfferId} />}
      </div>
    </article>
  })}</div>
}
function Feedback({ pending, error, retry, children, missing = 'Game not found' }: { pending: boolean; error: Error | null; retry: () => void; children: ReactNode; missing?: string }) {
  if (pending) return <p role="status">Loading…</p>
  if (error instanceof RequestError && error.status === 404) return <h1>{missing}</h1>
  if (error) return <p role="alert">Unable to load this page. <button onClick={retry}>Retry</button></p>
  return children
}

function Home() {
  return <><HomeBanners /><HomeShelf source="best-sellers" /><HomeShelf source="deals" /><HomeShelf source="new-releases" /></>
}

type Banner = { id: number; title: string; copy: string; label: string; url: string; image: string }

function HomeBanners() {
  const [selected, setSelected] = useState(0)
  const query = useQuery({ queryKey: ['home', 'banners'], queryFn: ({ signal }) => get<Banner[]>('/home/banners', signal) })
  const banners = query.data ?? []
  const banner = banners[selected % banners.length]
  return <Feedback pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
    {banner && <section className="hero" aria-label="Featured games">
      <img className="hero-art" src={banner.image} alt="" />
      <div className="hero-content" aria-live="polite">
        <h1>{banner.title}</h1><p>{banner.copy}</p><Link className="button" to={banner.url}>{banner.label}</Link>
      </div>
      {banners.length > 1 && <div className="banner-controls">
        <button aria-label="Previous banner" onClick={() => setSelected((selected + banners.length - 1) % banners.length)}>‹</button>
        <span>{selected + 1} / {banners.length}</span>
        <button aria-label="Next banner" onClick={() => setSelected((selected + 1) % banners.length)}>›</button>
      </div>}
    </section>}
  </Feedback>
}

function HomeShelf({ source }: { source: 'best-sellers' | 'deals' | 'new-releases' }) {
  const query = useQuery({ queryKey: ['home', source], queryFn: ({ signal }) => get<Block>('/home/' + source, signal) })
  const block = query.data
  return <section className="home-shelf" aria-label={block?.title ?? source}>
    <Feedback pending={query.isPending} error={query.error} retry={() => void query.refetch()} missing="Collection unavailable">
      {block && <><div className="section-title"><h2>{block.title}</h2><Link to={block.url}>{block.label}</Link></div>
        {block.products.length ? <Grid products={block.products} /> : <p>No items in this collection yet.</p>}</>}
    </Feedback>
  </section>
}

function CatalogControls({ params, update }: { params: URLSearchParams; update: (changes: Record<string, string>) => void }) {
  const [search, setSearch] = useState(params.get('q') ?? '')
  useEffect(() => {
    if (search.trim() === (params.get('q') ?? '')) return
    const timer = window.setTimeout(() => update({ q: search.trim() }), 300)
    return () => window.clearTimeout(timer)
  }, [search, params, update])
  function applyPrices(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const cents = (key: string) => String(values.get(key) ? Math.round(Number(values.get(key)) * 100) : '')
    update({ min: cents('min'), max: cents('max') })
  }
  return <aside className="filters" aria-label="Filters"><h2>Filters</h2>
    <label>Title<input value={search} maxLength={100} onChange={event => setSearch(event.target.value)} /></label>
    {Object.entries({ platform: ['Steam', 'Xbox', 'GOG', 'Epic'], region: ['Global', 'Europe', 'North America'] }).map(([key, options]) =>
      <label key={key}>{key}<select value={params.get(key) ?? ''} onChange={event => update({ [key]: event.target.value })}>
        <option value="">All</option>{options.map(option => <option key={option}>{option}</option>)}
      </select></label>)}
    
    <form className="price" onSubmit={applyPrices}>
      {['min', 'max'].map(key => <label key={key}>{key === 'min' ? 'Min EUR' : 'Max EUR'}<input name={key} type="number" min="0" max="10000" step="0.01" defaultValue={params.has(key) ? Number(params.get(key)) / 100 : ''} /></label>)}
      <button>Apply price</button>
    </form>
    <label className="inline-field"><input type="checkbox" checked={params.get('deals') === '1'} onChange={event => update({ deals: event.target.checked ? '1' : '' })} /> Discounted offers</label>
    <Link to="/store">Reset filters</Link>
  </aside>
}

function Store() {
  const [params, setParams] = useSearchParams()
  const filterKey = params.toString()
  const query = useQuery({ queryKey: ['products', filterKey], queryFn: ({ signal }) => get<Page>('/products?' + filterKey, signal) })
  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params)
    next.delete('page')
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next)
  }
  function changePage(page: number) {
    const next = new URLSearchParams(params)
    next.set('page', String(page))
    setParams(next)
  }
  const data = query.data
  return <><p className="breadcrumb"><Link to="/">Home</Link> / Store</p><h1>Game catalog</h1><div className="store-layout">
    <CatalogControls key={filterKey} params={params} update={update} /><section aria-label="Catalog results">
    <Feedback pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
      {data && <>
        <div className="results-bar"><p role="status">{data.total} {data.total === 1 ? 'game' : 'games'}</p><label>Sort<select value={params.get('sort') ?? ''} onChange={event => update({ sort: event.target.value })}>
      <option value="">Relevance</option><option value="price_asc">Lowest price</option><option value="price_desc">Highest price</option><option value="title">Title</option>
    </select></label></div>
        {data.items.length ? <Grid products={data.items} /> : <div className="empty-results"><h2>No matching games</h2><p>Try a shorter title or adjust your filters.</p>
          {params.get('q') && <button className="secondary" onClick={() => update({ q: '' })}>Clear search</button>}
          <Link to="/store">Reset all filters</Link></div>}
        <nav className="pages" aria-label="Catalog pages">
          <button disabled={data.page <= 1} onClick={() => changePage(data.page - 1)}>Previous</button>
          <span>Page {data.page}</span>
          <button disabled={data.page * data.limit >= data.total} onClick={() => changePage(data.page + 1)}>Next</button>
        </nav>
      </>}
    </Feedback>
  </section></div></>
}

function Game() {
  const id = useParams().id!
  const query = useQuery({ queryKey: ['product', id], queryFn: ({ signal }) => get<{ product: Product; offers: Offer[] }>('/products/' + encodeURIComponent(id), signal) })
  const [offerSort, setOfferSort] = useState('price')
  const product = query.data?.product
  const best = query.data?.offers[0]
  const offers = query.data?.offers ?? []
  const comparison = offerSort === 'rating' ? [...offers].sort((a, b) => b.rating - a.rating || a.priceCents - b.priceCents || a.id - b.id) : offers
  return <Feedback pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
    {product && <><Link to="/store">Back to store</Link><div className="game-intro"><Cover key={product.id} product={product} /><div><h1>{product.title}</h1>
      <p className="meta">{product.platform} · {product.region}</p>
      <p>{product.description}</p><p>{product.activation}</p></div></div>
      <ProductRating key={product.id} productId={product.id} />
      {best && <section className="best-offer" aria-label="Best seller offer">
        <div><h2>Best price</h2><p><Link to={'/sellers/' + best.sellerId}>{best.seller}</Link> · {best.stock > 0 ? best.stock + ' available' : 'Not available right now'}</p></div>
        <OfferPrice offer={best} />{best.stock > 0 && <OfferActions id={best.id} />}
      </section>}
      <div className="section-title"><h2>Seller offers</h2>
        {offers.length > 1 && <label>Sort offers <select value={offerSort} onChange={event => setOfferSort(event.target.value)}>
          <option value="price">Lowest price</option><option value="rating">Seller rating</option>
        </select></label>}
      </div>
      {!query.data?.offers.length && <p>No offers are available.</p>}
      <ul className="offers">{comparison.map(offer => <li key={offer.id}>
        <strong><Link to={'/sellers/' + offer.sellerId}>{offer.seller}</Link></strong><span>{offer.rating ? offer.rating.toFixed(2) + ' / 5' : 'New seller'}</span><span>{offer.stock ? offer.stock + ' available' : 'Not available right now'}</span><OfferPrice offer={offer} />{offer.stock > 0 && <OfferActions id={offer.id} />}
      </li>)}</ul><ProductComments key={product.id} productId={product.id} />
    </>}
  </Feedback>
}

function SellerPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const page = params.get('page') ?? '1'
  const query = useQuery({
    queryKey: ['seller', id, page],
    queryFn: ({ signal }) => get<{ seller: { name: string; rating: number }; items: Product[]; page: number; next: boolean }>(
      '/sellers/' + encodeURIComponent(id!) + '?' + new URLSearchParams({ page }), signal),
  })
  const data = query.data
  return <Feedback pending={query.isPending} error={query.error} retry={() => void query.refetch()} missing="Seller not found">
    {data && <>
      <p className="breadcrumb"><Link to="/store">Store</Link> / Sellers</p>
      <h1>{data.seller.name}</h1>
      <p>{data.seller.rating ? data.seller.rating.toFixed(2) + ' / 5' : 'New seller'}</p>
      <h2>Items from this seller</h2>
      {data.items.length ? <Grid products={data.items} /> : <p>This seller has no listings on this page.</p>}
      {(data.page > 1 || data.next) && <nav className="pages" aria-label="Seller pages">
        <button disabled={data.page === 1} onClick={() => setParams({ page: String(data.page - 1) })}>Previous</button>
        <span>Page {data.page}</span>
        <button disabled={!data.next} onClick={() => setParams({ page: String(data.page + 1) })}>Next</button>
      </nav>}
    </>}
  </Feedback>
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><BrowserRouter><WishlistProvider><CartProvider><Header /><main>
    <Routes><Route path="/" element={<Home />} /><Route path="/store" element={<Store />} /><Route path="/games/:id" element={<Game />} /><Route path="/account" element={<ProfilePage />} /><Route path="/account/orders/:id" element={<OrderPage />} /><Route path="/sellers/:id" element={<SellerPage />} /><Route path="/wishlist" element={<WishlistPage />} /><Route path="/cart" element={<PurchasePage />} /><Route path="/checkout" element={<PurchasePage checkout />} /><Route path="/login" element={<AuthPage key="login" mode="login" />} /><Route path="/register" element={<AuthPage key="register" mode="register" />} /><Route path="*" element={<h1>Page not found</h1>} /></Routes>
  </main><Footer /></CartProvider></WishlistProvider></BrowserRouter></QueryClientProvider>
)
