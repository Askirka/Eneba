import assert from 'node:assert/strict'

const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000'

async function json(path, status = 200) {
  const response = await fetch(origin + path)
  assert.equal(response.status, status, path)
  return response.json()
}

const home = await json('/api/home')
assert.deepEqual(home.map(block => block.type), ['hero', 'best_sellers', 'deals'])
for (const term of ['Cyberpunk 2077', 'cyber', 'cyberpnk']) {
  const result = await json('/api/search?' + new URLSearchParams({ q: term }))
  assert.equal(result.items[0]?.id, 'cyberpunk-2077', term)
}
const witcher = await json('/api/search?q=witchr')
assert.equal(witcher.items[0]?.id, 'the-witcher-3')
const filters = '/api/products?platform=Steam&region=Europe&min=100&max=10000&sort=price_asc&limit=2'
const first = await json(filters)
const second = await json(filters + '&page=2')
const products = [...first.items, ...second.items]
assert.equal(products.length, 4)
assert.equal(new Set(products.map(game => game.id)).size, 4)
assert.ok(products.every(game => game.platform === 'Steam' && game.region === 'Europe'))
assert.deepEqual(products.map(game => game.priceCents), products.map(game => game.priceCents).sort((a, b) => a - b))
const detail = await json('/api/products/cyberpunk-2077')
assert.equal(detail.offers.length, 3)
assert.ok(detail.offers.every(offer => offer.stock > 0 && !('code' in offer)))
await json('/api/products/missing', 404)
await json('/api/products?limit=100', 400)
assert.match(await (await fetch(origin + '/games/hades')).text(), /<div id="root">/)
console.log('Homepage, search, filters, pagination, offers, errors, and SPA fallback passed.')

