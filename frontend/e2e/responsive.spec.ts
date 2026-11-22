import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

test('all storefront pages fit at mobile, tablet, and desktop widths', async ({ browser, page }, testInfo) => {
  test.setTimeout(120_000)
  const guest = await browser.newPage()
  const headers = { 'X-Game-Market-Request': '1' }
  const api = page.context().request
  const email = 'layout-' + randomUUID() + '@example.test'
  const registration = await api.post('/api/auth/register', {
    headers, data: { email, password: 'layout-test-password' },
  })
  expect(registration.status()).toBe(201)
  const created = await api.post('/api/account/items', {
    headers,
    data: { title: 'Responsive layout demo ' + randomUUID(), description: 'Screenshot fixture.', platform: 'Steam', region: 'Global', priceCents: 500, quantity: 1 },
  })
  expect(created.status()).toBe(201)
  const listing = await created.json()

  try {
    const product = await (await api.get('/api/products/' + listing.id)).json()
    const checkout = await api.post('/api/checkout', {
      headers, data: { offers: [product.product.bestOfferId], totalCents: 500, requestId: randomUUID() },
    })
    expect(checkout.status()).toBe(200)
    const order = await checkout.json()

    await page.goto('/store?q=hades')
    const card = page.locator('.card').filter({ has: page.getByRole('link', { name: 'Hades', exact: true }) })
    await card.getByRole('button', { name: 'Wishlist: Hades', exact: true }).click()
    await card.getByRole('link', { name: 'Add to cart', exact: true }).click()
    await expect(page).toHaveURL(/\/cart$/)

    const examples = [
      { name: 'home', path: '/', ready: 'Your next game starts here' },
      { name: 'store', path: '/store', ready: 'Game catalog' },
      { name: 'search', path: '/store?q=cyberpnk', ready: 'Game catalog' },
      { name: 'product', path: '/games/hades', ready: 'Hades' },
      { name: 'cart', path: '/cart', ready: 'Your cart' },
      { name: 'checkout', path: '/checkout', ready: 'Checkout' },
      { name: 'login', path: '/login', ready: 'Log in', guest: true },
      { name: 'register', path: '/register', ready: 'Create account', guest: true },
      { name: 'account', path: '/account', ready: 'Your account' },
      { name: 'order', path: '/account/orders/' + order.id, ready: 'Order #' + order.id },
      { name: 'seller', path: '/sellers/1', ready: 'Pixel Harbor' },
      { name: 'wishlist', path: '/wishlist', ready: 'Wishlist' },
    ]
    const directory = join(testInfo.project.outputDir, 'responsive')
    await mkdir(directory, { recursive: true })
    for (const width of [360, 768, 1280]) {
      for (const example of examples) {
        await test.step(width + 'px ' + example.name, async () => {
          const current = example.guest ? guest : page
          await current.setViewportSize({ width, height: 900 })
          await current.goto(new URL(example.path, testInfo.project.use.baseURL).href)
          await expect(current.getByRole('heading', { level: 1, name: example.ready, exact: true })).toBeVisible()
          await expect(current.getByText('Loading…', { exact: true })).toHaveCount(0)
          if (example.name === 'cart' || example.name === 'checkout') {
            await expect(current.locator('.purchase-product-link').first()).toBeVisible()
          }
          if (example.name === 'account') {
            await expect(current.getByRole('link', { name: 'Order #' + order.id })).toBeVisible()
          }
          await expect(current.getByRole('contentinfo').getByRole('navigation')).toHaveCount(5)
          const overflow = await current.evaluate(() => document.documentElement.scrollWidth - innerWidth)
          expect(overflow).toBeLessThanOrEqual(0)
          if (width <= 768) {
            const targets = current.locator('.footer-columns a, .masthead .cart-link, .wishlist-toggle, .offer-actions .button')
            const heights = await targets.evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height))
            expect(heights.every(height => height >= 44)).toBeTruthy()
          }
          await current.locator('img[loading="lazy"]').evaluateAll(images => {
            for (const image of images) if (image instanceof HTMLImageElement) image.loading = 'eager'
          })
          await current.screenshot({ path: join(directory, width + '-' + example.name + '.png'), fullPage: true, animations: 'disabled' })
        })
      }
    }
  } finally {
    await api.delete('/api/account/items/' + listing.id, { headers })
    await guest.close()
  }
})
