import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function testEtaDiagnostics({
  db,
  test,
  as,
  value,
  denied,
  admin,
  passenger,
  driver,
  otherDriver,
  trip,
  route,
  bus,
}) {
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261128021714_eta_diagnostics_and_collection.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  await db.query("update public.trips set status='active',driver_id=$2 where id=$1", [trip, driver])
  await db.query("update public.buses set plate_number='BUS 1234' where id=$1", [bus])
  await db.query('update public.routes set road_path=null,is_approved=false where id=$1', [route])
  await db.query("update public.pickup_requests set status='cancelled' where trip_id=$1", [trip])
  const request = await as(passenger, () =>
    value('select public.request_pickup($1,13.224,120.596,null)', [trip]),
  )
  await db.query(
    "update public.pickup_requests set requested_at=now()-interval '2 minutes' where id=$1",
    [request],
  )
  const fix = async (lat, ago = 80, accuracy = 10, speed = 30) =>
    db.query(
      "update public.bus_location set latitude=$2,longitude=120.596,updated_at=now()-$3*interval '1 second',accuracy_m=$4,speed_kmh=$5 where trip_id=$1",
      [trip, lat, ago, accuracy, speed],
    )
  const observe = async (distance = 1000, minutes = 4, stamp) => {
    const observed =
      stamp ?? (await value('select updated_at from public.bus_location where trip_id=$1', [trip]))
    return as(
      null,
      () =>
        value('select public.record_eta_sample($1,$2,$3,$4)', [
          request,
          observed,
          distance,
          minutes,
        ]),
      'service_role',
    )
  }
  const pending = () =>
    value(
      "select count(*) from public.eta_training_samples where request_id=$1 and sample_state='pending'",
      [request],
    )
  await test('AI status, staff diagnostics and collection targets enforce account and trip authorization', async () => {
    for (const user of [passenger, driver, otherDriver])
      await denied(() => as(user, () => value('select public.eta_ai_status()')), /administrator/)
    for (const user of [passenger, otherDriver])
      await denied(
        () => as(user, () => value('select public.eta_diagnostic_context($1)', [trip])),
        /Assigned employee/,
      )
    assert.ok(await as(driver, () => value('select public.eta_diagnostic_context($1)', [trip])))
    assert.ok(await as(admin, () => value('select public.eta_ai_status()')))
    await denied(
      () => as(admin, () => value('select public.eta_collection_targets($1)', [trip])),
      /Assigned employee/,
    )
    const targets = await as(driver, () =>
      value('select public.eta_collection_targets($1)', [trip]),
    )
    assert.equal(targets.length, 1)
    assert.equal(targets[0].user_id, undefined)
  })
  await test('sample writes return truthful recorded, throttled and stale-location results', async () => {
    await fix(13.21)
    const recorded = await observe()
    assert.equal(recorded.status, 'recorded')
    assert.equal((await observe()).status, 'throttled')
    assert.equal((await observe(1000, 4, new Date(0))).reason, 'location_changed')
    assert.equal(Number(await pending()), 1)
  })
  await test('collection metadata does not reset GPS course or invalidate a pending training observation', async () => {
    await fix(13.211, 70)
    const heading = await value('select course_degrees from public.bus_location where trip_id=$1', [
      trip,
    ])
    await as(
      null,
      () => db.query("select public.eta_note_collection($1,'ok',1,1,0)", [trip]),
      'service_role',
    )
    assert.equal(Number(await pending()), 1)
    assert.equal(
      String(
        await value('select course_degrees from public.bus_location where trip_id=$1', [trip]),
      ),
      String(heading),
    )
  })
  await test('intermediate GPS within 100 m is ignored for arrival; two accurate fixes still verify without a passenger session', async () => {
    await fix(13.214, 60, 60)
    assert.equal(Number(await pending()), 1)
    await fix(13.224, 30, 10)
    assert.equal(Number(await pending()), 1)
    await fix(13.224, 20, 10)
    // Previous fix was accurate but no candidate yet after the imprecise old report; wait one more fix.
    await fix(13.224, 10, 10)
    const sample = (
      await db.query(
        "select * from public.eta_training_samples where trip_id=$1 and sample_state='verified' order by observed_at desc limit 1",
        [trip],
      )
    ).rows[0]
    assert.ok(sample.actual_arrival_at)
    assert.equal(sample.request_id, null)
    assert.equal(sample.user_id, undefined)
    assert.equal(sample.pickup_latitude, undefined)
  })
  await test('demo/test vehicles cannot enter the real training dataset', async () => {
    await fix(13.21, 80)
    await db.query("update public.buses set plate_number='DEMO 002' where id=$1", [bus])
    assert.equal((await observe()).reason, 'demo_trip')
    assert.equal(Number(await pending()), 0)
    await db.query("update public.buses set plate_number='BUS 1234' where id=$1", [bus])
  })
  await test('rejections are counted with reasons, remain private and never become arrival labels', async () => {
    const stamp = await value('select updated_at from public.bus_location where trip_id=$1', [trip])
    const rejected = await as(
      null,
      () => value("select public.record_eta_rejection($1,$2,'bus_off_route')", [request, stamp]),
      'service_role',
    )
    assert.equal(rejected.status, 'rejected')
    const status = await as(admin, () => value('select public.eta_ai_status()'))
    assert.equal(Number(status.rejection_reasons.bus_off_route), 1)
    assert.equal(
      Number(await as(passenger, () => value('select count(*) from public.eta_training_samples'))),
      0,
    )
    await as(passenger, () =>
      denied(
        () => db.query("select public.record_eta_rejection($1,now(),'passed')", [request]),
        /permission denied/,
      ),
    )
  })
  await test('GPS gap and cancelled requests retain rejected outcomes instead of silently deleting evidence', async () => {
    await fix(13.21, 75)
    assert.equal((await observe()).status, 'recorded')
    await fix(13.211, -20)
    assert.equal(Number(await pending()), 0)
    assert.equal(
      Number(
        await value(
          "select count(*) from public.eta_training_samples where request_id=$1 and rejection_reason='gps_gap'",
          [request],
        ),
      ),
      1,
    )
    await fix(13.21, 70)
    assert.equal((await observe()).status, 'recorded')
    await as(passenger, () => db.query('select public.cancel_pickup($1)', [request]))
    assert.equal(Number(await pending()), 0)
    assert.equal(
      Number(
        await value(
          "select count(*) from public.eta_training_samples where request_id=$1 and rejection_reason='request_closed'",
          [request],
        ),
      ),
      1,
    )
  })
  await test('only completed real trips with verified labels count toward training readiness', async () => {
    const before = await as(admin, () => value('select public.eta_ai_status()'))
    await db.query("update public.trips set status='completed' where id=$1", [trip])
    const after = await as(admin, () => value('select public.eta_ai_status()'))
    assert.ok(Number(after.completed_trips) > Number(before.completed_trips))
    assert.ok(Number(after.verified_arrivals) >= 2)
    assert.equal(Number(await value("select count(*) from pg_tables where schemaname='public'")), 7)
  })
  await test('complete schedule, assigned start, pickup, GPS, arrival and export workflow uses real SQL without a passenger page', async () => {
    // Isolated PGlite software fixture only. No records from this test are sent to hosted Supabase.
    const scheduled = await as(driver, () =>
      value('select public.manage_trip(null,$1)', [
        JSON.stringify({
          origin: 'Fixture origin',
          destination: 'Fixture destination',
          origin_lat: 13.2,
          origin_lng: 120.596,
          destination_lat: 13.23,
          destination_lng: 120.596,
          bus_id: bus,
          driver_id: driver,
          departure_at: new Date().toISOString(),
          initial_passenger_count: 0,
          locations_confirmed: true,
          status: 'scheduled',
        }),
      ]),
    )
    const changeStatus = async (status) =>
      as(driver, async () => {
        const row = await value('select to_jsonb(t) from public.trips t where id=$1', [scheduled])
        return db.query('select public.manage_trip($1,$2)', [
          scheduled,
          JSON.stringify({ ...row, status }),
        ])
      })
    await changeStatus('active')
    assert.equal(await value('select status from public.trips where id=$1', [scheduled]), 'active')
    await as(driver, () =>
      db.query('select public.publish_location($1,13.21,120.596,30,10)', [scheduled]),
    )
    const pickup = await as(passenger, () =>
      value('select public.request_pickup($1,13.224,120.596,null)', [scheduled]),
    )
    await db.query(
      "update public.pickup_requests set requested_at=now()-interval '2 minutes' where id=$1",
      [pickup],
    )
    await db.query(
      "update public.bus_location set updated_at=now()-interval '80 seconds' where trip_id=$1",
      [scheduled],
    )
    const stamp = await value('select updated_at from public.bus_location where trip_id=$1', [
      scheduled,
    ])
    const saved = await as(
      null,
      () => value('select public.record_eta_sample($1,$2,1550,4)', [pickup, stamp]),
      'service_role',
    )
    assert.equal(saved.status, 'recorded')
    await as(driver, () =>
      db.query("select public.respond_pickup($1,'accepted',true,null)", [pickup]),
    )
    assert.equal(
      await value('select actual_arrival_at from public.eta_training_samples where request_id=$1', [
        pickup,
      ]),
      null,
    )
    for (const seconds of [30, 20])
      await db.query(
        "update public.bus_location set latitude=13.224,updated_at=now()-$2*interval '1 second' where trip_id=$1",
        [scheduled, seconds],
      )
    await changeStatus('completed')
    const exported = (
      await db.query(await readFile(new URL('./ai/export-samples.sql', import.meta.url), 'utf8'))
    ).rows
    const sample = exported.find((row) => row.trip_id === scheduled)
    assert.ok(sample)
    assert.equal(Number(sample.routing_minutes), 4)
    assert.ok(Number(sample.actual_remaining_minutes) > 0)
    assert.equal(sample.user_id, undefined)
  })
}
