import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000'
const apiOrigin = process.env.API_ORIGIN ?? origin
const email = 'account-test-' + randomUUID() + '@example.test'
const password = 'test-account-password-123'

async function request(method, endpoint, status, { cookie, body, csrf = true } = {}) {
  const headers = {}
  if (csrf) headers['X-Game-Market-Request'] = '1'
  if (cookie) headers.Cookie = cookie
  if (body) headers['Content-Type'] = 'application/json'
  const response = await fetch(apiOrigin + '/api/auth/' + endpoint, {
    method, headers, body: body && JSON.stringify(body),
  })
  assert.equal(response.status, status, endpoint)
  assert.equal(response.headers.get('cache-control'), 'no-store', endpoint)
  return response
}

function readCookie(response) {
  const cookie = response.headers.get('set-cookie')
  assert.match(cookie, /HttpOnly/i)
  assert.match(cookie, /SameSite=Lax/i)
  return cookie.split(';')[0]
}

await request('GET', 'me', 401)
await request('POST', 'register', 403, { csrf: false, body: { email, password } })
await request('POST', 'register', 400, { body: { email, password: 'short' } })
const registered = await request('POST', 'register', 201, { body: { email: email.toUpperCase(), password } })
const user = await registered.json()
assert.deepEqual(Object.keys(user).sort(), ['email', 'id'])
assert.equal(user.email, email)
const initialCookie = readCookie(registered)
assert.deepEqual(await (await request('GET', 'me', 200, { cookie: initialCookie })).json(), user)
await request('POST', 'register', 409, { body: { email, password } })

const guest = await request('POST', 'login', 401, { body: { email, password: 'wrong-password' } })
assert.equal(guest.headers.get('set-cookie'), null)
const login = await request('POST', 'login', 200, { cookie: initialCookie, body: { email, password } })
assert.deepEqual(await login.json(), user)
const session = readCookie(login)
assert.notEqual(session, initialCookie)
await request('GET', 'me', 401, { cookie: initialCookie })
await request('POST', 'logout', 403, { cookie: session, csrf: false })
assert.deepEqual(await (await request('GET', 'me', 200, { cookie: session })).json(), user)
const logout = await request('POST', 'logout', 204, { cookie: session })
assert.match(logout.headers.get('set-cookie'), /Max-Age=0/i)
await request('GET', 'me', 401, { cookie: session })

const relogin = await request('POST', 'login', 200, { body: { email, password } })
assert.deepEqual(await relogin.json(), user)
await request('POST', 'logout', 204, { cookie: readCookie(relogin) })
for (const route of ['login', 'register']) {
  const response = await fetch(origin + '/' + route)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /<div id="root">/)
}
console.log('Account registration, duplicate and invalid input, login, session rotation, CSRF, logout, and relogin passed.')

