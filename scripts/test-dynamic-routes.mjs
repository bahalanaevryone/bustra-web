import assert from 'node:assert/strict'
export async function testDynamicRoutes({
  db,
  test,
  as,
  value,
  denied,
  admin,
  otherDriver,
  passenger,
}) {
  const bus = await value(
    "insert into public.buses(plate_number,capacity) values('TEST DYNAMIC',4) returning id",
  )
  const payload = {
    origin: 'TEST searched terminal',
    destination: 'TEST custom pin',
    origin_lat: 13.25,
    origin_lng: 120.62,
    destination_lat: 13.3,
    destination_lng: 120.64,
    bus_id: bus,
    driver_id: otherDriver,
    departure_at: new Date().toISOString(),
    initial_passenger_count: 2,
    locations_confirmed: true,
  }
  const save = (data, id = null) =>
    as(otherDriver, () => value('select public.manage_trip($1,$2)', [id, JSON.stringify(data)]))
  let trip, route
  await test('dynamic endpoints need no registered places and preserve confirmed coordinates', async () => {
    trip = await save({
      ...payload,
      is_approved: true,
      road_path: [
        [13.25, 120.62],
        [13.3, 120.64],
      ],
    })
    route = await value('select route_id from public.trips where id=$1', [trip])
    const r = await value('select to_jsonb(r) from public.routes r where id=$1', [route])
    assert.equal(r.route_name, 'TEST searched terminal → TEST custom pin')
    assert.equal(r.origin_lat, 13.25)
    assert.equal(r.origin_lng, 120.62)
    assert.equal(r.destination_lat, 13.3)
    assert.equal(r.destination_lng, 120.64)
    assert.equal(r.origin_latitude, r.origin_lat)
    assert.equal(r.destination_longitude, r.destination_lng)
    assert.equal(r.is_approved, false)
    assert.equal(r.road_path, null)
    assert.equal(
      Number(await value('select count(*) from public.pickup_points where route_id=$1', [route])),
      0,
    )
    assert.equal(await value('select onboard_count from public.trips where id=$1', [trip]), 2)
  })
  await test('normalized labels and coordinate proximity reuse a route despite small pin adjustments', async () => {
    const id = await save({
      ...payload,
      origin: ' test   SEARCHED terminal ',
      destination: 'TEST CUSTOM PIN',
      origin_lat: 13.2501,
      destination_lng: 120.6401,
    })
    assert.equal(await value('select route_id from public.trips where id=$1', [id]), route)
  })
  await test('equal labels with distant coordinates create a different route and ambiguous legacy names are refused', async () => {
    const id = await save({ ...payload, origin_lat: 13.45, destination_lat: 13.5 })
    assert.notEqual(await value('select route_id from public.trips where id=$1', [id]), route)
    await as(otherDriver, () =>
      denied(
        () =>
          db.query('select public.manage_trip(null,$1)', [
            JSON.stringify({
              origin: payload.origin,
              destination: payload.destination,
              bus_id: bus,
              driver_id: otherDriver,
              departure_at: payload.departure_at,
            }),
          ]),
        /several routes/,
      ),
    )
  })
  await test('dynamic saves reject unconfirmed, missing, string, invalid and coincident coordinates', async () => {
    for (const changed of [
      { locations_confirmed: false },
      { locations_confirmed: 'true' },
      { origin_lat: null },
      { origin_lat: '13.25' },
      { origin_lat: 91 },
      { destination_lng: 181 },
      { destination_lat: payload.origin_lat, destination_lng: payload.origin_lng },
      { origin: '   ' },
      { destination: 'a'.repeat(501) },
    ]) {
      await as(otherDriver, () =>
        denied(
          () =>
            db.query('select public.manage_trip(null,$1)', [
              JSON.stringify({ ...payload, ...changed }),
            ]),
          /Confirm|coordinates|positions|location label/,
        ),
      )
    }
  })
  await test('zero-degree coordinates and longer address labels remain valid', async () => {
    const id = await save({
      ...payload,
      origin: 'A'.repeat(500),
      destination: 'B'.repeat(500),
      origin_lat: 0,
      origin_lng: 0,
      destination_lat: 0.01,
      destination_lng: 0.02,
    })
    const r = await value(
      'select to_jsonb(r) from public.routes r join public.trips t on t.route_id=r.id where t.id=$1',
      [id],
    )
    assert.equal(r.origin_lat, 0)
    assert.equal(r.origin_lng, 0)
    assert.equal(r.route_name.length, 1003)
  })
  await test('invalid initial counts roll back the dynamically created route and trip atomically', async () => {
    const before = Number(await value('select count(*) from public.routes'))
    await as(otherDriver, () =>
      denied(
        () =>
          db.query('select public.manage_trip(null,$1)', [
            JSON.stringify({
              ...payload,
              origin: 'TEST rollback label',
              initial_passenger_count: 99,
            }),
          ]),
        /capacity/,
      ),
    )
    assert.equal(Number(await value('select count(*) from public.routes')), before)
    await as(passenger, () =>
      denied(
        () => db.query('select public.manage_trip(null,$1)', [JSON.stringify(payload)]),
        /Staff access/,
      ),
    )
  })
  await test('reusing a reviewed route retains approval but moving its canonical endpoint invalidates it', async () => {
    for (const [name, lat, lng, order] of [
      ['Origin', payload.origin_lat, payload.origin_lng, 1],
      ['Destination', payload.destination_lat, payload.destination_lng, 2],
    ]) {
      await db.query(
        'insert into public.pickup_points(route_id,name,latitude,longitude,stop_order) values($1,$2,$3,$4,$5)',
        [route, name, lat, lng, order],
      )
    }
    await as(admin, () =>
      db.query("select public.admin_save('routes',$1,$2)", [
        route,
        JSON.stringify({
          origin: payload.origin,
          destination: payload.destination,
          is_approved: true,
          road_path: [
            [13.25, 120.62],
            [13.3, 120.64],
          ],
        }),
      ]),
    )
    const id = await save({ ...payload, origin_lat: 13.2501 })
    assert.equal(await value('select route_id from public.trips where id=$1', [id]), route)
    assert.equal(await value('select is_approved from public.routes where id=$1', [route]), true)
    await db.query('update public.routes set origin_lat=13.251 where id=$1', [route])
    assert.equal(
      Number(await value('select origin_latitude from public.routes where id=$1', [route])),
      13.251,
    )
    assert.equal(await value('select is_approved from public.routes where id=$1', [route]), false)
    assert.equal(await value('select road_path from public.routes where id=$1', [route]), null)
  })
  await test('registered-only implementation is private and cannot bypass dynamic safeguards', async () => {
    for (const role of ['anon', 'authenticated'])
      assert.equal(
        await value(
          "select has_function_privilege($1,'private.manage_trip_registered(uuid,jsonb)','execute')",
          [role],
        ),
        false,
      )
    assert.equal(Number(await value("select count(*) from pg_tables where schemaname='public'")), 7)
  })
}
