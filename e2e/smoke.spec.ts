import { expect, test } from '@playwright/test'

test('la landing renderiza con el título de CrediFlux', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle(/CrediFlux/)
  await expect(page.locator('body')).toBeVisible()
})

test('/api/health reporta el servicio activo y el estado de Supabase', async ({ request }) => {
  const response = await request.get('/api/health')

  expect(response.ok()).toBeTruthy()

  const body = await response.json()
  expect(body).toMatchObject({ ok: true, service: 'crediflux' })
  expect(typeof body.supabaseConfigured).toBe('boolean')
  expect(body.persistence).toBeTruthy()
  expect(typeof body.timestamp).toBe('string')
})
