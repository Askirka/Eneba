import { FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

type Account = { id: number; email: string }
type Credentials = { email: string; password: string }
const accountKey = ['account'] as const

async function currentAccount(signal: AbortSignal): Promise<Account | null> {
  const response = await fetch('/api/auth/me', { signal })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('Unable to check your account.')
  return response.json()
}

async function authPost<T>(action: string, credentials?: Credentials): Promise<T> {
  const response = await fetch('/api/auth/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Game-Market-Request': '1' },
    body: credentials ? JSON.stringify(credentials) : undefined,
  })
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? 'Unable to complete the request. Try again.')
  return body
}

export function AccountControls() {
  const client = useQueryClient()
  const account = useQuery({ queryKey: accountKey, queryFn: ({ signal }) => currentAccount(signal) })
  const logout = useMutation({
    mutationFn: () => authPost<void>('logout'),
    onSuccess: async () => {
      await client.cancelQueries({ queryKey: accountKey })
      client.setQueryData(accountKey, null)
    },
  })

  if (account.isPending) return <span role="status">Checking account…</span>
  if (account.isError) return <button onClick={() => void account.refetch()}>Retry account check</button>
  if (!account.data) return <div className="account-controls"><Link to="/login">Log in</Link><Link to="/register">Create account</Link></div>
  return <div className="account-controls">
    <span className="account-email">{account.data.email}</span>
    <button onClick={() => logout.mutate()} disabled={logout.isPending}>{logout.isPending ? 'Logging out…' : 'Log out'}</button>
    {logout.isError && <span role="alert">{logout.error.message}</span>}
  </div>
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') ?? ''
  const destination = /^\/checkout(?:\?offer=[1-9]\d*)?$/.test(next) ? next : '/'
  const authQuery = destination === '/' ? '' : '?' + new URLSearchParams({ next: destination })
  const [password, setPassword] = useState('')
  const register = mode === 'register'
  const title = register ? 'Create account' : 'Log in'
  const submit = useMutation({
    mutationFn: (credentials: Credentials) => authPost<Account>(mode, credentials),
    onSuccess: async (account) => {
      await client.cancelQueries({ queryKey: accountKey })
      client.setQueryData(accountKey, account)
      navigate(destination, { replace: true })
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submit.isPending) return
    const email = String(new FormData(event.currentTarget).get('email')).trim()
    if (register && new TextEncoder().encode(password).length > 72) {
      event.currentTarget.querySelector('input[name="password"]')?.setAttribute('aria-invalid', 'true')
      return
    }
    submit.mutate({ email, password })
  }

  const tooLong = new TextEncoder().encode(password).length > 72
  return <section className="auth-panel" aria-labelledby="auth-title">
    <h1 id="auth-title">{title}</h1>
    <form onSubmit={handleSubmit}>
      <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
      <label>Password<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'}
        minLength={register ? 8 : undefined} required value={password} onChange={event => setPassword(event.target.value)}
        aria-invalid={tooLong} aria-describedby={tooLong ? 'password-length' : undefined} /></label>
      {tooLong && <p id="password-length" role="alert">Use a password of at most 72 bytes.</p>}
      {submit.isError && <p role="alert">{submit.error.message}</p>}
      <button disabled={submit.isPending || tooLong}>{submit.isPending ? 'Please wait…' : title}</button>
    </form>
    {register ? <Link to={'/login' + authQuery}>Already registered? Log in</Link> : <Link to={'/register' + authQuery}>Create an account</Link>}
  </section>
}
