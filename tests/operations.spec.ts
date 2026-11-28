import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
})

const uid = '00000000-0000-4000-8000-000000000001'
const employeeId = '00000000-0000-4000-8000-000000000002'
const busId = '00000000-0000-4000-8000-000000000010'
const routeId = '00000000-0000-4000-8000-000000000020'
const tripId = '00000000-0000-4000-8000-000000000030'
async function mockAccount(page: Page, role: 'admin' | 'employee' | 'user', assigned = true) {
  const userId = role === 'employee' ? employeeId : uid
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
        origin_lat: 13.22,
        origin_lng: 120.59,
        destination_lat: 13.23,
        destination_lng: 120.6,
        is_approved: true,
        road_path: [
          [13.22, 120.59],
          [13.23, 120.6],
        ] as [number, number][] | null,
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
        pickup_latitude: 13.2201,
        pickup_longitude: 120.5901,
        pickup_address: 'TEST passenger pin',
        route_verification: 'near_reviewed_route',
        route_distance_m: 12,
        status: 'pending',
        requested_at: new Date().toISOString(),
      },
    ],
    locations: [] as {
      trip_id: string
      latitude: number
      longitude: number
      updated_at: string
      accuracy_m?: number
      speed_kmh?: number
    }[],
  }
  const audit: {
    id: number
    actor_id: string
    target_id: string
    old_role: string
    new_role: string
    changed_at: string
    source: string
  }[] = []
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
      if (name === 'role_change_history') return route.fulfill({ json: audit.slice().reverse() })
      if (name === 'admin_update_user') {
        const target = records.profiles.find((p) => p.id === body.p_user)
        if (!target)
          return route.fulfill({ status: 400, json: { message: 'Registered account not found.' } })
        const nextRole = String(body.p_role)
        if (body.p_expected_role !== target.role)
          return route.fulfill({
            status: 400,
            json: {
              message:
                'This account role changed since you opened it. Refresh User Management and review it again.',
            },
          })
        if (
          nextRole !== target.role &&
          (nextRole === 'admin' || target.role === 'admin') &&
          body.p_confirm_admin !== true
        )
          return route.fulfill({
            status: 400,
            json: { message: 'Confirm before assigning or removing Admin privileges.' },
          })
        if (
          target.role === 'admin' &&
          nextRole !== 'admin' &&
          records.profiles.filter((p) => p.role === 'admin').length === 1
        )
          return route.fulfill({
            status: 400,
            json: {
              message:
                'The last active administrator cannot be removed or demoted. Assign another active administrator first.',
            },
          })
        if (target.role !== nextRole)
          audit.push({
            id: audit.length + 1,
            actor_id: userId,
            target_id: target.id,
            old_role: target.role,
            new_role: nextRole,
            changed_at: new Date().toISOString(),
            source: 'authenticated_admin',
          })
        Object.assign(target, {
          first_name: body.p_first_name,
          last_name: body.p_last_name,
          role: nextRole,
        })
        return route.fulfill({ status: 204 })
      }
      if (name === 'public_feed')
        return route.fulfill({
          json: {
            buses: records.buses,
            routes: records.routes,
            trips: records.trips,
            locations: records.locations,
          },
        })
      if (name === 'check_pickup_location')
        return route.fulfill({
          json: {
            verification: records.routes[0].road_path ? 'near_reviewed_route' : 'unverified',
            distance_m: records.routes[0].road_path ? 12 : null,
            can_request: true,
          },
        })
      if (name === 'request_pickup') return route.fulfill({ json: 'new-pickup-request' })
      if (name === 'cancel_pickup') {
        records.pickup_requests[0].status = 'cancelled'
        return route.fulfill({ status: 204 })
      }
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
test('passenger can find the ETA panel before choosing a pickup pin', async ({ page }) => {
  await mockAccount(page, 'user')
  await page.goto(`/map?trip=${tripId}`)
  await expect(page.getByRole('region', { name: 'Pickup arrival estimate' })).toBeVisible()
  await page.getByRole('button', { name: 'View pickup ETA', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const panel = dialog.getByRole('region', { name: 'Pickup arrival estimate' })
  await expect(panel).toBeInViewport()
  await expect(panel).toContainText('Approximate ETA')
  await expect(panel).toContainText('Choose a pickup pin')
  const panelTop = await panel.evaluate((el) => el.getBoundingClientRect().top)
  const mapTop = await dialog
    .locator('.pickup-location-map')
    .evaluate((el) => el.getBoundingClientRect().top)
  expect(panelTop).toBeLessThan(mapTop)
  await noOverflow(page)
})
test('admin AI Status explains zero real data and demo exclusions without claiming model accuracy', async ({
  page,
}, info) => {
  await mockAccount(page, 'admin')
  await page.route('**/functions/v1/predict-eta', (r) => {
    expect(r.request().postDataJSON()).toEqual({ action: 'status' })
    return r.fulfill({
      json: {
        total_observations: 0,
        verified_arrivals: 0,
        completed_trips: 0,
        incomplete_observations: 0,
        rejected_checks: 2,
        rejection_reasons: { bus_off_route: 2 },
        model: {
          status: 'untrained',
          reason: 'No verified historical arrival dataset has been evaluated.',
          version: null,
          metrics: null,
        },
        requirements: {
          minimum_observations: 60,
          minimum_completed_trips: 30,
          minimum_training_trips: 20,
          minimum_holdout_trips: 6,
        },
        active_trips: [
          {
            trip_id: tripId,
            bus: 'DEMO 002',
            demo_data: true,
            has_gps: true,
            gps_updated_at: new Date().toISOString(),
            gps_accuracy_m: 3,
            open_requests: 1,
            collection: null,
          },
        ],
      },
    })
  })
  await page.goto('/admin?tab=ai')
  const panel = page.getByRole('region', { name: 'Admin AI Status' })
  await expect(panel).toContainText('Model: untrained')
  await expect(panel).toContainText('Completed trips with usable samples')
  await expect(panel).toContainText('60 verified observations from 30 completed real trips')
  await expect(panel).toContainText('excluded from real training')
  await expect(panel).toContainText('No collection check received')
  await expect(panel).not.toContainText('Latest chronological evaluation')
  await noOverflow(page)
  await panel.screenshot({ path: `.artifacts/ai-status-${info.project.name}.png` })
})
test('employee route diagnostics show bus GPS and selected pickup together with separate offset reasons', async ({
  page,
}, info) => {
  const records = await mockAccount(page, 'employee')
  await page.route('**/functions/v1/predict-eta', (r) => {
    const body = r.request().postDataJSON()
    expect(body.action).toBe('diagnose')
    return r.fulfill({
      json: {
        status: 'bus_off_route',
        message: 'Reported bus GPS is 167 m from the road path; the 150 m limit remains enforced.',
        route_source: 'router_suggestion',
        route_path: records.routes[0].road_path,
        location: {
          trip_id: tripId,
          latitude: 13.222,
          longitude: 120.591,
          accuracy_m: 3,
          speed_kmh: 0,
          course_degrees: null,
          updated_at: new Date().toISOString(),
        },
        diagnostics: {
          bus_offset_m: 167,
          pickup_offset_m: body.pickup_latitude ? 55 : null,
          corridor_limit_m: 150,
        },
        route: records.routes[0],
      },
    })
  })
  await page.goto('/employee?tab=diagnostics')
  const panel = page.getByRole('region', { name: 'Route and GPS diagnostics' })
  await expect(panel).toContainText('167 m')
  await expect(panel.getByTitle('Reported bus GPS', { exact: true })).toBeVisible()
  await panel
    .getByLabel('Assigned passenger pickup')
    .selectOption('00000000-0000-4000-8000-000000000050')
  await expect(panel.getByTitle('Your selected pickup pin', { exact: true })).toBeVisible()
  await expect(panel).toContainText('55 m')
  await expect(panel.getByTitle('Assigned route origin', { exact: true })).toBeVisible()
  await noOverflow(page)
  await panel.screenshot({ path: `.artifacts/route-diagnostics-${info.project.name}.png` })
})
test('passenger sees the generated road path and actual bus GPS even when a mismatch prevents ETA', async ({
  page,
  context,
}) => {
  const records = await mockAccount(page, 'user')
  records.routes[0].road_path = null
  const updated = new Date().toISOString()
  records.locations.push({
    trip_id: tripId,
    latitude: 13.222,
    longitude: 120.591,
    accuracy_m: 3,
    updated_at: updated,
  })
  await page.route('https://photon.komoot.io/**', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/functions/v1/predict-eta', (r) =>
    r.fulfill({
      json: {
        status: 'bus_off_route',
        source: 'approximate',
        minutes: null,
        road_distance_m: null,
        message: 'Reported bus GPS is 167 m from the assigned road path.',
        location_updated_at: updated,
        diagnostics: { bus_offset_m: 167, pickup_offset_m: 55, corridor_limit_m: 150 },
        route_path: [
          [13.22, 120.59],
          [13.225, 120.595],
          [13.23, 120.6],
        ],
      },
    }),
  )
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 13.225, longitude: 120.595, accuracy: 8 })
  await page.goto(`/map?trip=${tripId}&pickup=1`)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('region', { name: 'Pickup arrival estimate' })).toContainText(
    '167 m',
  )
  await expect(dialog.getByTitle('Reported bus GPS', { exact: true })).toBeVisible()
  await expect(dialog.getByTitle('Your selected pickup pin', { exact: true })).toBeVisible()
  expect(
    await dialog.locator('.pickup-location-map path.leaflet-interactive').count(),
  ).toBeGreaterThan(0)
})
test('operator can route through a chosen road waypoint and must review the new path', async ({
  page,
}) => {
  const records = await mockAccount(page, 'admin')
  records.routes[0].road_path = null
  records.routes[0].is_approved = false
  let points: number[][] = []
  await page.route('https://router.project-osrm.org/**', (r) => {
    points = new URL(r.request().url()).pathname
      .split('/')
      .at(-1)!
      .split(';')
      .map((point) => point.split(',').map(Number))
    return r.fulfill({
      json: {
        code: 'Ok',
        routes: [{ distance: 1500, duration: 200, geometry: { coordinates: points } }],
      },
    })
  })
  await page.goto('/admin?tab=routes')
  await page.getByRole('button', { name: 'Edit route TEST route', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Choose road waypoint', exact: true }).click()
  await dialog.locator('.route-review-map').click({ position: { x: 150, y: 140 } })
  await expect(dialog.getByTitle('Road waypoint 1')).toBeVisible()
  await dialog.getByRole('button', { name: 'Preview road route', exact: true }).click()
  const approval = dialog.getByRole('checkbox', {
    name: 'Operator verified this road path for bus service',
  })
  await expect(approval).toBeEnabled()
  await expect(approval).not.toBeChecked()
  expect(points).toHaveLength(3)
  expect(points[0]).toEqual([120.59, 13.22])
  expect(points[2]).toEqual([120.6, 13.23])
})
for (const source of ['approximate', 'ai'] as const) {
  test(`pickup shows ${source} ETA and road distance without submitting a request`, async ({
    page,
    context,
  }, info) => {
    const records = await mockAccount(page, 'user')
    const updated = new Date().toISOString()
    records.locations.push({
      trip_id: tripId,
      latitude: 13.22,
      longitude: 120.59,
      updated_at: updated,
      accuracy_m: 10,
      speed_kmh: 30,
    })
    await page.route('https://photon.komoot.io/**', (r) => r.fulfill({ json: { features: [] } }))
    let calls = 0
    await page.route('**/functions/v1/predict-eta', (r) => {
      calls++
      expect(r.request().postDataJSON()).toMatchObject({
        trip_id: tripId,
        pickup_latitude: 13.225,
        pickup_longitude: 120.595,
      })
      return r.fulfill({
        json: {
          status: 'ok',
          source,
          minutes: 7.25,
          road_distance_m: 3500,
          location_updated_at: updated,
          message: 'Test routing response.',
        },
      })
    })
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: 13.225, longitude: 120.595, accuracy: 8 })
    await page.goto(`/map?trip=${tripId}&pickup=1`)
    const panel = page.getByRole('region', { name: 'Pickup arrival estimate' })
    await expect(panel).toContainText(source === 'ai' ? 'AI-predicted ETA' : 'Approximate ETA')
    await expect(panel).toContainText('8 min')
    await expect(panel).toContainText('3.50 km')
    await expect(panel).toContainText('Last location update:')
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Request Pickup', exact: true }),
    ).toBeDisabled()
    expect(calls).toBe(1)
    await noOverflow(page)
    await page
      .getByRole('dialog')
      .screenshot({ path: `.artifacts/eta-${source}-${info.project.name}.png` })
  })
}
test('pickup handles ETA network errors and stops showing estimates when offline', async ({
  page,
  context,
}) => {
  const records = await mockAccount(page, 'user')
  records.locations.push({
    trip_id: tripId,
    latitude: 13.22,
    longitude: 120.59,
    updated_at: new Date().toISOString(),
    accuracy_m: 10,
  })
  await page.route('https://photon.komoot.io/**', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('**/functions/v1/predict-eta', (r) => r.abort('failed'))
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 13.225, longitude: 120.595, accuracy: 8 })
  await page.goto(`/map?trip=${tripId}&pickup=1`)
  const panel = page.getByRole('region', { name: 'Pickup arrival estimate' })
  await expect(panel).toContainText('Check your connection')
  await context.setOffline(true)
  await expect(panel).toContainText('You are offline')
  await expect(panel).not.toContainText(' km')
})
test('ETA refresh keeps a slow in-flight prediction and avoids overlapping requests', async ({
  page,
  context,
}) => {
  const records = await mockAccount(page, 'user')
  const updated = new Date().toISOString()
  records.locations.push({
    trip_id: tripId,
    latitude: 13.22,
    longitude: 120.59,
    updated_at: updated,
    accuracy_m: 10,
  })
  await page.clock.install()
  await page.route('https://photon.komoot.io/**', (r) => r.fulfill({ json: { features: [] } }))
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  await page.route('**/functions/v1/predict-eta', async (r) => {
    calls++
    await held
    await r.fulfill({
      json: {
        status: 'ok',
        source: 'approximate',
        minutes: 7,
        road_distance_m: 3000,
        location_updated_at: updated,
        message: 'Test response.',
      },
    })
  })
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 13.225, longitude: 120.595, accuracy: 8 })
  await page.goto(`/map?trip=${tripId}&pickup=1`)
  await expect.poll(() => calls).toBe(1)
  await page.clock.fastForward(16000)
  expect(calls).toBe(1)
  release()
  await expect(page.getByRole('region', { name: 'Pickup arrival estimate' })).toContainText('7 min')
})
test('pickup refuses stale GPS without requesting an ETA', async ({ page, context }) => {
  const records = await mockAccount(page, 'user')
  records.locations.push({
    trip_id: tripId,
    latitude: 13.22,
    longitude: 120.59,
    updated_at: new Date(Date.now() - 120000).toISOString(),
    accuracy_m: 10,
  })
  await page.route('https://photon.komoot.io/**', (r) => r.fulfill({ json: { features: [] } }))
  let calls = 0
  await page.route('**/functions/v1/predict-eta', (r) => {
    calls++
    return r.fulfill({ json: {} })
  })
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 13.225, longitude: 120.595, accuracy: 8 })
  await page.goto(`/map?trip=${tripId}&pickup=1`)
  const panel = page.getByRole('region', { name: 'Pickup arrival estimate' })
  await expect(panel).toContainText('outdated')
  expect(calls).toBe(0)
})
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
  await page
    .getByRole('checkbox', { name: 'I am safely stopped or an authorized assigned crew member' })
    .check()
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

test('map separates the bus, waiting passenger and device, and traces route endpoints only', async ({
  page,
  context,
}, info) => {
  const records = await mockAccount(page, 'employee')
  records.routes[0].is_approved = false
  records.routes[0].road_path = null
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
  await page
    .getByRole('checkbox', { name: 'I am safely stopped or an authorized assigned crew member' })
    .check()
  await page.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(map.locator('.map-symbol-waiting')).toHaveCount(0)
  await expect(map.locator('.map-symbol-accepted')).toHaveCount(1)
  await noOverflow(page)
  await map.screenshot({ path: `.artifacts/map-symbols-${info.project.name}.png` })
})

test('map keeps an honest endpoint guide when road routing fails and no bus GPS exists', async ({
  page,
}) => {
  const records = await mockAccount(page, 'employee')
  records.routes[0].is_approved = false
  records.routes[0].road_path = null
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

test('employee schedule searches new addresses, previews roads and requires confirmation', async ({
  page,
}, info) => {
  await mockAccount(page, 'employee')
  await page.route('https://photon.komoot.io/**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') || ''
    const coordinates = q.startsWith('New origin') ? [120.596, 13.2233] : [120.601, 13.237]
    return route.fulfill({
      json: { features: [{ geometry: { type: 'Point', coordinates }, properties: { name: q } }] },
    })
  })
  await page.route('https://router.project-osrm.org/**', (route) => {
    const coordinates = decodeURIComponent(
      new URL(route.request().url()).pathname.split('/').pop()!,
    )
      .split(';')
      .map((p) => p.split(',').map(Number))
    return route.fulfill({
      json: { code: 'Ok', routes: [{ geometry: { coordinates }, distance: 1500, duration: 200 }] },
    })
  })
  await page.goto('/employee?tab=trips')
  await page.getByRole('button', { name: 'Add schedule', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Route name', { exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Route', { exact: true })).toHaveCount(0)
  await expect(dialog.locator('select')).toHaveCount(2)
  await dialog.getByRole('combobox', { name: 'Origin', exact: true }).fill('New origin terminal')
  await dialog.getByRole('option', { name: /New origin terminal/ }).click()
  await dialog
    .getByRole('combobox', { name: 'Destination', exact: true })
    .fill('New destination landmark')
  await dialog.getByRole('option', { name: /New destination landmark/ }).click()
  await expect(dialog.locator('.schedule-route-name')).toContainText(
    'New origin terminal → New destination landmark',
  )
  await expect(dialog.locator('.schedule-route-status')).toContainText('Suggested road path')
  await expect(dialog.locator('.schedule-pin-origin')).toHaveCount(1)
  await expect(dialog.locator('.schedule-pin-destination')).toHaveCount(1)
  await expect(dialog.getByRole('button', { name: 'Save Schedule', exact: true })).toBeDisabled()
  await dialog.getByRole('combobox', { name: 'Assigned Bus', exact: true }).selectOption(busId)
  await dialog
    .getByRole('combobox', { name: 'Assigned Driver', exact: true })
    .selectOption(employeeId)
  await dialog.getByLabel('Departure Date and Time', { exact: true }).fill('2026-11-25T08:00')
  await dialog.getByLabel('Initial Passenger Count', { exact: true }).fill('41')
  expect(
    await dialog
      .getByLabel('Initial Passenger Count')
      .evaluate((el: HTMLInputElement) => el.validity.rangeOverflow),
  ).toBe(true)
  await dialog.getByLabel('Initial Passenger Count', { exact: true }).fill('7')
  await dialog
    .getByRole('checkbox', {
      name: 'I verified both location pins and reviewed the route information above.',
    })
    .check()
  await noOverflow(page)
  await dialog.screenshot({ path: `.artifacts/schedule-auto-${info.project.name}.png` })
  const request = page.waitForRequest((r) => r.url().endsWith('/rpc/manage_trip'))
  await dialog.getByRole('button', { name: 'Save Schedule', exact: true }).click()
  const body = (await request).postDataJSON()
  expect(body.p_id).toBe(null)
  expect(body.p_data).toMatchObject({
    origin: 'New origin terminal',
    destination: 'New destination landmark',
    origin_lat: 13.2233,
    origin_lng: 120.596,
    destination_lat: 13.237,
    destination_lng: 120.601,
    locations_confirmed: true,
    bus_id: busId,
    driver_id: employeeId,
    initial_passenger_count: 7,
    status: 'scheduled',
  })
  expect(body.p_data).not.toHaveProperty('route_name')
  expect(body.p_data).not.toHaveProperty('route_id')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('tbody tr')).toHaveCount(2)
})

test('administrator reviews a road path independently of passenger pins', async ({ page }) => {
  const records = await mockAccount(page, 'admin')
  records.routes[0].is_approved = false
  records.routes[0].road_path = null
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
      name: 'Operator verified this road path for bus service',
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

test('map selection preserves custom coordinates when no address or road is available', async ({
  page,
}, info) => {
  await mockAccount(page, 'employee')
  await page.route('https://photon.komoot.io/**', (r) => r.fulfill({ json: { features: [] } }))
  await page.route('https://router.project-osrm.org/**', (r) =>
    r.fulfill({ status: 503, body: 'unavailable' }),
  )
  await page.goto('/employee?tab=trips')
  await page.getByRole('button', { name: 'Add schedule', exact: true }).click()
  const dialog = page.getByRole('dialog'),
    map = dialog.locator('.schedule-route-map')
  await dialog.getByRole('combobox', { name: 'Origin', exact: true }).fill('Unmatched location')
  await expect(dialog.getByText('No matching addresses.', { exact: false })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Save Schedule', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Choose on Map for Origin', exact: true }).click()
  if (info.project.name === 'mobile') await map.tap({ position: { x: 125, y: 170 } })
  else await map.click({ position: { x: 125, y: 170 } })
  await expect(dialog.getByLabel('Origin location label', { exact: true })).toBeVisible()
  await expect(dialog.getByText('No nearby address found.', { exact: false })).toBeVisible()
  await dialog.getByLabel('Origin location label', { exact: true }).fill('TEST custom origin pin')
  await dialog.getByRole('button', { name: 'Choose on Map for Destination', exact: true }).click()
  if (info.project.name === 'mobile') await map.tap({ position: { x: 215, y: 190 } })
  else await map.click({ position: { x: 215, y: 190 } })
  await dialog
    .getByLabel('Destination location label', { exact: true })
    .fill('TEST custom destination pin')
  await expect(dialog.locator('.schedule-route-status')).toContainText('No road route is available')
  await expect(map.locator('path.leaflet-interactive')).toHaveCount(0)
  const destinationBefore = await dialog.locator('.selected-location > p > span').nth(1).innerText()
  const destinationMarker = dialog.locator('[title="Destination marker"]')
  await destinationMarker.scrollIntoViewIfNeeded()
  const markerBox = await destinationMarker.boundingBox()
  expect(markerBox).toBeTruthy()
  await page.mouse.move(markerBox!.x + 18, markerBox!.y + 18)
  await page.mouse.down()
  await page.mouse.move(markerBox!.x + 38, markerBox!.y + 13, { steps: 8 })
  await page.mouse.up()
  await expect(dialog.locator('.selected-location > p > span').nth(1)).not.toHaveText(
    destinationBefore,
  )
  await expect(dialog.locator('.schedule-route-status')).toContainText('No road route is available')
  await dialog.getByRole('combobox', { name: 'Assigned Bus', exact: true }).selectOption(busId)
  await dialog
    .getByRole('combobox', { name: 'Assigned Driver', exact: true })
    .selectOption(employeeId)
  await dialog.getByLabel('Departure Date and Time', { exact: true }).fill('2026-11-25T09:00')
  const confirm = dialog.getByRole('checkbox', {
    name: 'I verified both location pins and reviewed the route information above.',
  })
  await confirm.check()
  const before = await dialog.locator('.selected-location > p > span').first().innerText()
  await dialog.locator('[title="Origin marker"]').focus()
  await page.keyboard.press('ArrowRight')
  await expect(confirm).not.toBeChecked()
  await expect(dialog.getByRole('button', { name: 'Save Schedule', exact: true })).toBeDisabled()
  await expect(dialog.locator('.schedule-route-status')).toContainText('No road route is available')
  const origin = (await dialog.locator('.selected-location > p > span').first().innerText())
    .split(',')
    .map(Number)
  const destination = (await dialog.locator('.selected-location > p > span').nth(1).innerText())
    .split(',')
    .map(Number)
  expect(origin[1]).toBeCloseTo(Number(before.split(',')[1]) + 0.0001, 6)
  await confirm.check()
  await noOverflow(page)
  const request = page.waitForRequest((r) => r.url().endsWith('/rpc/manage_trip'))
  await dialog.getByRole('button', { name: 'Save Schedule', exact: true }).click()
  expect((await request).postDataJSON().p_data).toMatchObject({
    origin: 'TEST custom origin pin',
    destination: 'TEST custom destination pin',
    origin_lat: origin[0],
    origin_lng: origin[1],
    destination_lat: destination[0],
    destination_lng: destination[1],
    locations_confirmed: true,
  })
  await expect(dialog).toHaveCount(0)
})

test('editing a selected address clears its coordinates and provider errors allow map fallback', async ({
  page,
}) => {
  await mockAccount(page, 'employee')
  let queries = 0
  await page.route('https://photon.komoot.io/**', (r) => {
    queries++
    const q = new URL(r.request().url()).searchParams.get('q') || ''
    if (q.includes('unavailable')) return r.fulfill({ status: 429 })
    return r.fulfill({
      json: {
        features: [
          {
            geometry: { type: 'Point', coordinates: [120.596, 13.2233] },
            properties: { name: 'TEST search result' },
          },
        ],
      },
    })
  })
  await page.goto('/employee?tab=trips')
  await page.getByRole('button', { name: 'Add schedule', exact: true }).click()
  const dialog = page.getByRole('dialog'),
    input = dialog.getByRole('combobox', { name: 'Origin', exact: true })
  await input.fill('a')
  await page.waitForTimeout(900)
  expect(queries).toBe(0)
  await input.fill('Search terminal')
  await dialog.getByRole('option', { name: /TEST search result/ }).click()
  await expect(dialog.locator('.schedule-pin-origin')).toHaveCount(1)
  const limited = page.waitForResponse(
    (response) => response.url().includes('photon.komoot.io') && response.status() === 429,
  )
  await input.fill('unavailable location')
  await expect(dialog.locator('.schedule-pin-origin')).toHaveCount(0)
  await limited
  await expect(dialog.getByText('Address search is busy.', { exact: false })).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Choose on Map for Origin', exact: true }),
  ).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'Save Schedule', exact: true })).toBeDisabled()
})

test('editing an existing schedule preserves its exact departure and reuses reviewed coordinates', async ({
  page,
}) => {
  const records = await mockAccount(page, 'employee')
  records.trips[0].status = 'scheduled'
  records.trips[0].departure_at = '2026-11-25T00:00:23.123456+00:00'
  await page.goto('/employee?tab=trips')
  await page.getByRole('button', { name: `Edit schedule ${tripId}`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.schedule-route-status')).toContainText(
    'Existing operator-reviewed bus path',
  )
  await expect(dialog.getByLabel('Initial Passenger Count', { exact: true })).toHaveAttribute(
    'readonly',
    '',
  )
  await dialog
    .getByRole('checkbox', {
      name: 'I verified both location pins and reviewed the route information above.',
    })
    .check()
  const request = page.waitForRequest((r) => r.url().endsWith('/rpc/manage_trip'))
  await dialog.getByRole('button', { name: 'Save Schedule', exact: true }).click()
  const body = (await request).postDataJSON()
  expect(body.p_id).toBe(tripId)
  expect(body.p_data).toMatchObject({
    departure_at: '2026-11-25T00:00:23.123456+00:00',
    origin_lat: 13.22,
    origin_lng: 120.59,
    destination_lat: 13.23,
    destination_lng: 120.6,
    locations_confirmed: true,
  })
  await expect(dialog).toHaveCount(0)
})

test('passenger submits a manually adjusted pin with GPS denied and no stop catalog', async ({
  page,
}, info) => {
  const records = await mockAccount(page, 'user')
  records.routes[0].is_approved = false
  records.routes[0].road_path = null
  await page.route('https://photon.komoot.io/**', (route) =>
    route.fulfill({ json: { features: [] } }),
  )
  await page.route('https://router.project-osrm.org/**', (route) => route.fulfill({ status: 503 }))
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (_success: unknown, failure: (e: { code: number }) => void) =>
          failure({ code: 1 }),
      },
    }),
  )
  let published = 0
  page.on('request', (r) => {
    if (r.url().endsWith('/rpc/publish_location')) published++
  })
  await page.goto(`/map?trip=${tripId}`)
  await page.getByRole('button', { name: 'Request Pickup', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const confirm = dialog.getByRole('button', { name: 'Request Pickup' })
  await expect(confirm).toBeDisabled()
  await dialog.getByRole('button', { name: 'Use My Current Location', exact: true }).click()
  await expect(dialog.getByText(/Location permission denied/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Choose Location on Map', exact: true }).click()
  await dialog.locator('.pickup-location-map').click({ position: { x: 180, y: 140 } })
  await expect(
    dialog.getByText(/This location is not verified against the bus route/),
  ).toBeVisible()
  const pin = dialog.getByTitle('Your selected pickup pin', { exact: true })
  await pin.focus()
  await page.keyboard.press('ArrowRight')
  await dialog
    .getByLabel('Pickup address or landmark (optional)')
    .fill('Blue gate by the main road')
  await expect(confirm).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /I confirm this pickup pin/ }).check()
  await expect(confirm).toBeEnabled()
  const sent = page.waitForRequest((r) => r.url().endsWith('/rpc/request_pickup'))
  await confirm.click()
  const body = (await sent).postDataJSON()
  expect(body.p_trip).toBe(tripId)
  expect(typeof body.p_latitude).toBe('number')
  expect(typeof body.p_longitude).toBe('number')
  expect(Math.abs(body.p_latitude)).toBeLessThan(90)
  expect(body.p_address).toBe('Blue gate by the main road')
  expect(body.p_point).toBeUndefined()
  await expect(page.getByText('Request sent.', { exact: false })).toBeVisible()
  expect(published).toBe(0)
  await noOverflow(page)
  await page.screenshot({ path: `.artifacts/pickup-manual-${info.project.name}.png` })
})

test('passenger GPS pin is shown once, can be adjusted, and requires confirmation', async ({
  page,
  context,
}, info) => {
  await mockAccount(page, 'user')
  await page.route('https://photon.komoot.io/**', (route) =>
    route.fulfill({ json: { features: [] } }),
  )
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 13.225, longitude: 120.595, accuracy: 8 })
  await page.goto(`/map?trip=${tripId}&pickup=1`)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Pickup: 13.225000, 120.595000')).toBeVisible()
  await expect(dialog.getByText(/Device accuracy:.*8 m/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Request Pickup' })).toBeDisabled()
  await expect(dialog.getByText(/operator-reviewed road path/)).toBeVisible()
  await noOverflow(page)
  await dialog.screenshot({ path: `.artifacts/pickup-gps-${info.project.name}.png` })
})

test('too-far assessment and request errors keep the chosen pin without claiming verification', async ({
  page,
}) => {
  await mockAccount(page, 'user')
  await page.route('https://photon.komoot.io/**', (route) =>
    route.fulfill({ json: { features: [] } }),
  )
  await page.route('**/rpc/check_pickup_location', (route) =>
    route.fulfill({ json: { verification: 'too_far', distance_m: 1500, can_request: false } }),
  )
  await page.goto(`/map?trip=${tripId}&pickup=1`)
  const dialog = page.getByRole('dialog')
  await dialog.locator('.pickup-location-map').click({ position: { x: 160, y: 130 } })
  await expect(dialog.getByRole('alert')).toContainText('within 500 metres')
  await dialog.getByRole('checkbox', { name: /I confirm this pickup pin/ }).check()
  await expect(dialog.getByRole('button', { name: 'Request Pickup' })).toBeDisabled()
  await page.route('**/rpc/check_pickup_location', (route) =>
    route.fulfill({ json: { verification: 'unverified', distance_m: null, can_request: true } }),
  )
  await dialog.locator('.pickup-location-map').click({ position: { x: 170, y: 140 } })
  await expect(dialog.getByText(/not verified against the bus route/)).toBeVisible()
  await page.route('**/rpc/request_pickup', (route) =>
    route.fulfill({ status: 400, json: { message: 'This bus is currently full.' } }),
  )
  await dialog.getByRole('checkbox', { name: /I confirm this pickup pin/ }).check()
  await dialog.getByRole('button', { name: 'Request Pickup' }).click()
  await expect(dialog.getByRole('alert')).toContainText('currently full')
  await expect(dialog.getByTitle('Your selected pickup pin', { exact: true })).toBeVisible()
})

test('assigned driver reviews the private pin and sends a safe rejection reason', async ({
  page,
}) => {
  await mockAccount(page, 'employee')
  await page.goto('/employee')
  await expect(page.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled()
  await expect(page.getByText('TEST passenger pin', { exact: true })).toBeVisible()
  await expect(page.getByText('13.220100, 120.590100', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Show pickup on map' }).click()
  await expect(page.locator('.map-symbol-waiting')).toHaveCount(1)
  await page
    .getByRole('checkbox', { name: 'I am safely stopped or an authorized assigned crew member' })
    .check()
  await page.getByLabel('Response note (optional)').fill('Stopping is prohibited here')
  const response = page.waitForRequest((r) => r.url().endsWith('/rpc/respond_pickup'))
  await page.getByRole('button', { name: 'Reject', exact: true }).click()
  expect((await response).postDataJSON()).toMatchObject({
    p_status: 'rejected',
    p_safe_to_respond: true,
    p_reason: 'Stopping is prohibited here',
  })
  await expect(page.getByText('No pending requests')).toBeVisible()
})

test('passenger sees pending status, polling fallback updates acceptance, and accepted pickup can be cancelled', async ({
  page,
}) => {
  const records = await mockAccount(page, 'user')
  await page.clock.install()
  await page.goto('/requests')
  await expect(page.locator('.request-card')).toContainText('Pending')
  records.pickup_requests[0].status = 'accepted'
  await page.clock.runFor(15050)
  await expect(page.locator('.request-card')).toContainText('Accepted')
  await page.getByRole('button', { name: 'Cancel request', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel request', exact: true })
    .click()
  await expect(page.locator('.request-card')).toContainText('Cancelled')
})

test('admin selects all three roles, confirms Admin transitions and sees audit history', async ({
  page,
}, info) => {
  const records = await mockAccount(page, 'admin')
  records.trips[0].status = 'completed'
  let writes = 0
  page.on('request', (r) => {
    if (r.url().endsWith('/rpc/admin_update_user')) writes++
  })
  await page.goto('/admin?tab=profiles')
  await page.getByRole('button', { name: 'Edit user Test', exact: true }).nth(1).click()
  let dialog = page.getByRole('dialog')
  const roles = dialog.getByRole('combobox', { name: 'Account access' })
  await expect(roles).toBeEnabled()
  for (const name of ['User', 'Employee', 'Admin'])
    await expect(roles.getByRole('option', { name, exact: true })).toHaveCount(1)
  await dialog.getByLabel('First name', { exact: true }).fill('Promoted')
  await roles.selectOption('admin')
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Assign Admin privileges?' })).toBeVisible()
  expect(writes).toBe(0)
  await dialog.getByRole('button', { name: 'Go back', exact: true }).click()
  await expect(dialog.getByLabel('First name', { exact: true })).toHaveValue('Promoted')
  await expect(dialog.getByRole('combobox', { name: 'Account access' })).toHaveValue('admin')
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
  const promotion = page.waitForRequest((r) => r.url().endsWith('/rpc/admin_update_user'))
  await dialog.getByRole('button', { name: 'Confirm Admin access', exact: true }).click()
  expect((await promotion).postDataJSON()).toMatchObject({
    p_user: employeeId,
    p_role: 'admin',
    p_confirm_admin: true,
    p_expected_role: 'employee',
    p_first_name: 'Promoted',
  })
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Role change history' })).toContainText(
    'employee → admin',
  )
  await page.getByRole('button', { name: 'Edit user Promoted', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'Account access' }).selectOption('user')
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Remove Admin privileges?' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Confirm removal', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(records.profiles[1].role).toBe('user')
  await page.getByRole('button', { name: 'Edit user Promoted', exact: true }).click()
  await page.getByRole('combobox', { name: 'Account access' }).selectOption('employee')
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(records.profiles[1].role).toBe('employee')
  expect(writes).toBe(3)
  await noOverflow(page)
  await page.screenshot({ path: `.artifacts/roles-${info.project.name}.png`, fullPage: true })
})

test('last Admin protection displays the server error without partial profile changes', async ({
  page,
}) => {
  const records = await mockAccount(page, 'admin')
  await page.goto('/admin?tab=profiles')
  await page.getByRole('button', { name: 'Edit user Test', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('First name', { exact: true }).fill('Not saved')
  await dialog.getByRole('combobox', { name: 'Account access' }).selectOption('user')
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm removal', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('last active administrator')
  expect(records.profiles[0].role).toBe('admin')
  expect(records.profiles[0].first_name).toBe('Test')
  await expect(page).toHaveURL(/\/admin\?tab=profiles/)
})

test('self-demotion with a second Admin redirects to the correct dashboard', async ({ page }) => {
  const records = await mockAccount(page, 'admin')
  records.profiles[1].role = 'admin'
  await page.goto('/admin?tab=profiles')
  await page.getByRole('button', { name: 'Edit user Test', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'Account access' }).selectOption('employee')
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(
    dialog.getByText('Your own dashboard access will change after saving.'),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Confirm removal', exact: true }).click()
  await expect(page).toHaveURL(/\/employee$/)
  await expect(page.getByRole('heading', { name: 'Employee dashboard', exact: true })).toBeVisible()
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/employee$/)
})

test('changed permissions refresh without another login and redirect away from revoked dashboards', async ({
  page,
}) => {
  const records = await mockAccount(page, 'employee')
  records.trips[0].status = 'completed'
  await page.clock.install()
  await page.goto('/employee')
  await expect(page.getByRole('heading', { name: 'Employee dashboard', exact: true })).toBeVisible()
  records.profiles[0].role = 'admin'
  await page.clock.runFor(15050)
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: 'Admin dashboard', exact: true })).toBeVisible()
  records.profiles[0].role = 'user'
  await page.clock.runFor(15050)
  await expect(page).toHaveURL(/\/requests$/)
  await expect(page.getByRole('heading', { name: 'Hello, Test.' })).toBeVisible()
})

test('a stale user editor cannot overwrite a role changed by another admin', async ({ page }) => {
  const records = await mockAccount(page, 'admin')
  await page.clock.install()
  await page.goto('/admin?tab=profiles')
  await page.getByRole('button', { name: 'Edit user Test', exact: true }).nth(1).click()
  records.profiles[1].role = 'user'
  await page.clock.runFor(15050)
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'Account access' }).selectOption('admin')
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
  const mutation = page.waitForRequest((r) => r.url().endsWith('/rpc/admin_update_user'))
  await dialog.getByRole('button', { name: 'Confirm Admin access', exact: true }).click()
  expect((await mutation).postDataJSON().p_expected_role).toBe('employee')
  await expect(dialog.getByRole('alert')).toContainText('role changed since you opened it')
  expect(records.profiles[1].role).toBe('user')
})

test('live maps hide dormant route history and keep an old departure that is still active', async ({
  page,
}) => {
  const records = await mockAccount(page, 'user')
  records.trips[0].departure_at = '2000-01-01T00:00:00Z'
  records.locations.push({
    trip_id: tripId,
    latitude: 13.225,
    longitude: 120.595,
    updated_at: new Date().toISOString(),
  })
  let roadRequests = 0
  await page.route('https://router.project-osrm.org/**', (route) => {
    roadRequests++
    return route.fulfill({ status: 503 })
  })
  for (const status of ['completed', 'cancelled', 'scheduled', 'delayed']) {
    const route = `route-${status}`,
      trip = `trip-${status}`
    records.routes.push({
      ...records.routes[0],
      id: route,
      route_name: `${status} route`,
      origin: `${status} origin`,
      destination: `${status} destination`,
      is_approved: false,
      road_path: null,
    })
    records.trips.push({ ...records.trips[0], id: trip, route_id: route, status })
    records.locations.push({
      trip_id: trip,
      latitude: 13.22,
      longitude: 120.59,
      updated_at: new Date().toISOString(),
    })
  }
  await page.goto('/map')
  let map = page.getByRole('region', { name: 'Bus locations and pickup points' })
  await expect(page.locator('.map-bus-card')).toHaveCount(1)
  await expect(map.locator('.bus-plate-label')).toHaveText('TEST 001')
  await expect(map.locator('.map-symbol-origin')).toHaveCount(1)
  await expect(map.locator('.map-symbol-destination')).toHaveCount(1)
  await expect(map.locator('path.leaflet-interactive')).toHaveCount(1)
  await expect(
    page.getByRole('combobox', { name: 'Route', exact: true }).locator('option'),
  ).toHaveCount(2)
  await expect(map.locator('.map-route-summary')).toContainText('Test origin')
  expect(roadRequests).toBe(0)
  await page.goto('/')
  map = page.getByRole('region', { name: 'Bus locations and pickup points' })
  await expect(map.locator('.map-symbol-origin')).toHaveCount(1)
  await expect(map.locator('path.leaflet-interactive')).toHaveCount(1)
  await expect(
    page.getByRole('combobox', { name: 'Filter home map and buses by route' }).locator('option'),
  ).toHaveCount(2)
  expect(roadRequests).toBe(0)
  await noOverflow(page)
})

test('ending the selected bus clears its map details and route filter while other active buses remain', async ({
  page,
}) => {
  const records = await mockAccount(page, 'user')
  const secondRoute = '00000000-0000-4000-8000-000000000022'
  const secondTrip = '00000000-0000-4000-8000-000000000032'
  const secondBus = '00000000-0000-4000-8000-000000000012'
  records.buses.push({ id: secondBus, plate_number: 'TEST 002', capacity: 40 })
  records.routes.push({
    ...records.routes[0],
    id: secondRoute,
    route_name: 'Second route',
    origin: 'Second origin',
    destination: 'Second destination',
    origin_lat: 13.25,
    origin_lng: 120.61,
    destination_lat: 13.26,
    destination_lng: 120.62,
    road_path: [
      [13.25, 120.61],
      [13.26, 120.62],
    ],
  })
  records.trips.push({
    ...records.trips[0],
    id: secondTrip,
    bus_id: secondBus,
    route_id: secondRoute,
    driver_id: '00000000-0000-4000-8000-000000000003',
    departure_at: '2000-01-01T00:00:00Z',
  })
  records.locations.push(
    { trip_id: tripId, latitude: 13.225, longitude: 120.595, updated_at: new Date().toISOString() },
    {
      trip_id: secondTrip,
      latitude: 13.255,
      longitude: 120.615,
      updated_at: new Date().toISOString(),
    },
  )
  await page.clock.install()
  await page.goto('/map')
  const routeFilter = page.getByRole('combobox', { name: 'Route', exact: true })
  await routeFilter.selectOption(routeId)
  await page.locator('.map-bus-card').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  records.trips[0].status = 'completed'
  records.pickup_requests[0].status = 'expired'
  await page.clock.runFor(15050)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/map$/)
  await expect(routeFilter).toHaveValue('')
  const map = page.getByRole('region', { name: 'Bus locations and pickup points' })
  await expect(map.locator('.bus-plate-label')).toHaveText('TEST 002')
  await expect(map.locator('.map-symbol-origin')).toHaveCount(1)
  await expect(map.locator('path.leaflet-interactive')).toHaveCount(1)
  await expect(map.locator('.map-route-summary')).toContainText('Second origin')
  await expect(map.locator('.map-symbol-waiting')).toHaveCount(0)
  records.trips[1].status = 'completed'
  await page.clock.runFor(15050)
  await expect(map.locator('.bus-plate-label')).toHaveCount(0)
  await expect(map.locator('.map-symbol-origin')).toHaveCount(0)
  await expect(map.locator('.map-symbol-destination')).toHaveCount(0)
  await expect(map.locator('path.leaflet-interactive')).toHaveCount(0)
  await expect(map.getByRole('button', { name: 'Trace road route', exact: true })).toHaveCount(0)
  await expect(map.locator('.map-route-summary')).toContainText('0 active routes')
  await expect(routeFilter.locator('option')).toHaveCount(1)
  expect(records.routes).toHaveLength(2)
  await noOverflow(page)
})

test('completing an employee trip removes its route and GPS from the live map while retaining schedule history', async ({
  page,
}) => {
  const records = await mockAccount(page, 'employee')
  records.locations.push({
    trip_id: tripId,
    latitude: 13.225,
    longitude: 120.595,
    updated_at: new Date().toISOString(),
  })
  await page.goto('/employee')
  const map = page.getByRole('region', { name: 'Bus locations and pickup points' })
  await expect(map.locator('.map-symbol-origin')).toHaveCount(1)
  await expect(map.locator('.bus-plate-label')).toHaveCount(1)
  await page.getByRole('button', { name: `Complete trip ${tripId}`, exact: true }).click()
  await expect(page.getByText('Trip status updated.', { exact: true })).toBeVisible()
  await expect(map.locator('.map-symbol-origin')).toHaveCount(0)
  await expect(map.locator('.map-symbol-destination')).toHaveCount(0)
  await expect(map.locator('.bus-plate-label')).toHaveCount(0)
  await expect(map.locator('path.leaflet-interactive')).toHaveCount(0)
  await expect(map.locator('.map-symbol-waiting')).toHaveCount(0)
  await expect(page.locator('.management-card tbody')).toContainText('Completed')
  expect(records.routes).toHaveLength(1)
  expect(records.trips).toHaveLength(1)
})
