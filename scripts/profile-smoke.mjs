import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const base = (process.env.WEB_ORIGIN ?? 'http://localhost:3000') + '/api'
const email = 'profile-test-' + randomUUID() + '@example.test'
const otherEmail = 'profile-test-' + randomUUID() + '@example.test'
const old = 'old-password-123'
const fresh = 'new-password-123'
const picture = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXY2hgaPgPAAQEAgCs4Z27AAAAAElFTkSuQmCC'

async function call(path, status, { body, cookie, method = body ? 'POST' : 'GET' } = {}) {
  const headers = cookie ? { Cookie: cookie } : {}
  if (method !== 'GET') Object.assign(headers, { 'Content-Type': 'application/json', 'X-Game-Market-Request': '1' })
  const response = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) })
  assert.equal(response.status, status, path + (response.status !== status ? ': ' + await response.text() : ''))
  return response
}
const cookieOf = response => response.headers.get('set-cookie').split(';')[0]
const register = async email => cookieOf(await call('/auth/register', 201, { body: { email, password: old } }))
await call('/account/', 401)
const item = { title: 'Demo listing ' + randomUUID(), description: 'Integration test listing.', platform: 'Steam', region: 'Global', priceCents: 459 }
await call('/account/items', 401, { body: item })
const seller = await register(email)
const buyer = await register(otherEmail)
const additionalSession = cookieOf(await call('/auth/login', 200, { body: { email, password: old } }))

const profile = await (await call('/account/', 200, { cookie: seller })).json()
assert.equal(profile.email, email)
assert.equal(profile.hasAvatar, false)
const updated = await (await call('/account/', 200, { cookie: seller, body: { name: 'Demo Seller', avatar: picture } })).json()
assert.equal(updated.name, 'Demo Seller')
assert.equal(updated.hasAvatar, true)
const avatar = await call('/account/avatar', 200, { cookie: seller })
assert.equal(avatar.headers.get('content-type'), 'image/png')
assert.equal(Buffer.from(await avatar.arrayBuffer()).toString('base64'), picture)
const removed = await (await call('/account/', 200, { cookie: seller, body: { name: 'Demo Seller', avatar: '' } })).json()
assert.equal(removed.hasAvatar, false)
await call('/account/avatar', 404, { cookie: seller })

await call('/account/password', 400, { cookie: seller, body: { current: 'wrong-password', new: fresh } })
await call('/account/password', 204, { cookie: seller, body: { current: old, new: fresh } })
await call('/auth/me', 401, { cookie: additionalSession })
await call('/auth/login', 401, { body: { email, password: old } })
await call('/auth/login', 200, { body: { email, password: fresh } })

const listing = await (await call('/account/items', 201, { cookie: seller, body: item })).json()
assert.equal(listing.stock, 1)
const publicItem = await (await call('/products/' + listing.id, 200)).json()
const offer = publicItem.product.bestOfferId
const ratingsPath = '/products/' + listing.id + '/ratings'
assert.deepEqual(await (await call(ratingsPath, 200)).json(), { average: null, count: 0, mine: null })
await call(ratingsPath, 401, { body: { grade: 10 } })
await call(ratingsPath, 400, { cookie: buyer, body: { grade: null } })
await call(ratingsPath, 400, { cookie: buyer, body: { grade: 11 } })
await call(ratingsPath, 204, { cookie: buyer, body: { grade: 0 } })
assert.deepEqual(await (await call(ratingsPath, 200, { cookie: buyer })).json(), { average: 0, count: 1, mine: 0 })
await call(ratingsPath, 204, { cookie: buyer, body: { grade: 10 } })
assert.deepEqual(await (await call(ratingsPath, 200, { cookie: seller })).json(), { average: 10, count: 1, mine: null })
const commentsPath = '/products/' + listing.id + '/comments'
assert.deepEqual(await (await call(commentsPath, 200)).json(), { items: [], next: 0 })
await call(commentsPath, 401, { body: { body: 'Guest comment' } })
await call(commentsPath, 400, { cookie: buyer, body: { body: '  ' } })
await call(commentsPath, 400, { cookie: buyer, body: { body: 'x'.repeat(1001) } })
const comment = await (await call(commentsPath, 201, { cookie: seller, body: { body: '  My demo comment  ' } })).json()
assert.equal(comment.body, 'My demo comment')
assert.equal(comment.author, 'Demo Seller')
assert.deepEqual(Object.keys(comment).sort(), ['author', 'body', 'createdAt', 'id'])
const recent = await (await call(commentsPath, 201, { cookie: buyer, body: { body: 'Second comment' } })).json()
assert.deepEqual((await (await call(commentsPath, 200)).json()).items, [recent, comment])
assert.deepEqual((await (await call(commentsPath + '?before=' + recent.id, 200)).json()).items, [comment])
await call(commentsPath + '?before=invalid', 400)
const deletePath = '/account/items/' + listing.id
await call(deletePath, 401, { method: 'DELETE' })
await call(deletePath, 403, { method: 'DELETE', cookie: buyer })
assert.equal(publicItem.product.title, item.title)
assert.equal((await (await call('/account/items', 200, { cookie: seller })).json())[0].id, listing.id)
assert.deepEqual(await (await call('/account/items', 200, { cookie: buyer })).json(), [])

const purchase = await (await call('/checkout', 200, { cookie: buyer, body: {
  offers: [offer], totalCents: item.priceCents, requestId: randomUUID(),
} })).json()
const orders = await (await call('/account/orders', 200, { cookie: buyer })).json()
assert.equal(orders.items[0].id, purchase.id)
assert.ok(Number.isFinite(Date.parse(orders.items[0].createdAt)))
const detail = await (await call('/account/orders/' + purchase.id, 200, { cookie: buyer })).json()
assert.equal(detail.items[0].code, purchase.items[0].code)
await call('/account/orders/' + purchase.id, 404, { cookie: seller })
assert.equal((await (await call('/account/items', 200, { cookie: seller })).json())[0].stock, 0)
console.log('Private profiles, avatar upload/removal, password change, authenticated listings, and buyer-only order history passed.')


await call(deletePath, 204, { method: 'DELETE', cookie: seller })
await call('/products/' + listing.id, 404)
await call(ratingsPath, 404)
await call(commentsPath, 404)
await call(commentsPath, 404, { cookie: seller, body: { body: 'Removed item' } })
await call(ratingsPath, 404, { cookie: seller, body: { grade: 8 } })
const search = await (await call('/products?q=' + encodeURIComponent(item.title), 200)).json()
assert.ok(!search.items.some(product => product.id === listing.id))
assert.deepEqual(await (await call('/account/items', 200, { cookie: seller })).json(), [])
const quote = await (await call('/cart/quote', 200, { body: { offers: [offer] } })).json()
assert.equal(quote.items[0].available, false)
const archivedOrder = await (await call('/account/orders/' + purchase.id, 200, { cookie: buyer })).json()
assert.equal(archivedOrder.items[0].code, purchase.items[0].code)
console.log('Ratings from 0 to 10, creator-only removal, catalog visibility, and historical orders passed.')
console.log('Comments are public, bound to a product, paginated, and writable only by signed-in users.')

const shared = { ...item, title: 'Shared game ' + randomUUID(), priceCents: 900 }
const firstOffer = await (await call('/account/items', 201, { cookie: seller, body: shared })).json()
const cheaper = { ...shared, title: ' ' + shared.title.toUpperCase() + ' ', priceCents: 550 }
const secondOffer = await (await call('/account/items', 201, { cookie: buyer, body: cheaper })).json()
assert.equal(firstOffer.id, secondOffer.id)
await call('/account/items', 409, { cookie: buyer, body: cheaper })
const sharedPath = '/products/' + firstOffer.id
const sharedProduct = await (await call(sharedPath, 200)).json()
assert.deepEqual(sharedProduct.offers.map(offer => offer.priceCents), [550, 900])
assert.equal(sharedProduct.product.priceCents, 550)
assert.equal(sharedProduct.product.bestOfferId, sharedProduct.offers[0].id)
const sharedSearch = await (await call('/products?q=' + encodeURIComponent(shared.title), 200)).json()
assert.deepEqual(sharedSearch.items.filter(product => product.title === shared.title).map(product => product.id), [firstOffer.id])
const differentRegion = await (await call('/account/items', 201, { cookie: buyer, body: { ...cheaper, region: 'Europe' } })).json()
assert.notEqual(differentRegion.id, firstOffer.id)
await call('/account/items/' + differentRegion.id, 204, { cookie: buyer, method: 'DELETE' })

const cheapOffer = sharedProduct.offers[0].id
await call('/checkout', 200, { cookie: seller, body: { offers: [cheapOffer], totalCents: 550, requestId: randomUUID() } })
const afterPurchase = await (await call(sharedPath, 200)).json()
assert.equal(afterPurchase.product.priceCents, 900)
assert.equal(afterPurchase.product.bestOfferId, sharedProduct.offers[1].id)
assert.equal(afterPurchase.offers[0].stock, 0)
await call('/account/items/' + firstOffer.id, 204, { cookie: buyer, method: 'DELETE' })
assert.equal((await (await call(sharedPath, 200)).json()).offers.length, 1)
assert.equal((await (await call('/account/items', 200, { cookie: seller })).json())[0].id, firstOffer.id)
await call('/account/items/' + firstOffer.id, 403, { cookie: buyer, method: 'DELETE' })
await call('/account/items/' + firstOffer.id, 204, { cookie: seller, method: 'DELETE' })
await call(sharedPath, 404)
console.log('Shared product, distinct regions, cheapest available offer, checkout, and independent offer removal passed.')

const inventory = { ...item, title: 'Inventory game ' + randomUUID(), quantity: 2 }
await call('/account/items', 400, { cookie: seller, body: { ...inventory, quantity: -1 } })
await call('/account/items', 400, { cookie: seller, body: { ...inventory, quantity: 101 } })
const stocked = await (await call('/account/items', 201, { cookie: seller, body: inventory })).json()
const empty = await (await call('/account/items', 201, { cookie: seller, body: { ...inventory, title: 'No stock ' + randomUUID(), quantity: 0 } })).json()
assert.equal(stocked.stock, 2)
assert.equal(empty.stock, 0)
const stockedPath = '/products/' + stocked.id
const inventoryOffer = (await (await call(stockedPath, 200)).json()).offers[0]
assert.equal(inventoryOffer.stock, 2)
const sellerPath = '/sellers/' + inventoryOffer.sellerId
const store = await (await call(sellerPath, 200)).json()
assert.equal(store.seller.name, inventoryOffer.seller)
assert.equal(store.items.find(product => product.id === stocked.id).bestOfferId, inventoryOffer.id)
assert.equal(store.items.find(product => product.id === empty.id).bestOfferId, null)
await call(sellerPath + '?page=0', 400)
await call('/sellers/invalid', 404)
let previousKey
for (let remaining = 1; remaining >= 0; remaining--) {
  const purchased = await (await call('/checkout', 200, { cookie: buyer, body: {
    offers: [inventoryOffer.id], totalCents: inventory.priceCents, requestId: randomUUID(),
  } })).json()
  assert.notEqual(purchased.items[0].code, previousKey)
  previousKey = purchased.items[0].code
  assert.equal((await (await call(stockedPath, 200)).json()).offers[0].stock, remaining)
}
assert.equal((await (await call(sellerPath, 200)).json()).items.find(product => product.id === stocked.id).bestOfferId, null)
const restock = '/account/items/' + stocked.id + '/restock'
await call(restock, 401, { body: { quantity: 3 } })
await call(restock, 403, { cookie: buyer, body: { quantity: 3 } })
await call(restock, 400, { cookie: seller, body: { quantity: 0 } })
assert.deepEqual(await (await call(restock, 200, { cookie: seller, body: { quantity: 3 } })).json(), { stock: 3 })
await call(restock, 409, { cookie: seller, body: { quantity: 98 } })
const replenished = await (await call(stockedPath, 200)).json()
assert.equal(replenished.offers[0].stock, 3)
assert.equal(replenished.product.bestOfferId, inventoryOffer.id)
const purchaseAfterRestock = await (await call('/checkout', 200, { cookie: buyer, body: {
  offers: [inventoryOffer.id], totalCents: inventory.priceCents, requestId: randomUUID(),
} })).json()
assert.notEqual(purchaseAfterRestock.items[0].code, previousKey)
assert.equal((await (await call(stockedPath, 200)).json()).offers[0].stock, 2)
await call('/account/items/' + stocked.id, 204, { cookie: seller, method: 'DELETE' })
console.log('Owner-only restock, quantity limit, and purchase after restock passed.')
await call('/account/items/' + empty.id, 204, { cookie: seller, method: 'DELETE' })
assert.ok(!(await (await call(sellerPath, 200)).json()).items.some(product => product.id === stocked.id || product.id === empty.id))
console.log('Multiple keys, zero stock, public seller storefront, and removal passed.')

const pricing = { ...item, title: 'Discounted game ' + randomUUID(), quantity: 2, priceCents: 1000 }
const pricedItem = await (await call('/account/items', 201, { cookie: seller, body: pricing })).json()
const pricePath = '/account/items/' + pricedItem.id + '/price'
const discount = { priceCents: 1200, discountPercent: 50 }
await call(pricePath, 401, { body: discount })
await call(pricePath, 403, { cookie: buyer, body: discount })
await call(pricePath, 400, { cookie: seller, body: { ...discount, discountPercent: 100 } })
await call('/account/items', 201, { cookie: buyer, body: { ...pricing, priceCents: 800 } })
const changed = await (await call(pricePath, 200, { cookie: seller, body: discount })).json()
assert.deepEqual(changed, { priceCents: 600, originalPriceCents: 1200, discountPercent: 50 })
const discounted = await (await call('/products/' + pricedItem.id, 200)).json()
assert.deepEqual(discounted.offers.map(offer => offer.priceCents), [600, 800])
const bestOffer = discounted.offers[0]
assert.equal(discounted.product.bestOfferId, bestOffer.id)
assert.equal(discounted.product.originalPriceCents, 1200)
assert.equal((await (await call('/sellers/' + bestOffer.sellerId, 200)).json()).items.find(product => product.id === pricedItem.id).priceCents, 600)
const discountedQuote = await (await call('/cart/quote', 200, { body: { offers: [bestOffer.id] } })).json()
assert.equal(discountedQuote.totalCents, 600)
const pay = { offers: [bestOffer.id], totalCents: 600, requestId: randomUUID() }
await call('/checkout', 409, { cookie: buyer, body: { ...pay, totalCents: 1000 } })
const discountedOrder = await (await call('/checkout', 200, { cookie: buyer, body: pay })).json()
assert.equal(discountedOrder.items[0].priceCents, 600)
await call(pricePath, 200, { cookie: seller, body: { ...discount, discountPercent: 0 } })
const afterDiscount = await (await call('/products/' + pricedItem.id, 200)).json()
assert.deepEqual(afterDiscount.offers.map(offer => offer.priceCents), [800, 1200])
const orderAfterEdit = await (await call('/account/orders/' + discountedOrder.id, 200, { cookie: buyer })).json()
assert.equal(orderAfterEdit.items[0].priceCents, 600)
await call('/account/items/' + pricedItem.id, 204, { cookie: seller, method: 'DELETE' })
await call('/account/items/' + pricedItem.id, 204, { cookie: buyer, method: 'DELETE' })
console.log('Owner-only price changes, discounts, offer ranking, checkout price and order history passed.')
