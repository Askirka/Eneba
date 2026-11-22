import { createContext, ReactNode, useContext, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

type SavedGame = { id: string; title: string }
type Wishlist = { items: SavedGame[]; toggle: (game: SavedGame) => void }
const WishlistContext = createContext<Wishlist | null>(null)
const storageKey = 'game-market-wishlist'

export function WishlistProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<SavedGame[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown
      return Array.isArray(stored) ? stored.filter(game => typeof game?.id === 'string' && typeof game?.title === 'string') : []
    } catch { return [] }
  })
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(items)) } catch {} }, [items])
  function toggle(game: SavedGame) {
    setItems(items => items.some(item => item.id === game.id) ? items.filter(item => item.id !== game.id) : [...items, { id: game.id, title: game.title }])
  }
  return <WishlistContext.Provider value={{ items, toggle }}>{children}</WishlistContext.Provider>
}

export function WishlistLink() {
  const { items } = useContext(WishlistContext)!
  return <Link to="/wishlist"><span aria-hidden="true">♡</span> Wishlist{items.length > 0 && ' (' + items.length + ')'}</Link>
}

export function WishlistButton({ game }: { game: SavedGame }) {
  const { items, toggle } = useContext(WishlistContext)!
  const saved = items.some(item => item.id === game.id)
  return <button className="wishlist-toggle secondary" aria-label={'Wishlist: ' + game.title} aria-pressed={saved}
    onClick={() => toggle(game)}>{saved ? '♥' : '♡'}</button>
}

export function WishlistPage() {
  const { items } = useContext(WishlistContext)!
  return <section className="purchase-panel"><h1>Wishlist</h1>
    {items.length === 0 ? <p>No saved games yet. <Link to="/store">Browse games</Link></p> :
      <ul className="purchase-lines">{items.map(game => <li key={game.id}>
        <Link to={'/games/' + game.id}>{game.title}</Link><WishlistButton game={game} />
      </li>)}</ul>}
  </section>
}
