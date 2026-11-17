import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000'
const headers = { 'Content-Type': 'application/json', 'X-Game-Market-Request': '1' }

async function post(path, body, status, cookie) {
  const response = await fetch(origin + '/api/' + path, {
    method: 'POST', headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
  })
  const value = await response.json()
  assert.equal(response.status, status, JSON.stringify(value))
  return { value, cookie: response.headers.get('set-cookie')?.split(';')[0] }
}

const listing = await (await fetch(origin + '/api/products?q=cyberpunk')).json()
const offer = listing.items[0].bestOfferId
assert.ok(Number.isInteger(offer))
const { value: quote } = await post('cart/quote', { offers: [offer] }, 200)
assert.equal(quote.items[0].offerId, offer)
assert.equal(quote.items[0].productId, 'cyberpunk-2077')
assert.equal(quote.items[0].available, true)
assert.equal(quote.totalCents, listing.items[0].priceCents)
assert.equal(await (await fetch(origin + '/covers/cyberpunk-2077.jpg')).headers.get('content-type'), 'image/jpeg')

const payload = { offers: [offer], totalCents: quote.totalCents, requestId: randomUUID() }
await post('checkout', payload, 401)
async function account() {
  const { cookie } = await post('auth/register', {
    email: 'checkout-test-' + randomUUID() + '@example.test', password: 'test-password-123',
  }, 201)
  return cookie
}
const cookie = await account()
await post('checkout', { ...payload, decline: true }, 402, cookie)
await post('checkout', { ...payload, totalCents: quote.totalCents + 1 }, 409, cookie)
const [{ value: receipt }, { value: retry }] = await Promise.all([
  post('checkout', payload, 200, cookie), post('checkout', payload, 200, cookie),
])
assert.match(receipt.items[0].code, /^DEMO-/)
assert.deepEqual(receipt, retry)
await post('checkout', { ...payload, totalCents: quote.totalCents + 1 }, 409, cookie)

const other = await account()
const { value: order } = await post('checkout', { ...payload, requestId: randomUUID() }, 200, other)
assert.notEqual(order.items[0].code, receipt.items[0].code)
console.log('Store covers, offer quotes, authentication, demo payment, price confirmation, and unique key allocation passed.')

