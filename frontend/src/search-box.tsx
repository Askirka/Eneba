import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './api-fetch'

type Suggestion = { id: string; title: string; platform: string; region: string }

function storeParams(path: string, search: string, term: string) {
  const params = new URLSearchParams(path === '/store' ? search : '')
  params.delete('page')
  if (term) params.set('q', term)
  else params.delete('q')
  return params
}

export function SearchBox() {
  const location = useLocation()
  const navigate = useNavigate()
  const [input, setInput] = useState(new URLSearchParams(location.search).get('q') ?? '')
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(input.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [input])

  const params = storeParams(location.pathname, location.search, term)
  params.set('sort', 'relevance')
  params.set('limit', '5')
  const results = useQuery({
    queryKey: ['suggestions', params.toString()],
    enabled: open && term.length >= 2,
    queryFn: async ({ signal }) => {
      const response = await apiFetch('/api/search?' + params, { signal })
      if (!response.ok) throw new Error('Could not load suggestions.')
      return response.json() as Promise<{ items: Suggestion[] }>
    },
  })
  const show = open && term.length >= 2 && term === input.trim()
  const items = show ? results.data?.items ?? [] : []
  const selected = items[active]
  function close() { setOpen(false); setActive(-1) }

  return <form role="search" className="header-search" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) close()
  }} onSubmit={event => {
    event.preventDefault()
    close()
    if (selected) { navigate('/games/' + selected.id); return }
    const filters = storeParams(location.pathname, location.search, input.trim()).toString()
    navigate('/store' + (filters ? '?' + filters : ''))
  }}>
    <input role="combobox" aria-label="Search games" aria-autocomplete="list" aria-expanded={show}
      aria-controls={show ? 'game-suggestions' : undefined}
      aria-activedescendant={selected ? 'suggestion-' + selected.id : undefined}
      placeholder="Search games" maxLength={100} value={input}
      onFocus={() => setOpen(true)} onChange={event => { setInput(event.target.value); setOpen(true); setActive(-1) }}
      onKeyDown={event => {
        if (event.key === 'Escape') close()
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && items.length) {
          event.preventDefault()
          const move = event.key === 'ArrowDown' ? 1 : -1
          setActive(active === -1 && move === -1 ? items.length - 1 : (active + move + items.length) % items.length)
        }
      }} />
    <button onClick={() => setActive(-1)}>Search</button>
    {show && <div className="search-popup" aria-label="Search suggestions">
      {results.isPending && <p role="status">Searching...</p>}
      {results.isError && <p role="status">Suggestions are unavailable.</p>}
      {results.data?.items.length === 0 && <p>No matching games.</p>}
      <ul id="game-suggestions" role="listbox" aria-label="Matching games">{items.map((item, index) => <li key={item.id} role="presentation">
        <Link id={'suggestion-' + item.id} role="option" aria-selected={index === active} tabIndex={-1}
          to={'/games/' + item.id} onMouseDown={event => event.preventDefault()} onClick={close}>
          <strong>{item.title}</strong><small>{item.platform} · {item.region}</small>
        </Link>
      </li>)}</ul>
    </div>}
  </form>
}
