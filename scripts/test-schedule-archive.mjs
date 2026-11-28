import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function testScheduleArchive({
  db,
  test,
  as,
  value,
  denied,
  admin,
  passenger,
  driver,
  trip,
}) {
  const before = (
    await db.query(
      'select id,status,bus_id,route_id,driver_id,created_by,departure_at,onboard_count from public.trips order by id',
    )
  ).rows
  const history = JSON.stringify(
    (await db.query('select * from public.pickup_requests order by id')).rows,
  )
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261120161447_archive_completed_schedules.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  const archive = (actor, id = trip, enabled = true) =>
    as(actor, () => db.query('select public.archive_trip($1,$2)', [id, enabled]))
  const get = async (id) => (await db.query('select * from public.trips where id=$1', [id])).rows[0]
  await test('archive migration retains schedules, request history and all six public tables', async () => {
    assert.deepEqual(
      (
        await db.query(
          'select id,status,bus_id,route_id,driver_id,created_by,departure_at,onboard_count from public.trips order by id',
        )
      ).rows,
      before,
    )
    assert.equal(
      JSON.stringify((await db.query('select * from public.pickup_requests order by id')).rows),
      history,
    )
    assert.equal(
      Number(await value('select count(*) from public.trips where archived_at is not null')),
      0,
    )
    assert.equal(Number(await value("select count(*) from pg_tables where schemaname='public'")), 6)
  })
  await test('guests, passengers and Employees cannot archive or restore schedules', async () => {
    await as(
      null,
      () =>
        denied(() => db.query('select public.archive_trip($1,true)', [trip]), /permission denied/),
      'anon',
    )
    for (const actor of [passenger, driver]) {
      await denied(() => archive(actor), /administrator access/)
      await denied(() => archive(actor, trip, false), /administrator access/)
      await as(actor, () =>
        denied(
          () => db.query('select private.archive_trip($1,true)', [trip]),
          /administrator access/,
        ),
      )
    }
  })
  await test('browser table grants cannot bypass archive authorization', async () => {
    for (const actor of [admin, passenger, driver])
      await as(actor, () =>
        denied(
          () =>
            db.query('update public.trips set archived_at=now(),archived_by=$2 where id=$1', [
              trip,
              actor,
            ]),
          /permission denied/,
        ),
      )
  })
  await test('linked pickup history blocks permanent deletion with an actionable Archive message', async () => {
    assert.ok(
      Number(await value('select count(*) from public.pickup_requests where trip_id=$1', [trip])) >
        0,
    )
    await as(admin, () =>
      denied(
        () => db.query("select public.admin_delete('trips',$1)", [trip]),
        /pickup request history.*Archive/,
      ),
    )
    assert.ok(await get(trip))
  })
  await test('Admin archiving records actor/time and preserves the completed trip and every request field', async () => {
    await archive(admin)
    const row = await get(trip)
    assert.equal(row.status, 'completed')
    assert.ok(row.archived_at)
    assert.equal(row.archived_by, admin)
    assert.equal(
      Number(
        await as(admin, () =>
          value('select count(*) from public.trips where id=$1 and archived_at is null', [trip]),
        ),
      ),
      0,
    )
    assert.equal(
      Number(
        await as(admin, () =>
          value('select count(*) from public.trips where id=$1 and archived_at is not null', [
            trip,
          ]),
        ),
      ),
      1,
    )
    assert.equal(
      JSON.stringify((await db.query('select * from public.pickup_requests order by id')).rows),
      history,
    )
    const feed = await as(null, () => value('select public.public_feed()'), 'anon')
    assert.ok(!feed.trips.some((t) => t.id === trip))
    assert.ok(feed.trips.every((t) => !('archived_by' in t)))
  })
  await test('repeat archive is idempotent and linked history remains protected from permanent deletion', async () => {
    const row = await get(trip)
    await archive(admin)
    assert.equal(String((await get(trip)).archived_at), String(row.archived_at))
    assert.equal((await get(trip)).archived_by, admin)
    await as(admin, () =>
      denied(
        () => db.query("select public.admin_delete('trips',$1)", [trip]),
        /cannot be permanently deleted/,
      ),
    )
  })
  await test('Admin restore clears archive metadata without reopening the trip or altering requests', async () => {
    await archive(admin, trip, false)
    const row = await get(trip)
    assert.equal(row.archived_at, null)
    assert.equal(row.archived_by, null)
    assert.equal(row.status, 'completed')
    assert.equal(
      JSON.stringify((await db.query('select * from public.pickup_requests order by id')).rows),
      history,
    )
  })
  await test('missing schedules and invalid archive choices are rejected', async () => {
    await denied(() => archive(admin, '00000000-0000-4000-8000-000000000099'), /not found/)
    await denied(() => archive(admin, trip, null), /Choose archive or restore/)
  })
  const bus = await value(
    "insert into public.buses(plate_number,capacity) values('ARCHIVE TEST',40) returning id",
  )
  const route = await value('select route_id from public.trips where id=$1', [trip])
  const pending = await value(
    "insert into public.trips(bus_id,route_id,driver_id,created_by,departure_at,status) values($1,$2,$3,$4,now(),'scheduled') returning id",
    [bus, route, driver, admin],
  )
  await test('scheduled, active and delayed trips cannot be archived', async () => {
    for (const status of ['scheduled', 'active', 'delayed']) {
      await db.query('update public.trips set status=$2 where id=$1', [pending, status])
      await denied(() => archive(admin, pending), /Only completed or cancelled/)
      assert.equal((await get(pending)).archived_at, null)
    }
    await db.query("update public.trips set status='cancelled' where id=$1", [pending])
    await archive(admin, pending)
    assert.ok((await get(pending)).archived_at)
    await denied(
      () => db.query("update public.trips set status='active' where id=$1", [pending]),
      /trips_archive_state/,
    )
  })
  await test('historical archive works after its former driver changes roles, while operational checks remain enforced', async () => {
    await as(admin, () =>
      db.query("select public.admin_update_user($1,null,null,'admin',true,'employee')", [driver]),
    )
    await archive(admin)
    assert.ok((await get(trip)).archived_at)
    await archive(admin, trip, false)
    await denied(
      () => db.query('update public.trips set driver_id=$2 where id=$1', [trip, passenger]),
      /driver must be an employee/,
    )
    await denied(
      () => db.query('update public.trips set onboard_count=1000 where id=$1', [trip]),
      /exceeds bus capacity/,
    )
    await as(admin, () =>
      db.query("select public.admin_update_user($1,null,null,'employee',true,'admin')", [driver]),
    )
  })
  await test('an ended schedule without pickup dependencies can still be permanently deleted', async () => {
    await as(admin, () => db.query("select public.admin_delete('trips',$1)", [pending]))
    assert.equal(await get(pending), undefined)
    assert.equal(
      JSON.stringify((await db.query('select * from public.pickup_requests order by id')).rows),
      history,
    )
  })
}
