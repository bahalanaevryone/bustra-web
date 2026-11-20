import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function testPassengerPickups({
  db,
  test,
  as,
  value,
  denied,
  admin,
  passenger,
  driver,
  otherDriver,
  otherPassenger,
  bus,
  route,
  trip,
}) {
  const legacy = (
    await db.query(
      'select q.id,q.user_id,q.trip_id,q.status,q.requested_at,p.latitude,p.longitude,p.name from public.pickup_requests q join public.pickup_points p on p.id=q.pickup_point_id',
    )
  ).rows
  const pointCount = Number(await value('select count(*) from public.pickup_points'))
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261120104656_dynamic_passenger_pickups.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  await test('pickup migration retains old request IDs, timestamps and stop coordinates and archives the catalog', async () => {
    for (const old of legacy) {
      const now = (await db.query('select * from public.pickup_requests where id=$1', [old.id]))
        .rows[0]
      assert.ok(now)
      assert.equal(Number(now.pickup_latitude), Number(old.latitude))
      assert.equal(Number(now.pickup_longitude), Number(old.longitude))
      assert.equal(now.pickup_address, old.name)
      assert.equal(String(now.requested_at), String(old.requested_at))
    }
    assert.equal(
      Number(
        await value('select sum(jsonb_array_length(legacy_pickup_points)) from public.routes'),
      ),
      pointCount,
    )
    assert.equal(Number(await value("select count(*) from pg_tables where schemaname='public'")), 6)
    assert.equal(await value("select to_regclass('public.pickup_points')"), null)
    assert.equal(
      Number(
        await value(
          "select count(*) from information_schema.columns where table_schema='public' and table_name='pickup_requests' and column_name='pickup_point_id'",
        ),
      ),
      0,
    )
  })
  // Isolate the new API from historical test activity while retaining all migrated rows.
  await db.query(
    "update public.pickup_requests set status='cancelled' where status in ('pending','accepted')",
  )
  await db.query(
    "update public.trips set status='completed' where status='active' and id<>$1 and (bus_id=$2 or driver_id=$3)",
    [trip, bus, driver],
  )
  await db.query(
    "update public.trips set status='active',onboard_count=0,driver_id=$2 where id=$1",
    [trip, driver],
  )
  await db.query('update public.routes set is_approved=false,road_path=null where id=$1', [route])
  let request
  const submit = (uid, lat = 13.2233, lng = 120.596, address = null) =>
    as(uid, () => value('select public.request_pickup($1,$2,$3,$4)', [trip, lat, lng, address]))
  const respond = (uid, status = 'accepted', safe = true) =>
    as(uid, () =>
      db.query('select public.respond_pickup($1,$2,$3,$4)', [
        request,
        status,
        safe,
        status === 'rejected' ? 'Stopping prohibited' : null,
      ]),
    )
  await test('guest and employee accounts cannot request pickup', async () => {
    await as(
      null,
      () =>
        denied(
          () => db.query('select public.request_pickup($1,13,120,null)', [trip]),
          /permission denied/,
        ),
      'anon',
    )
    await denied(() => submit(driver), /passenger account/)
  })
  await test('coordinate ranges, missing values and oversized labels are validated on the server', async () => {
    for (const [lat, lng] of [
      [91, 120],
      [13, 181],
      [null, 120],
      ['NaN', 120],
    ])
      await denied(() => submit(passenger, lat, lng), /valid pickup position/)
    await denied(() => submit(passenger, 13, 120, 'x'.repeat(501)), /500/)
  })
  await test('a custom pin without geometry succeeds with explicit unverified metadata and no registered stop', async () => {
    const assessment = await as(passenger, () =>
      value('select public.check_pickup_location($1,13.2233,120.596)', [trip]),
    )
    assert.deepEqual(assessment, {
      verification: 'unverified',
      distance_m: null,
      can_request: true,
    })
    request = await submit(passenger, 13.2233, 120.596, 'My selected landmark')
    assert.equal(
      await value('select route_verification from public.pickup_requests where id=$1', [request]),
      'unverified',
    )
    assert.equal(
      await value('select pickup_address from public.pickup_requests where id=$1', [request]),
      'My selected landmark',
    )
  })
  await test('RLS exposes a pin only to its owner and assigned employee, including for admin queries', async () => {
    for (const uid of [passenger, driver])
      assert.equal(
        Number(
          await as(uid, () =>
            value('select count(*) from public.pickup_requests where id=$1', [request]),
          ),
        ),
        1,
      )
    for (const uid of [otherPassenger, otherDriver, admin])
      assert.equal(
        Number(
          await as(uid, () =>
            value('select count(*) from public.pickup_requests where id=$1', [request]),
          ),
        ),
        0,
      )
    await as(passenger, () =>
      denied(
        () =>
          db.query('update public.pickup_requests set pickup_latitude=14 where id=$1', [request]),
        /permission denied/,
      ),
    )
    await as(otherPassenger, () =>
      denied(
        () =>
          db.query(
            'insert into public.pickup_requests(user_id,trip_id,pickup_latitude,pickup_longitude) values($1,$2,13,120)',
            [passenger, trip],
          ),
        /permission denied/,
      ),
    )
  })
  await test('guests receive no request coordinates or legacy archives through public_feed', async () => {
    const feed = await as(null, () => value('select public.public_feed()'), 'anon')
    assert.equal(feed.pickup_requests, undefined)
    assert.deepEqual(feed.pickup_points, [])
    assert.ok(feed.routes.every((r) => !('legacy_pickup_points' in r)))
    for (const role of ['anon', 'authenticated'])
      assert.equal(
        await value(
          "select has_column_privilege($1,'public.routes','legacy_pickup_points','select')",
          [role],
        ),
        false,
      )
  })
  await test('only one open request is permitted for a passenger and trip', async () => {
    await denied(() => submit(passenger, 13.224, 120.597), /already have an open/)
  })
  await test('driver response enforces assignment, passenger exclusion and explicit safe-response acknowledgement', async () => {
    for (const uid of [passenger, otherDriver, admin])
      await denied(() => respond(uid), /assigned active-trip/)
    await denied(() => respond(driver, 'accepted', false), /safely stopped/)
    await respond(driver)
    assert.equal(
      await value('select status from public.pickup_requests where id=$1', [request]),
      'accepted',
    )
    assert.equal(
      Number(await value('select onboard_count from public.trips where id=$1', [trip])),
      0,
    )
    await denied(() => respond(driver), /already been handled/)
  })
  await test('passenger may cancel their own accepted pickup but not another passenger request', async () => {
    await as(otherPassenger, () =>
      denied(() => db.query('select public.cancel_pickup($1)', [request]), /Only your/),
    )
    await as(passenger, () => db.query('select public.cancel_pickup($1)', [request]))
    assert.equal(
      await value('select status from public.pickup_requests where id=$1', [request]),
      'cancelled',
    )
  })
  const path = JSON.stringify([
    [13.2233, 120.596],
    [13.23, 120.6],
  ])
  await db.query('update public.routes set road_path=$2::jsonb where id=$1', [route, path])
  await test('stored actual geometry checks proximity without converting a suggestion into bus approval', async () => {
    const result = await as(passenger, () =>
      value('select public.check_pickup_location($1,13.225,120.597)', [trip]),
    )
    assert.equal(result.verification, 'near_suggested_route')
    assert.equal(result.can_request, true)
    assert.ok(Number(result.distance_m) < 500)
    await denied(() => submit(passenger, 14, 121), /500 metres/)
    request = await submit(passenger, 13.225, 120.597)
  })
  await test('reviewed geometry remains usable without an admin-created pickup catalog', async () => {
    await as(admin, () =>
      db.query('select public.admin_save($1,$2,$3)', [
        'routes',
        route,
        JSON.stringify({
          origin: 'TEST origin',
          destination: 'TEST destination',
          is_approved: true,
          road_path: JSON.parse(path),
        }),
      ]),
    )
    const result = await as(passenger, () =>
      value('select public.check_pickup_location($1,13.225,120.597)', [trip]),
    )
    assert.equal(result.verification, 'near_reviewed_route')
  })
  await test('full bus blocks submission and acceptance but allows a rejection with a reason', async () => {
    await db.query(
      'update public.trips set onboard_count=(select capacity from public.buses where id=$2) where id=$1',
      [trip, bus],
    )
    await denied(() => submit(otherPassenger), /full/)
    await denied(() => respond(driver), /full/)
    await respond(driver, 'rejected')
    assert.equal(
      await value('select response_note from public.pickup_requests where id=$1', [request]),
      'Stopping prohibited',
    )
  })
  await db.query('update public.trips set onboard_count=0 where id=$1', [trip])
  await test('route changes are rechecked when responding and unsafe requests can still be rejected', async () => {
    request = await submit(passenger, 13.225, 120.597)
    await db.query('update public.routes set is_approved=false,road_path=$2::jsonb where id=$1', [
      route,
      JSON.stringify([
        [14, 121],
        [14.01, 121.01],
      ]),
    ])
    await denied(() => respond(driver), /too far/)
    await respond(driver, 'rejected')
  })
  await test('completion expires pending requests and prevents further submissions', async () => {
    await db.query('update public.routes set road_path=null where id=$1', [route])
    request = await submit(passenger)
    await db.query("update public.trips set status='completed' where id=$1", [trip])
    assert.equal(
      await value('select status from public.pickup_requests where id=$1', [request]),
      'expired',
    )
    await denied(() => submit(otherPassenger), /no longer active/)
  })
  await test('new private helpers have no direct browser execution and retired stop RPC is absent', async () => {
    for (const signature of [
      'private.valid_pickup_coordinates(numeric,numeric)',
      'private.pickup_route_distance(jsonb,numeric,numeric)',
      'private.pickup_assessment(uuid,numeric,numeric)',
    ])
      for (const role of ['anon', 'authenticated'])
        assert.equal(
          await value("select has_function_privilege($1,$2,'execute')", [role, signature]),
          false,
        )
    assert.equal(await value("select to_regprocedure('public.request_pickup(uuid,uuid)')"), null)
    assert.equal(await value("select to_regprocedure('private.request_pickup(uuid,uuid)')"), null)
  })
}
