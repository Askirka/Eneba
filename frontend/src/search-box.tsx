import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './api-fetch'

type Suggestion = { id: string; title: string; platform: string; region: string }

export function SearchBox() {
  const location = useLocation()
  const navigate = useNavigate()
  const [input, setInput] = useState(new URLSearchParams(location.search).get('q') ?? '')
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(input.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [input])

  const results = useQuery({
    queryKey: ['suggestions', term],
    enabled: open && term.length >= 2,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ q: term, limit: '5' })
      const response = await apiFetch('/api/search?' + params, { signal })
      if (!response.ok) throw new Error('Could not load suggestions.')
      return response.json() as Promise<{ items: Suggestion[] }>
    },
  })
  const show = open && term.length >= 2 && term === input.trim()
  return <form role="search" className="header-search" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }} onSubmit={event => {
    event.preventDefault()
    setOpen(false)
    const params = input.trim() ? '?' + new URLSearchParams({ q: input.trim() }) : ''
    navigate('/store' + params)
  }}>
    <input aria-label="Search games" placeholder="Search games" maxLength={100} value={input}
      onFocus={() => setOpen(true)} onChange={event => { setInput(event.target.value); setOpen(true) }}
      onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }} />
    <button>Search</button>
    {show && <div className="search-popup" aria-label="Search suggestions">
      {results.isPending && <p role="status">Searching…</p>}
      {results.isError && <p role="status">Suggestions are unavailable.</p>}
      {results.data?.items.length === 0 && <p>No matching games.</p>}
      {!!results.data?.items.length && <ul>{results.data.items.map(item => <li key={item.id}>
        <Link to={'/games/' + item.id} onClick={() => setOpen(false)}><strong>{item.title}</strong><small>{item.platform} · {item.region}</small></Link>
      </li>)}</ul>}
    </div>}
  </form>
}
