import { FormEvent, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { money } from './cart'
import { OfferPrice } from './price'

type Profile = { id: number; name: string; email: string; hasAvatar: boolean }
type Order = { id: number; totalCents: number; createdAt: string }
type Receipt = Order & { items: { title: string; seller: string; priceCents: number; code: string }[] }
type Listing = { id: string; title: string; priceCents: number; originalPriceCents: number; discountPercent: number; stock: number }

class AccountError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

async function request<T>(path: string, signal?: AbortSignal, body?: object, method = body ? 'POST' : 'GET'): Promise<T> {
  const response = await fetch('/api/account' + path, {
    method, signal,
    headers: method !== 'GET' ? { 'Content-Type': 'application/json', 'X-Game-Market-Request': '1' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (response.status === 204) return undefined as T
  const value = await response.json().catch(() => null)
  if (!response.ok) throw new AccountError(response.status, value?.error ?? 'Unable to complete the request.')
  return value
}

function SignIn() {
  return <section className="purchase-panel"><h1>Your account</h1><p>Sign in to access your profile and orders.</p>
    <Link className="button" to="/login?next=%2Faccount">Log in</Link>
  </section>
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function ProfilePage() {
  const query = useQuery({ queryKey: ['account-profile'], queryFn: ({ signal }) => request<Profile>('/', signal) })
  if (query.error instanceof AccountError && query.error.status === 401) return <SignIn />
  if (query.isError) return <p role="alert">{query.error.message} <button onClick={() => void query.refetch()}>Retry</button></p>
  if (!query.data) return <p role="status">Loading account…</p>
  return <div className="profile-page">
    <h1>Your account</h1>
    <nav aria-label="Account" className="profile-nav"><a href="#history">Purchase history</a><a href="#listings">My items</a><Link to="/checkout">Checkout</Link></nav>
    <ProfileSettings key={query.data.id} profile={query.data} />
    <PurchaseHistory userId={query.data.id} />
    <Listings userId={query.data.id} />
  </div>
}

async function encodeAvatar(file: File) {
  if (file.size > 256 * 1024) throw new Error('Choose a JPEG or PNG up to 256 KB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function ProfileSettings({ profile }: { profile: Profile }) {
  const client = useQueryClient()
  const [revision, setRevision] = useState(0)
  const [showPassword, setShowPassword] = useState(false)
  return <section className="profile-section">
    <h2>Profile</h2>
    <div className="profile-identity">
      {profile.hasAvatar ? <img className="avatar" src={'/api/account/avatar?v=' + revision} alt="Your profile picture" />
        : <span className="avatar avatar-placeholder" aria-hidden="true">{(profile.name || profile.email).slice(0, 1).toUpperCase()}</span>}
      <div><strong>{profile.name || 'Your profile'}</strong><div>{profile.email}</div></div>
    </div>
    <AccountForm action={async data => {
      const file = data.get('picture')
      const avatar = file instanceof File && file.size ? await encodeAvatar(file) : data.has('removePicture') ? '' : undefined
      const updated = await request<Profile>('/', undefined, { name: String(data.get('name')), avatar })
      client.setQueryData(['account-profile'], updated)
      setRevision(value => value + 1)
      return 'Profile saved.'
    }}>
      <label>Display name<input name="name" defaultValue={profile.name} maxLength={60} /></label>
      <label>Profile picture (JPEG or PNG, up to 256 KB)<input name="picture" type="file" accept="image/jpeg,image/png" /></label>
      {profile.hasAvatar && <label className="inline-field"><input name="removePicture" type="checkbox" /> Remove profile picture</label>}
      <button type="submit">Save profile</button>
    </AccountForm>
    <button className="secondary" aria-expanded={showPassword} onClick={() => setShowPassword(!showPassword)}>Reset password</button>
    {showPassword && <AccountForm action={async data => {
      if (data.get('new') !== data.get('confirm')) throw new Error('New passwords must match.')
      await request('/password', undefined, { current: data.get('current'), new: data.get('new') })
      return 'Password changed. Other sessions were signed out.'
    }} reset>
      <label>Current password<input name="current" type="password" autoComplete="current-password" required /></label>
      <label>New password<input name="new" type="password" autoComplete="new-password" minLength={8} required /></label>
      <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" minLength={8} required /></label>
      <button type="submit">Change password</button>
    </AccountForm>}
  </section>
}

function AccountForm({ action, reset = false, children }: {
  action: (data: FormData) => Promise<string>; reset?: boolean; children: React.ReactNode
}) {
  const [status, setStatus] = useState<{ message: string; error: boolean }>()
  const [pending, setPending] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    setPending(true)
    setStatus(undefined)
    try {
      const message = await action(new FormData(form))
      if (reset) form.reset()
      setStatus({ message, error: false })
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : 'Unable to save changes.', error: true })
    } finally { setPending(false) }
  }
  return <form className="profile-form" onSubmit={submit}>
    <fieldset disabled={pending}>{children}</fieldset>
    {status && <p role={status.error ? 'alert' : 'status'}>{status.message}</p>}
  </form>
}

function PurchaseHistory({ userId }: { userId: number }) {
  const [params, setParams] = useSearchParams()
  const before = params.get('before') ?? ''
  const query = useQuery({
    queryKey: ['account-orders', userId, before],
    queryFn: ({ signal }) => request<{ items: Order[]; next: number }>('/orders?' + new URLSearchParams({ before }), signal),
  })
  return <section className="profile-section" id="history"><h2>Purchase history</h2>
    {query.isPending && <p role="status">Loading orders…</p>}
    {query.isError && <p role="alert">{query.error.message}</p>}
    {query.data?.items.length === 0 && <p>No purchases yet. <Link to="/store">Browse games</Link></p>}
    <ul className="purchase-lines">{query.data?.items.map(order => <li key={order.id}>
      <Link to={'/account/orders/' + order.id}>Order #{order.id}</Link><span>{dateTime(order.createdAt)}</span><strong>{money(order.totalCents)}</strong>
    </li>)}</ul>
    <div className="offer-actions">
      {before && <button className="secondary" onClick={() => setParams({})}>Latest orders</button>}
      {!!query.data?.next && <button onClick={() => setParams({ before: String(query.data.next) })}>Older orders</button>}
    </div>
  </section>
}

export function OrderPage() {
  const id = useParams().id!
  const query = useQuery({ queryKey: ['account-order', id], queryFn: ({ signal }) => request<Receipt>('/orders/' + encodeURIComponent(id), signal) })
  if (query.error instanceof AccountError && query.error.status === 401) return <SignIn />
  return <section className="purchase-panel"><Link to="/account#history">Purchase history</Link>
    {query.isPending && <p role="status">Loading order…</p>}
    {query.isError && <p role="alert">{query.error.message}</p>}
    {query.data && <><h1>Order #{query.data.id}</h1><p>{dateTime(query.data.createdAt)}</p>
      <ul className="purchase-lines">{query.data.items.map(item => <li key={item.code}>
        <span><strong>{item.title}</strong><small>{item.seller}</small></span><code>{item.code}</code><strong>{money(item.priceCents)}</strong>
      </li>)}</ul><p>Total <strong>{money(query.data.totalCents)}</strong></p>
    </>}
  </section>
}

function Listings({ userId }: { userId: number }) {
  const client = useQueryClient()
  const [created, setCreated] = useState<Listing>()
  const query = useQuery({ queryKey: ['account-items', userId], queryFn: ({ signal }) => request<Listing[]>('/items', signal) })
  const remove = useMutation({
    mutationFn: (itemId: string) => request<void>('/items/' + encodeURIComponent(itemId), undefined, undefined, 'DELETE'),
    onSuccess: (_, itemId) => {
      setCreated(item => item?.id === itemId ? undefined : item)
      for (const key of [['account-items', userId], ['product', itemId], ['ratings', itemId], ['products'], ['home'], ['quote'], ['seller']]) {
        void client.invalidateQueries({ queryKey: key })
      }
    },
  })
  return <section className="profile-section" id="listings"><h2>My items</h2>
    {query.isPending && <p role="status">Loading items…</p>}
    {query.isError && <p role="alert">{query.error.message}</p>}
    {query.data?.length === 0 && <p>You haven’t published any items yet.</p>}
    <ul className="purchase-lines">{query.data?.map(item => <li key={item.id}>
      <Link to={'/games/' + item.id}>{item.title}</Link><span>{item.stock ? item.stock + ' available' : 'Not available right now'}</span><OfferPrice offer={item} />
      <EditListingPrice item={item} userId={userId} />
      <RestockItem item={item} userId={userId} />
      <button className="secondary" disabled={remove.isPending} onClick={() => {
        if (window.confirm('Remove your offer for ' + item.title + '?')) remove.mutate(item.id)
      }} aria-label={'Delete ' + item.title}>Delete</button>
    </li>)}</ul>
    {remove.isSuccess && <p role="status">Item deleted.</p>}
    {remove.isError && <p role="alert">{remove.error.message}</p>}
    <h3>Create item</h3>
    <p>Set how many demo keys you want to make available.</p>
    <AccountForm reset action={async data => {
      const item = await request<Listing>('/items', undefined, {
        title: data.get('title'), description: data.get('description'), platform: data.get('platform'), region: data.get('region'),
        priceCents: Math.round(Number(data.get('price')) * 100), quantity: Number(data.get('quantity')),
      })
      setCreated(item)
      await client.invalidateQueries({ queryKey: ['account-items', userId] })
      for (const key of [['products'], ['product', item.id], ['home'], ['quote'], ['seller']]) {
        void client.invalidateQueries({ queryKey: key })
      }
      return 'Item published.'
    }}>
      <label>Game title<input name="title" maxLength={100} required /></label>
      <label>Description<textarea name="description" maxLength={1000} rows={3} required /></label>
      <label>Platform<select name="platform"><option>Steam</option><option>Xbox</option><option>GOG</option></select></label>
      <label>Region<select name="region"><option>Global</option><option>Europe</option></select></label>
      <label>Price in EUR<input name="price" type="number" min=".01" max="10000" step=".01" required /></label>
      <label>Quantity<input name="quantity" type="number" min="0" max="100" step="1" defaultValue="1" required /></label>
      <button type="submit">Publish item</button>
    </AccountForm>
    {created && <Link to={'/games/' + created.id}>View {created.title}</Link>}
  </section>
}

function RestockItem({ item, userId }: { item: Listing; userId: number }) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  return <div>
    <button className="secondary" disabled={item.stock >= 100} aria-expanded={open}
      aria-label={'Restock ' + item.title} onClick={() => setOpen(!open)}>Restock</button>
    {open && <AccountForm reset action={async data => {
      await request('/items/' + encodeURIComponent(item.id) + '/restock', undefined, { quantity: Number(data.get('quantity')) })
      for (const key of [['account-items', userId], ['product', item.id], ['products'], ['home'], ['quote'], ['seller']]) {
        void client.invalidateQueries({ queryKey: key })
      }
      return 'Stock updated.'
    }}>
      <label>Quantity to add<input name="quantity" type="number" min="1" max={Math.max(1, 100 - item.stock)} step="1" defaultValue="1" required /></label>
      <button type="submit" disabled={item.stock >= 100}>Add stock</button>
    </AccountForm>}
  </div>
}

function EditListingPrice({ item, userId }: { item: Listing; userId: number }) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  return <div>
    <button className="secondary" aria-expanded={open} aria-label={'Edit price for ' + item.title}
      onClick={() => setOpen(!open)}>Edit price</button>
    {open && <AccountForm action={async data => {
      await request('/items/' + encodeURIComponent(item.id) + '/price', undefined, {
        priceCents: Math.round(Number(data.get('price')) * 100),
        discountPercent: Number(data.get('discount')),
      })
      for (const key of [['account-items', userId], ['product', item.id], ['products'], ['home'], ['quote'], ['seller']]) {
        void client.invalidateQueries({ queryKey: key })
      }
      return 'Price updated.'
    }}>
      <label>Base price in EUR<input name="price" type="number" min=".01" max="10000" step=".01"
        defaultValue={(item.originalPriceCents / 100).toFixed(2)} required /></label>
      <label>Discount (%)<input name="discount" type="number" min="0" max="99" step="1"
        defaultValue={item.discountPercent} required /></label>
      <button type="submit">Save price</button>
    </AccountForm>}
  </div>
}
