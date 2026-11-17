import { FormEvent, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

type Comment = { id: number; author: string; body: string; createdAt: string }
type CommentPage = { items: Comment[]; next: number }
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function ProductComments({ productId }: { productId: string }) {
  const client = useQueryClient()
  const { data: account } = useQuery<{ id: number } | null>({ queryKey: ['account'], enabled: false })
  const [draft, setDraft] = useState('')
  const key = ['comments', productId]
  const path = '/api/products/' + encodeURIComponent(productId) + '/comments'
  const comments = useInfiniteQuery({
    queryKey: key,
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const response = await fetch(path + (pageParam ? '?before=' + pageParam : ''), { signal })
      if (!response.ok) throw new Error('Could not load comments.')
      return response.json() as Promise<CommentPage>
    },
    getNextPageParam: last => last.next || undefined,
  })
  const post = useMutation({
    mutationFn: async (body: string) => {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Game-Market-Request': '1' },
        body: JSON.stringify({ body }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error ?? 'Could not post your comment.')
      }
    },
    onSuccess: async () => {
      setDraft('')
      await client.invalidateQueries({ queryKey: key })
    },
  })
  const items = comments.data?.pages.flatMap(page => page.items)
  const length = Array.from(draft).length
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!post.isPending && draft.trim() && length <= 1000) post.mutate(draft)
  }

  return <section className="profile-section product-comments" aria-labelledby="product-comments-title">
    <h2 id="product-comments-title">Comments</h2>
    {account ? <form className="profile-form" onSubmit={submit}>
      <fieldset disabled={post.isPending}>
        <label>Your comment<textarea rows={3} value={draft} onChange={event => setDraft(event.target.value)}
          aria-describedby="comment-length" required /></label>
        <small id="comment-length">{length} / 1000 characters</small>
        <button disabled={!draft.trim() || length > 1000}>{post.isPending ? 'Posting…' : 'Post comment'}</button>
      </fieldset>
    </form> : account === null && <Link to={'/login?' + new URLSearchParams({ next: '/games/' + productId })}>Log in to comment</Link>}
    {post.isSuccess && <p role="status">Comment posted.</p>}
    {post.isError && <p role="alert">{post.error.message}</p>}
    {comments.isPending && <p role="status">Loading comments…</p>}
    {comments.isLoadingError && <p role="alert">{comments.error.message} <button onClick={() => void comments.refetch()}>Retry</button></p>}
    {items?.length === 0 && <p>No comments yet.</p>}
    {!!items?.length && <ul className="comment-list">{items.map(item => <li key={item.id}>
      <div><strong>{item.author}</strong> <time dateTime={item.createdAt}>{date.format(new Date(item.createdAt))}</time></div>
      <p>{item.body}</p>
    </li>)}</ul>}
    {comments.isFetchNextPageError && <p role="alert">Could not load older comments.</p>}
    {comments.hasNextPage && <button className="secondary" disabled={comments.isFetching}
      onClick={() => void comments.fetchNextPage()}>Load older comments</button>}
  </section>
}
