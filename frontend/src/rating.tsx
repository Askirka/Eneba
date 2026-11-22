import { apiFetch } from './api-fetch'
import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

type Rating = { average: number | null; count: number; mine: number | null }

export function ProductRating({ productId }: { productId: string }) {
  const client = useQueryClient()
  const { data: account } = useQuery<{ id: number } | null>({ queryKey: ['account'], enabled: false })
  const path = '/api/products/' + encodeURIComponent(productId) + '/ratings'
  const key = ['ratings', productId, account?.id ?? null]
  const [selected, setSelected] = useState<string>()
  const summary = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(path, { signal })
      if (!response.ok) throw new Error('Could not load ratings.')
      return response.json() as Promise<Rating>
    },
  })

  const save = useMutation({
    mutationFn: async (grade: number) => {
      const response = await apiFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Game-Market-Request': '1' },
        body: JSON.stringify({ grade }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error ?? 'Could not save your rating.')
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['ratings', productId] })
      setSelected(undefined)
    },
  })

  const choice = selected ?? String(summary.data?.mine ?? '')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (choice !== '' && !save.isPending) save.mutate(Number(choice))
  }

  return <section className="profile-section rating-panel" aria-label="Game rating">
    <h2>Game rating</h2>
    {summary.isPending && <p role="status">Loading ratings…</p>}
    {summary.isError && <p role="alert">{summary.error.message}</p>}
    {summary.data && <p>{summary.data.average === null ? 'No ratings yet.' :
      <><strong>{summary.data.average.toFixed(1)} / 10</strong> · {summary.data.count} {summary.data.count === 1 ? 'rating' : 'ratings'}</>}</p>}
    {account ? <form className="offer-actions" onSubmit={submit}>
      <label>Your rating <select value={choice} onChange={event => { save.reset(); setSelected(event.target.value) }} disabled={save.isPending}>
        <option value="">Choose a grade</option>
        {Array.from({ length: 11 }, (_, grade) => <option key={grade} value={grade}>{grade}</option>)}
      </select></label>
      <button disabled={choice === '' || save.isPending}>{save.isPending ? 'Saving…' : 'Save rating'}</button>
    </form> : account === null && <Link to={'/login?' + new URLSearchParams({ next: '/games/' + productId })}>Log in to rate this game</Link>}
    {save.isSuccess && <p role="status">Rating saved.</p>}
    {save.isError && <p role="alert">{save.error.message}</p>}
  </section>
}
