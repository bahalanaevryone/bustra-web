import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function testEtaTraining({
  db,
  test,
  as,
  value,
  denied,
  admin,
  passenger,
  driver,
  trip,
  route,
  bus,
}) {
  await db.exec('create role service_role nologin bypassrls')
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/20261128004329_eta_training_samples.sql', import.meta.url),
      'utf8',
    ),
  )
  await db.query(
    "update public.trips set status='completed' where status='active' and id<>$1 and (bus_id=$2 or driver_id=$3)",
    [trip, bus, driver],
  )
  await db.query('update public.trips set archived_at=null,archived_by=null where id=$1', [trip])
  await db.query(
    "update public.trips set driver_id=$2,status='active',onboard_count=0 where id=$1",
    [trip, driver],
  )
  await db.query('update public.routes set road_path=null,is_approved=false where id=$1', [route])
  await db.query("update public.pickup_requests set status='cancelled' where trip_id=$1", [trip])
  const request = await as(passenger, () =>
    value('select public.request_pickup($1,13.224,120.596,null)', [trip]),
  )
  await db.query(
    "update public.pickup_requests set requested_at=now()-interval '2 minutes' where id=$1",
    [request],
  )
  const setFix = async (lat, ago = 80, accuracy = 10, speed = 30) =>
    db.query(
      `
    insert into public.bus_location(trip_id,latitude,longitude,updated_at,accuracy_m,speed_kmh) values($1,$2,120.596,now()-$3*interval '1 second',$4,$5)
    on conflict(trip_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,updated_at=excluded.updated_at,accuracy_m=excluded.accuracy_m,speed_kmh=excluded.speed_kmh`,
      [trip, lat, ago, accuracy, speed],
    )
  const observe = async () => {
    const stamp = await value('select updated_at from public.bus_location where trip_id=$1', [trip])
    await as(
      null,
      () => db.query('select public.record_eta_sample($1,$2,1000,4)', [request, stamp]),
      'service_role',
    )
  }
  await test('ETA migration keeps six core tables and adds exactly one RLS-protected training table', async () => {
    assert.equal(Number(await value("select count(*) from pg_tables where schemaname='public'")), 7)
    assert.equal(
      await value(
        "select relrowsecurity from pg_class where oid='public.eta_training_samples'::regclass",
      ),
      true,
    )
    for (const role of ['anon', 'authenticated'])
      assert.equal(
        await value(
          "select has_function_privilege($1,'public.record_eta_sample(uuid,timestamptz,numeric,numeric)','execute')",
          [role],
        ),
        false,
      )
    await as(
      null,
      () =>
        denied(() => db.query('select * from public.eta_training_samples'), /permission denied/),
      'anon',
    )
  })
  await test('ETA context exposes only active public route/location fields', async () => {
    const context = await as(passenger, () => value('select public.eta_context($1)', [trip]))
    assert.equal(context.trip_id, trip)
    assert.equal(context.driver_id, undefined)
  })
  await setFix(13.21)
  await observe()
  await test('trusted observations are throttled and private; browser cannot forge a training label', async () => {
    await observe()
    assert.equal(Number(await value('select count(*) from public.eta_training_samples')), 1)
    assert.equal(
      Number(await as(passenger, () => value('select count(*) from public.eta_training_samples'))),
      0,
    )
    assert.equal(
      Number(await as(driver, () => value('select count(*) from public.eta_training_samples'))),
      0,
    )
    assert.equal(
      Number(await as(admin, () => value('select count(*) from public.eta_training_samples'))),
      1,
    )
    await as(passenger, () =>
      denied(
        () => db.query('update public.eta_training_samples set actual_arrival_at=now()'),
        /permission denied/,
      ),
    )
  })
  await test('accepting a pickup is never an arrival label', async () => {
    await as(driver, () =>
      db.query("select public.respond_pickup($1,'accepted',true,null)", [request]),
    )
    assert.equal(await value('select actual_arrival_at from public.eta_training_samples'), null)
  })
  await test('two recent accurate near-pin GPS observations verify arrival and erase request correlation', async () => {
    await setFix(13.224, 30)
    assert.equal(await value('select actual_arrival_at from public.eta_training_samples'), null)
    await setFix(13.224, 20)
    const sample = (await db.query('select * from public.eta_training_samples')).rows[0]
    assert.ok(sample.actual_arrival_at)
    assert.ok(
      Math.abs(
        Number(sample.actual_remaining_minutes) -
          (new Date(sample.actual_arrival_at) - new Date(sample.observed_at)) / 60000,
      ) < 0.0001,
    )
    assert.equal(sample.request_id, null)
    assert.equal(sample.arrival_candidate_at, null)
    assert.equal(Number(sample.hour_of_day) >= 0, true)
  })
  await test('GPS-derived course distinguishes movement without saving a historical GPS trail', async () => {
    await setFix(13.222, 15)
    assert.equal(
      Number(
        await value('select course_degrees from public.bus_location where trip_id=$1', [trip]),
      ),
      180,
    )
    await setFix(13.223, 10)
    assert.equal(
      Number(
        await value('select course_degrees from public.bus_location where trip_id=$1', [trip]),
      ),
      0,
    )
  })
  await test('inaccurate GPS and long reporting gaps discard incomplete training observations', async () => {
    await db.exec('delete from public.eta_training_samples where actual_arrival_at is null')
    await setFix(13.21, 80)
    await observe()
    await setFix(13.211, 70, 70)
    assert.equal(
      Number(
        await value(
          'select count(*) from public.eta_training_samples where actual_arrival_at is null',
        ),
      ),
      0,
    )
    await setFix(13.21, 80)
    await observe()
    await setFix(13.211, -15)
    assert.equal(
      Number(
        await value(
          'select count(*) from public.eta_training_samples where actual_arrival_at is null',
        ),
      ),
      0,
    )
  })
  await test('ending a trip discards incomplete labels and retains verified history', async () => {
    await setFix(13.21, 80)
    await observe()
    assert.equal(Number(await value('select count(*) from public.eta_training_samples')), 2)
    await db.query("update public.trips set status='completed' where id=$1", [trip])
    assert.equal(Number(await value('select count(*) from public.eta_training_samples')), 1)
    assert.equal(await as(passenger, () => value('select public.eta_context($1)', [trip])), null)
  })
}
