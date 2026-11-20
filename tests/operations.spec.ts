import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const uid = '00000000-0000-4000-8000-000000000001'
const employeeId = '00000000-0000-4000-8000-000000000002'
const busId = '00000000-0000-4000-8000-000000000010'
const routeId = '00000000-0000-4000-8000-000000000020'
const tripId = '00000000-0000-4000-8000-000000000030'
const pointId = '00000000-0000-4000-8000-000000000040'
async function mockAccount(page: Page, role: 'admin' | 'employee', assigned = true) {
  const userId = role === 'admin' ? uid : employeeId
  const profile = {
    id: userId,
    first_name: 'Test',
    last_name: role === 'admin' ? 'Admin' : 'Employee',
    role,
    created_at: new Date().toISOString(),
  }
  const records = {
    profiles: [
      profile,
      ...(role === 'admin'
        ? [
            {
              id: employeeId,
              first_name: 'Test',
              last_name: 'Employee',
              role: 'employee',
              created_at: new Date().toISOString(),
            },
          ]
        : []),
    ],
    buses: [{ id: busId, plate_number: 'TEST 001', capacity: 40 }],
    routes: [
      {
        id: routeId,
        route_name: 'TEST route',
        origin: 'Test origin',
        destination: 'Test destination',
        is_approved: true,
        road_path: [
          [13.22, 120.59],
          [13.23, 120.6],
        ] as [number, number][] | null,
      },
    ],
    pickup_points: [
      {
        id: pointId,
        route_id: routeId,
        name: 'TEST pickup',
        latitude: 13.22,
        longitude: 120.59,
        stop_order: 1,
        is_active: true,
      },
    ],
    trips: [
      {
        id: tripId,
        bus_id: busId,
        route_id: routeId,
        driver_id: assigned ? employeeId : uid,
        created_by: uid,
        departure_at: new Date().toISOString(),
        onboard_count: 5,
        status: 'active',
      },
    ],
    pickup_requests: [
      {
        id: '00000000-0000-4000-8000-000000000050',
        trip_id: tripId,
        user_id: uid,
        pickup_point_id: pointId,
        status: 'pending',
        requested_at: new Date().toISOString(),
      },
    ],
    locations: [] as { trip_id: string; latitude: number; longitude: number; updated_at: string }[],
  }
  const user = {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'test@example.com',
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: new Date().toISOString(),
  }
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test-signature`
  await page.addInitScript(
    ({ token, user }) =>
      localStorage.setItem(
        'sb-gfpremoiypartyvchwzm-auth-token',
        JSON.stringify({
          access_token: token,
          refresh_token: 'test-refresh-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
          user,
        }),
      ),
    { token, user },
  )
  await page.route('**/*.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (path === '/auth/v1/user') return route.fulfill({ json: user })
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.split('/').pop()
      const body = request.postDataJSON() as Record<string, unknown>
      if (name === 'public_feed')
        return route.fulfill({
          json: {
            buses: records.buses,
            routes: records.routes,
            pickup_points: records.pickup_points,
            trips: records.trips,
            locations: records.locations,
          },
        })
      if (name === 'adjust_passengers') {
        records.trips[0].onboard_count += Number(body.p_delta)
        return route.fulfill({ json: records.trips[0].onboard_count })
      }
      if (name === 'manage_trip') {
        const values = body.p_data as Record<string, unknown>
        if (!body.p_id) {
          const created = {
            ...records.trips[0],
            id: '00000000-0000-4000-8000-000000000039',
            status: 'scheduled',
            onboard_count: Number(values.initial_passenger_count),
            departure_at: String(values.departure_at),
          }
          records.trips.push(created)
          return route.fulfill({ json: created.id })
        }
        Object.assign(
          records.trips.find((t) => t.id === body.p_id)!,
          { status: values.status },
        )
        return route.fulfill({ json: body.p_id })
      }
      if (name === 'respond_pickup') {
        records.pickup_requests[0].status = String(body.p_status)
        return route.fulfill({ status: 204 })
      }
      if (name === 'publish_location') {
        records.locations = [
          {
            trip_id: tripId,
            latitude: Number(body.p_lat),
            longitude: Number(body.p_lng),
            updated_at: new Date().toISOString(),
          },
        ]
        return route.fulfill({ status: 204 })
      }
      if (name === 'admin_save' && body.p_entity === 'buses') {
        const values = body.p_data as { plate_number: string; capacity: string }
        records.buses.push({
          id: '00000000-0000-4000-8000-000000000011',
          plate_number: values.plate_number,
          capacity: Number(values.capacity),
        })
        return route.fulfill({ json: records.buses[1].id })
      }
      if (name === 'admin_save' && body.p_entity === 'routes') {
        Object.assign(records.routes[0], body.p_data)
        return route.fulfill({ json: routeId })
      }
      return route.fulfill({ status: 204 })
    }
    const table = path.split('/').pop() as keyof typeof records
    if (table in records)
      return route.fulfill({
        json: table === 'profiles' && url.searchParams.has('id') ? profile : records[table],
      })
    return route.fulfill({ json: {} })
  })
  return records
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  )
}
async function tab(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Toggle dashboard navigation' })
  if (await menu.isVisible()) await menu.click()
  await page
    .getByRole('navigation', { name: 'Dashboard navigation' })
    .getByRole('button', { name, exact: true })
    .click()
}
test('admin overview, filters and add-bus form work', async ({ page }, info) => {
  await mockAccount(page, 'admin')
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'User management' })).toBeVisible()
  await noOverflow(page)
  await page.screenshot({ path: `.artifacts/admin-${info.project.name}.png`, fullPage: true })
  await tab(page, 'Buses')
  await page.getByRole('button', { name: 'Add bus', exact: true }).click()
  await page.getByLabel('Plate number', { exact: true }).fill('TEST 002')
  await page.getByLabel('Passenger capacity', { exact: true }).fill('32')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await page.getByRole('textbox', { name: 'Search management records' }).fill('TEST 002')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.locator('tbody')).toContainText('32')
  await noOverflow(page)
})
test('employee can count passengers, acknowledge requests, and start/stop GPS', async ({
  page,
  context,
}, info) => {
  const records = await mockAccount(page, 'employee')
  records.trips[0].departure_at = '2026-11-20T08:00:23.123456+00:00'
  const originalDeparture = records.trips[0].departure_at
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 13.223, longitude: 120.596, accuracy: 10 })
  await page.goto('/employee')
  await expect(page.getByRole('heading', { name: 'Employee dashboard' })).toBeVisible()
  await expect(page.locator('.passenger-count')).toContainText('5')
  await page.getByRole('button', { name: 'Add one passenger' }).click()
  await expect(page.locator('.passenger-count')).toContainText('6')
  await page.getByRole('button', { name: 'Subtract one passenger' }).click()
  await expect(page.locator('.passenger-count')).toContainText('5')
  await page.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.getByText('No pending requests')).toBeVisible()
  await page.getByRole('button', { name: 'Start sharing location' }).click()
  await expect(page.getByText(/Sharing location · accuracy/)).toBeVisible()
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start sharing location' })).toBeEnabled()
  await noOverflow(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `.artifacts/employee-${info.project.name}.png`, fullPage: true })
  const mutation = page.waitForRequest((request) => request.url().endsWith('/rpc/manage_trip'))
  await page.getByRole('button', { name: `Complete trip ${tripId}`, exact: true }).click()
  const sent = (await mutation).postDataJSON() as { p_data: { departure_at: string } }
  expect(sent.p_data.departure_at).toBe(originalDeparture)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
test('unassigned employee controls are disabled', async ({ page }) => {
  await mockAccount(page, 'employee', false)
  await page.goto('/employee')
  await page.getByRole('combobox', { name: 'Select bus and trip' }).selectOption(tripId)
  await expect(page.getByRole('button', { name: 'Start sharing location' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Add one passenger' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeDisabled()
})

test('map separates the bus, waiting passenger and device, and traces configured stops only', async ({
  page,
  context,
}, info) => {
  const records = await mockAccount(page, 'employee')
  records.routes[0].is_approved = false
  records.routes[0].road_path = null
  records.pickup_points.push({
    ...records.pickup_points[0],
    id: '00000000-0000-4000-8000-000000000041',
    name: 'TEST destination',
    latitude: 13.23,
    longitude: 120.6,
    stop_order: 2,
  })
  records.locations.push({
    trip_id: tripId,
    latitude: 13.225,
    longitude: 120.595,
    updated_at: new Date().toISOString(),
  })
  let roadRequests = 0
  let publishedPositions = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/rpc/publish_location')) publishedPositions++
  })
  await page.route('https://router.project-osrm.org/**', async (route) => {
    roadRequests++
    expect(decodeURIComponent(new URL(route.request().url()).pathname)).toBe(
      '/route/v1/driving/120.59,13.22;120.6,13.23',
    )
    await route.fulfill({
      json: {
        code: 'Ok',
        routes: [
          {
            geometry: {
              coordinates: [
                [120.59, 13.22],
                [120.591, 13.225],
                [120.6, 13.23],
              ],
            },
            distance: 1600,
            duration: 240,
          },
        ],
      },
    })
  })
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 13.226, longitude: 120.596, accuracy: 10 })
  await page.goto('/employee')
  const map = page.getByRole('region', { name: 'Bus locations and pickup points' })
  await expect(map.locator('.bus-plate-label')).toHaveText('TEST 001')
  await expect(map.locator('.bus-marker.stale')).toHaveCount(0)
  await expect(map.locator('.map-symbol-waiting')).toHaveCount(1)
  await expect(map.locator('.map-symbol-destination')).toHaveText('B')
  await expect(
    map.getByText('Blue line: suggested driving path, not approved for bus service.', {
      exact: false,
    }),
  ).toBeVisible()
  await expect(map.locator('path.leaflet-interactive[stroke-dasharray="9 9"]')).toHaveCount(0)
  expect(roadRequests).toBe(1)
  await map.getByRole('button', { name: 'Locate me', exact: true }).click()
  await expect(map.locator('.map-symbol-you')).toHaveCount(1)
  expect(publishedPositions).toBe(0)
  await map.getByRole('button', { name: 'Find bus', exact: true }).click()
  await page.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(map.locator('.map-symbol-waiting')).toHaveCount(0)
  await expect(map.locator('.map-symbol-accepted')).toHaveCount(1)
  await noOverflow(page)
  await map.screenshot({ path: `.artifacts/map-symbols-${info.project.name}.png` })
})

test('map keeps an honest stop guide when road routing fails and no bus GPS exists', async ({
  page,
}) => {
  const records = await mockAccount(page, 'employee')
  records.routes[0].is_approved = false
  records.routes[0].road_path = null
  records.pickup_points.push({
    ...records.pickup_points[0],
    id: '00000000-0000-4000-8000-000000000041',
    name: 'TEST destination',
    latitude: 13.23,
    longitude: 120.6,
    stop_order: 2,
  })
  await page.route('https://router.project-osrm.org/**', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  )
  await page.goto('/employee')
  const map = page.getByRole('region', { name: 'Bus locations and pickup points' })
  await expect(map.getByRole('button', { name: 'Find bus', exact: true })).toBeDisabled()
  await expect(map.getByText('TEST 001: active trip, no reported GPS position yet.')).toBeVisible()
  await expect(map.getByRole('alert')).toContainText('Road routing is unavailable')
  await expect(map.locator('path.leaflet-interactive[stroke-dasharray="9 9"]')).toHaveCount(1)
})

test('employee schedule has six fields, generates the route name and sends the initial count', async ({
  page,
}, info) => {
  await mockAccount(page, 'employee')
  await page.goto('/employee?tab=trips')
  await page.getByRole('button', { name: 'Add schedule', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Route name', { exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Route', { exact: true })).toHaveCount(0)
  await expect(dialog.locator('input,select')).toHaveCount(6)
  await dialog.getByRole('combobox', { name: 'Origin', exact: true }).selectOption('Test origin')
  await dialog.getByRole('combobox', { name: 'Destination', exact: true }).selectOption('Test destination')
  await expect(dialog.getByRole('status')).toContainText('Test origin → Test destination')
  await dialog.getByRole('combobox', { name: 'Assigned Bus', exact: true }).selectOption(busId)
  await dialog.getByRole('combobox', { name: 'Assigned Driver', exact: true }).selectOption(employeeId)
  await dialog.getByLabel('Departure Date and Time', { exact: true }).fill('2026-11-25T08:00')
  await dialog.getByLabel('Initial Passenger Count', { exact: true }).fill('41')
  expect(
    await dialog
      .getByLabel('Initial Passenger Count')
      .evaluate((el: HTMLInputElement) => el.validity.rangeOverflow),
  ).toBe(true)
  await dialog.getByLabel('Initial Passenger Count', { exact: true }).fill('7')
  await noOverflow(page)
  await dialog.screenshot({ path: `.artifacts/schedule-auto-${info.project.name}.png` })
  const request = page.waitForRequest((r) => r.url().endsWith('/rpc/manage_trip'))
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  const body = (await request).postDataJSON()
  expect(body.p_id).toBe(null)
  expect(body.p_data).toMatchObject({
    origin: 'Test origin',
    destination: 'Test destination',
    bus_id: busId,
    driver_id: employeeId,
    initial_passenger_count: '7',
    status: 'scheduled',
  })
  expect(body.p_data).not.toHaveProperty('route_name')
  expect(body.p_data).not.toHaveProperty('route_id')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('tbody tr')).toHaveCount(2)
})

test('administrator reviews a road path before enabling bus-route pickups', async ({ page }) => {
  const records = await mockAccount(page, 'admin')
  records.routes[0].is_approved = false
  records.routes[0].road_path = null
  records.pickup_points.push({
    ...records.pickup_points[0],
    id: '00000000-0000-4000-8000-000000000041',
    name: 'TEST end',
    latitude: 13.23,
    longitude: 120.6,
    stop_order: 2,
  })
  await page.route('https://router.project-osrm.org/**', (r) =>
    r.fulfill({
      json: {
        code: 'Ok',
        routes: [
          {
            geometry: {
              coordinates: [
                [120.59, 13.22],
                [120.595, 13.225],
                [120.6, 13.23],
              ],
            },
            distance: 1500,
            duration: 200,
          },
        ],
      },
    }),
  )
  await page.goto('/admin?tab=routes')
  await page.getByRole('button', { name: 'Edit route TEST route', exact: true }).click()
  const dialog = page.getByRole('dialog'),
    approval = dialog.getByRole('checkbox', {
      name: 'Operator verified this road path and the pickup stops for bus service',
    })
  await expect(approval).toBeDisabled()
  await dialog.getByRole('button', { name: 'Preview road route', exact: true }).click()
  await expect(dialog.locator('.route-review-map')).toBeVisible()
  await expect(approval).toBeEnabled()
  await expect(approval).not.toBeChecked()
  await approval.check()
  const request = page.waitForRequest((r) => r.url().endsWith('/rpc/admin_save'))
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  const body = (await request).postDataJSON()
  expect(body.p_data.is_approved).toBe(true)
  expect(body.p_data.road_path).toEqual([
    [13.22, 120.59],
    [13.225, 120.595],
    [13.23, 120.6],
  ])
  await expect(dialog).toHaveCount(0)
})
