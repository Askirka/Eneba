import { FormEvent, ReactNode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import './styles.css'
import { Cover } from './cover'
import { ProductRating } from './rating'
import { OrderPage, ProfilePage } from './profile'
import { CartProvider, OfferActions, PurchasePage, money, useCart } from './cart'
import { AccountControls, AuthPage } from './account'

type Product = { id: string; title: string; platform: string; region: string; priceCents: number | null; bestOfferId: number | null; description: string; activation: string }
type Offer = { id: number; seller: string; rating: number; priceCents: number; stock: number }
type Block = { type: string; title: string; copy: string; label: string; url: string; products: Product[] | null }
type Page = { items: Product[]; page: number; limit: number; total: number }

class RequestError extends Error {
  constructor(readonly status: number) { super('Request failed') }
}

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch('/api' + path, { signal })
  if (!response.ok) throw new RequestError(response.status)
  return response.json()
}


function Header() {
  const cart = useCart()
  const location = useLocation()
  const navigate = useNavigate()
  const current = new URLSearchParams(location.search).get('q') ?? ''
  return <header><div className="masthead"><Link className="brand" to="/">Game Market</Link>
    <form role="search" key={current} onSubmit={event => {
      event.preventDefault()
      const q = String(new FormData(event.currentTarget).get('q')).trim()
      navigate('/store' + (q ? '?' + new URLSearchParams({ q }) : ''))
    }}>
      <input aria-label="Search games" name="q" defaultValue={current} placeholder="Search games" maxLength={100} />
      <button>Search</button>
    </form>
        <Link className="cart-link" to="/cart">Cart <span>{cart.ids.length}</span></Link><AccountControls />
    </div><nav className="site-nav" aria-label="Main navigation"><Link to="/">Home</Link><Link to="/store">Browse games</Link></nav>
  </header>
}

function Grid({ products }: { products: Product[] }) {
  return <div className="grid">{products.map(product => {
    const path = '/games/' + product.id
    return <article key={product.id} className="card">
      <Link className="card-media" to={path} aria-label={'View ' + product.title}>
        <Cover product={product} /><span className="card-platform">{product.platform}</span>
      </Link>
      <div className="card-details">
        <Link className="card-title" to={path}>{product.title}</Link>
        <span className="meta">{product.region}</span>
        <div className="card-price">{product.priceCents === null ? 'Unavailable' : <><small>From</small>{money(product.priceCents)}</>}</div>
        {product.bestOfferId !== null && <OfferActions id={product.bestOfferId} />}
      </div>
    </article>
  })}</div>
}
function Feedback({ pending, error, retry, children }: { pending: boolean; error: Error | null; retry: () => void; children: ReactNode }) {
  if (pending) return <p role="status">Loading…</p>
  if (error instanceof RequestError && error.status === 404) return <h1>Game not found</h1>
  if (error) return <p role="alert">Unable to load this page. <button onClick={retry}>Retry</button></p>
  return children
}

function Home() {
  const query = useQuery({ queryKey: ['home'], queryFn: ({ signal }) => get<Block[]>('/home', signal) })
  return <Feedback pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
    {query.data?.length === 0 && <p>No featured games are available. <Link to="/store">Browse the store</Link></p>}
    {query.data?.map(block => block.type === 'hero'
      ? <section key={block.type} className="hero"><h1>{block.title}</h1><p>{block.copy}</p><Link className="button" to={block.url}>{block.label}</Link></section>
      : <section key={block.type}><div className="section-title"><h2>{block.title}</h2><Link to={block.url}>{block.label}</Link></div><Grid products={block.products ?? []} /></section>)}
  </Feedback>
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
    {Object.entries({ platform: ['Steam', 'Xbox', 'GOG'], region: ['Global', 'Europe'] }).map(([key, options]) =>
      <label key={key}>{key}<select value={params.get(key) ?? ''} onChange={event => update({ [key]: event.target.value })}>
        <option value="">All</option>{options.map(option => <option key={option}>{option}</option>)}
      </select></label>)}
    
    <form className="price" onSubmit={applyPrices}>
      {['min', 'max'].map(key => <label key={key}>{key === 'min' ? 'Min EUR' : 'Max EUR'}<input name={key} type="number" min="0" max="10000" step="0.01" defaultValue={params.has(key) ? Number(params.get(key)) / 100 : ''} /></label>)}
      <button>Apply price</button>
    </form>
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
        {data.items.length ? <Grid products={data.items} /> : <p>No games match these filters.</p>}
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
  const product = query.data?.product
  return <Feedback pending={query.isPending} error={query.error} retry={() => void query.refetch()}>
    {product && <><Link to="/store">Back to store</Link><div className="game-intro"><Cover key={product.id} product={product} /><div><h1>{product.title}</h1>
      <p className="meta">{product.platform} · {product.region}</p>
      <p>{product.description}</p><p>{product.activation}</p></div></div>
      <ProductRating key={product.id} productId={product.id} /><h2>Seller offers</h2>
      {!query.data?.offers.length && <p>No offers are available.</p>}
      <ul className="offers">{query.data?.offers.map(offer => <li key={offer.id}>
        <strong>{offer.seller}</strong><span>{offer.rating.toFixed(2)} / 5</span><span>{offer.stock ? offer.stock + ' available' : 'Sold out'}</span><strong>{money(offer.priceCents)}</strong>{offer.stock > 0 && <OfferActions id={offer.id} />}
      </li>)}</ul>
    </>}
  </Feedback>
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><BrowserRouter><CartProvider><Header /><main>
    <Routes><Route path="/" element={<Home />} /><Route path="/store" element={<Store />} /><Route path="/games/:id" element={<Game />} /><Route path="/account" element={<ProfilePage />} /><Route path="/account/orders/:id" element={<OrderPage />} /><Route path="/cart" element={<PurchasePage />} /><Route path="/checkout" element={<PurchasePage checkout />} /><Route path="/login" element={<AuthPage key="login" mode="login" />} /><Route path="/register" element={<AuthPage key="register" mode="register" />} /><Route path="*" element={<h1>Page not found</h1>} /></Routes>
  </main><footer>Game Market · Educational demo</footer></CartProvider></BrowserRouter></QueryClientProvider>
)
