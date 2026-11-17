import { Cover } from './cover'
import { createContext, ReactNode, useContext, useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const storageKey = 'game-market-cart'
const maximumOffers = 30
const validID = (id: number) => Number.isSafeInteger(id) && id > 0

function readCart(): number[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(value) ? [...new Set(value.filter(validID))].slice(0, maximumOffers) : []
  } catch { return [] }
}

type Cart = { ids: number[]; add: (id: number) => void; remove: (ids: number[]) => void }
const CartContext = createContext<Cart | null>(null)
export function CartProvider({ children }: { children: ReactNode }) {
  const [ids, setIDs] = useState(readCart)
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(ids)) } catch {} }, [ids])
  return <CartContext.Provider value={{
    ids,
    add: id => setIDs(current => current.includes(id) || current.length >= maximumOffers ? current : [...current, id]),
    remove: ids => setIDs(current => current.filter(id => !ids.includes(id))),
  }}>{children}</CartContext.Provider>
}

export function useCart() {
  return useContext(CartContext)!
}

export function OfferActions({ id }: { id: number }) {
  const cart = useCart()
  const inCart = cart.ids.includes(id)
  return <div className="offer-actions">
    {inCart ? <Link className="button secondary" to="/cart">View cart</Link>
      : <Link className="button secondary" to="/cart" onClick={event => {
        if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) cart.add(id)
      }}>Add to cart</Link>}
    <Link className="button" to={'/checkout?offer=' + id}>Buy now</Link>
  </div>
}

export const money = (cents: number) => new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(cents / 100)

type Item = { offerId: number; productId: string; title: string; seller: string; priceCents: number; available: boolean }
type Quote = { items: Item[]; totalCents: number }
type Receipt = { id: number; totalCents: number; items: { title: string; seller: string; code: string }[] }

class PurchaseError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

async function post<T>(path: string, body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/' + path, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Game-Market-Request': '1' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new PurchaseError(response.status, data?.error ?? 'The request failed. Try again.')
  return data
}

export function PurchasePage({ checkout = false }: { checkout?: boolean }) {
  const cart = useCart()
  const location = useLocation()
  const [params] = useSearchParams()
  const direct = checkout && params.has('offer')
  const offer = Number(params.get('offer'))
  const ids = direct ? (validID(offer) ? [offer] : []) : cart.ids
  return <PurchaseSummary key={String(checkout) + ':' + String(direct) + ':' + (direct ? offer : '')}
    ids={ids} direct={direct} checkout={checkout} returnTo={location.pathname + location.search} />
}

function PurchaseSummary({ ids, direct, checkout, returnTo }: { ids: number[]; direct: boolean; checkout: boolean; returnTo: string }) {
  const cart = useCart()
  const client = useQueryClient()
  const [receipt, setReceipt] = useState<Receipt>()
  const [error, setError] = useState<Error>()
  const [pending, setPending] = useState(false)
  const [decline, setDecline] = useState(false)
  const [attempt, setAttempt] = useState<{ signature: string; requestId: string }>()
  const quote = useQuery({
    queryKey: ['quote', ids], enabled: ids.length > 0 && !receipt,
    queryFn: ({ signal }) => post<Quote>('cart/quote', { offers: ids }, signal),
  })
  const account = useQuery({
    queryKey: ['account'], enabled: checkout,
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/auth/me', { signal })
      if (response.status === 401) return null
      if (!response.ok) throw new Error('Unable to check your account.')
      return response.json() as Promise<{ id: number; email: string }>
    },
  })
  const data = quote.data
  const ready = !!data && data.items.every(item => item.available)
  const authLink = '/login?' + new URLSearchParams({ next: returnTo })

  async function buy() {
    if (!ready || !data || pending) return
    setPending(true)
    setError(undefined)
    try {
      const signature = JSON.stringify([ids, data.totalCents, decline])
      const requestId = attempt?.signature === signature ? attempt.requestId : crypto.randomUUID()
      setAttempt({ signature, requestId })
      setReceipt(await post<Receipt>('checkout', { offers: ids, totalCents: data.totalCents, requestId, decline }))
      if (!direct) cart.remove(ids)
      for (const key of ['home', 'products', 'product', 'quote']) void client.invalidateQueries({ queryKey: [key] })
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error('Unable to place your order.'))
      if (failure instanceof PurchaseError && failure.status === 409) void quote.refetch()
    } finally { setPending(false) }
  }

  if (receipt) return <section className="purchase-panel"><h1>Order #{receipt.id} confirmed</h1>
    <p>Paid {money(receipt.totalCents)} in the demo checkout.</p>
    <ul className="purchase-lines">{receipt.items.map(item => <li key={item.code}><strong>{item.title}</strong><code>{item.code}</code></li>)}</ul>
    <div className="offer-actions"><Link className="button" to="/store">Continue shopping</Link><Link className="button secondary" to={'/account/orders/' + receipt.id}>View order</Link></div>
  </section>

  return <section className="purchase-panel"><h1>{checkout ? 'Checkout' : 'Your cart'}</h1>
    {ids.length === 0 ? <p>{direct ? 'This offer is unavailable.' : 'Your cart is empty.'}</p> :
      quote.isPending ? <p role="status">Checking offers…</p> :
      quote.isError ? <p role="alert">{quote.error.message} <button onClick={() => void quote.refetch()}>Retry</button></p> :
      data && <>
        <ul className="purchase-lines">{data.items.map(item => <li key={item.offerId} className="purchase-item">
          <div className="purchase-product">
            {item.productId ? <Link className="purchase-product-link" to={'/games/' + encodeURIComponent(item.productId)}>
              <Cover key={item.productId} product={{ id: item.productId, title: item.title }} />
              <span><strong>{item.title}</strong><small>{item.seller}</small></span></Link> : <strong>{item.title}</strong>}
          </div>
          <strong>{item.available ? money(item.priceCents) : 'Unavailable'}</strong>
          {!direct && <button className="secondary" disabled={pending} onClick={() => cart.remove([item.offerId])} aria-label={'Remove ' + item.title}>Remove</button>}
        </li>)}</ul>
        <p className="purchase-total">Total <strong>{money(data.totalCents)}</strong></p>
        {checkout && <p>Demo payment. No money is charged.</p>}
        {checkout && ready && account.data && <label className="demo-toggle">
          <input type="checkbox" disabled={pending} checked={decline} onChange={event => setDecline(event.target.checked)} /> Simulate a declined payment
        </label>}
        {error && <p role="alert">{error.message}</p>}
        <div className="offer-actions">
          {!checkout && ready && <Link className="button" to="/checkout">Buy now</Link>}
          {checkout && account.isError && <button onClick={() => void account.refetch()}>Retry account check</button>}
          {checkout && account.isPending && <span role="status">Checking account…</span>}
          {checkout && ready && (account.data === null || (error instanceof PurchaseError && error.status === 401)) && <Link className="button" to={authLink}>Log in to buy</Link>}
          {checkout && ready && account.data && <button onClick={() => void buy()} disabled={pending || quote.isFetching}>{pending ? 'Placing order…' : 'Confirm demo purchase'}</button>}
        </div>
      </>}
    <div className="purchase-nav"><Link to="/store">Continue shopping</Link>{direct && <Link to="/cart">View cart</Link>}</div>
  </section>
}
