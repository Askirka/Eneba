import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('a guest can browse, sign in, and receive a demo key', async ({ page, request }) => {
  const email = 'checkout-e2e-' + randomUUID() + '@example.test'
  const password = 'checkout-e2e-123'
  expect((await request.post('/api/auth/register', {
    headers: { 'X-Game-Market-Request': '1' }, data: { email, password },
  })).status()).toBe(201)

  await page.goto('/store?q=hades')
  const game = page.locator('.card').filter({ has: page.getByRole('link', { name: 'Hades', exact: true }) })
  await game.getByRole('link', { name: 'Add to cart', exact: true }).click()
  await page.getByRole('heading', { name: 'Your cart' }).waitFor()
  await page.getByRole('link', { name: 'Buy now', exact: true }).click()
  await page.getByRole('link', { name: 'Log in to buy' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm demo purchase' }).click()
  await expect(page.getByRole('heading', { name: /Order #\d+ confirmed/ })).toBeVisible()
  await expect(page.locator('.purchase-lines code')).toHaveText(/^DEMO-/)
  await page.getByRole('link', { name: 'View order' }).click()
  await expect(page.locator('.purchase-lines code')).toHaveText(/^DEMO-/)
  await page.reload()
  await expect(page.locator('.purchase-lines code')).toHaveText(/^DEMO-/)
})
