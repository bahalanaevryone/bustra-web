import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
async function offlineBackend(page: Page) {
  await page.route('**/*.supabase.co/**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Test backend offline' }),
    }),
  )
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
}
test('public homepage has an interactive map and honest offline state', async ({ page }) => {
  await offlineBackend(page)
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Know where your bus is. Get there with confidence.' }),
  ).toBeVisible()
  await expect(page.locator('.leaflet-container')).toBeVisible()
  await expect(page.getByText('Service data is currently unavailable.')).toBeVisible()
  await expect(page.getByText('No active bus locations are being shared.')).toBeVisible()
  await noOverflow(page)
})
test('demo bus opens real details and never offers a fake request', async ({ page }) => {
  await offlineBackend(page)
  await page.goto('/?demo=1')
  await page.locator('.bus-row').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'DEMO 001' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log in to request pickup' })).toBeDisabled()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await noOverflow(page)
})
test('map route filter, bus details, and schedules work', async ({ page }) => {
  await offlineBackend(page)
  await page.goto('/map?demo=1')
  await page.getByRole('combobox', { name: 'Route', exact: true }).selectOption('demo-route-2')
  await expect(page.locator('.map-bus-card')).toHaveCount(1)
  await expect(page.locator('.map-bus-card')).toContainText('DEMO 002')
  await noOverflow(page)
  await page.goto('/schedules?demo=1')
  await expect(page.getByRole('heading', { name: 'Bus schedules' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Route', exact: true }).selectOption('demo-route-2')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: 'View trip' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await noOverflow(page)
})
test('shared login and exact registration fields are accessible', async ({ page }) => {
  await offlineBackend(page)
  await page.goto('/register')
  const form = page.locator('form')
  await expect(form.locator('input')).toHaveCount(5)
  await expect(page.getByLabel('First name', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Last name', { exact: true })).toBeVisible()
  await expect(form.locator('select')).toHaveCount(0)
  await page.getByLabel('Password', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text')
  await noOverflow(page)
  await page.goto('/login')
  await expect(page.locator('form input')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: 'Sign in to BUSTRA' })).toBeVisible()
  await noOverflow(page)
})
test('unauthenticated staff routes redirect to the common login', async ({ page }) => {
  await offlineBackend(page)
  await page.goto('/employee')
  await expect(page).toHaveURL(/\/login\?returnTo=/)
  await expect(page.getByRole('heading', { name: 'Sign in to BUSTRA' })).toBeVisible()
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/login\?returnTo=/)
})
test('live pickup intent is preserved through guest login', async ({ page }) => {
  await page.route('**/*.supabase.co/rest/v1/rpc/public_feed', (route) =>
    route.fulfill({
      json: {
        buses: [{ id: 'bus', plate_number: 'TEST BUS', capacity: 40 }],
        routes: [{ id: 'route', route_name: 'Test route', origin: 'A', destination: 'B' }],
        trips: [
          {
            id: 'trip',
            bus_id: 'bus',
            route_id: 'route',
            departure_at: new Date().toISOString(),
            onboard_count: 0,
            status: 'active',
          },
        ],
        pickup_points: [
          {
            id: 'stop',
            route_id: 'route',
            name: 'Test stop',
            latitude: 13.22,
            longitude: 120.59,
            is_active: true,
            stop_order: 1,
          },
        ],
        locations: [],
      },
    }),
  )
  await page.goto('/map?trip=trip&point=stop')
  await page.getByRole('button', { name: 'Log in to request pickup' }).click()
  await expect(page).toHaveURL(/returnTo=%2Fmap%3Ftrip%3Dtrip%26point%3Dstop/)
})
test('capture homepage for visual review', async ({ page }, testInfo) => {
  await offlineBackend(page)
  await page.goto('/?demo=1')
  await expect(page.locator('.bus-row')).toHaveCount(2)
  await page.screenshot({ path: `.artifacts/home-${testInfo.project.name}.png`, fullPage: true })
})

test('compact 320px screens keep public pages and forms within the viewport', async ({ page }) => {
  await offlineBackend(page)
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/?demo=1')
  await expect(page.locator('.bus-row')).toHaveCount(2)
  await noOverflow(page)
  await page.goto('/register')
  await expect(page.getByRole('button', { name: 'Register', exact: true })).toBeVisible()
  await noOverflow(page)
})
