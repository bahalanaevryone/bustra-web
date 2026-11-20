import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const db = new PGlite()
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [admin, passenger, driver, otherDriver, otherPassenger] = [1, 2, 3, 4, 5].map(id)
const [bus, route, point, trip, wrongRoute, wrongPoint] = [10, 20, 30, 40, 21, 31].map(id)
let passed = 0
async function test(name, fn) {
  await fn()
  passed++
  console.log(`PASS ${name}`)
}
async function as(uid, fn, role = 'authenticated') {
  await db.exec(`set role ${role}`)
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || ''])
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}
async function denied(fn, pattern) {
  let error
  try {
    await fn()
  } catch (e) {
    error = e
  }
  assert.ok(error, 'Expected the database to reject the operation')
  if (pattern) assert.match(error.message, pattern)
}
async function value(sql, args = []) {
  const result = await db.query(sql, args)
  return Object.values(result.rows[0])[0]
}
try {
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
  `)
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/202611200001_bustra_core.sql', import.meta.url),
      'utf8',
    ),
  )
  for (const [uid, name] of [
    [admin, 'Admin'],
    [passenger, 'Passenger'],
    [driver, 'Driver'],
    [otherDriver, 'Other driver'],
    [otherPassenger, 'Other passenger'],
  ]) {
    await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)', [
      uid,
      JSON.stringify({ first_name: name, last_name: 'Test', role: 'admin' }),
    ])
  }
  await test('signup ignores forged admin metadata', async () =>
    assert.equal(await value('select role from public.profiles where id=$1', [passenger]), 'user'))
  await db.query("update public.profiles set role='admin' where id=$1", [admin])
  await as(admin, async () => {
    await db.query('select public.set_employee_role($1,$2)', [driver, 'employee'])
    await db.query('select public.set_employee_role($1,$2)', [otherDriver, 'employee'])
  })
  await db.query('insert into public.buses(id,plate_number,capacity) values($1,$2,2)', [
    bus,
    'TEST 001',
  ])
  for (const rid of [route, wrongRoute])
    await db.query(
      "insert into public.routes(id,route_name,origin,destination) values($1,'TEST route','TEST origin','TEST destination')",
      [rid],
    )
  for (const [pid, rid] of [
    [point, route],
    [wrongPoint, wrongRoute],
  ])
    await db.query(
      "insert into public.pickup_points(id,route_id,name,latitude,longitude) values($1,$2,'TEST stop',13.2233,120.5960)",
      [pid, rid],
    )
  await db.query(
    "insert into public.trips(id,bus_id,route_id,driver_id,created_by,departure_at,status) values($1,$2,$3,$4,$5,now(),'active')",
    [trip, bus, route, driver, admin],
  )
  await test('exactly seven application tables, all RLS enabled', async () => {
    assert.equal(Number(await value("select count(*) from pg_tables where schemaname='public'")), 7)
    assert.equal(
      Number(
        await value(
          "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity",
        ),
      ),
      7,
    )
  })
  await test('passenger cannot grant roles through RPC', () =>
    as(passenger, () =>
      denied(
        () => db.query('select public.set_employee_role($1,$2)', [passenger, 'employee']),
        /Administrator/,
      ),
    ))
  await test('passenger cannot update role directly', () =>
    as(passenger, () =>
      denied(
        () => db.query("update public.profiles set role='admin' where id=$1", [passenger]),
        /permission denied/,
      ),
    ))
  await test('employee cannot grant admin', () =>
    as(driver, () =>
      denied(
        () => db.query('select public.set_employee_role($1,$2)', [driver, 'admin']),
        /Administrator/,
      ),
    ))
  await test('admin RPC refuses additional admin creation', () =>
    as(admin, () =>
      denied(
        () => db.query('select public.set_employee_role($1,$2)', [passenger, 'admin']),
        /Only user and employee/,
      ),
    ))
  await test('database enforces a single admin', () =>
    denied(
      () => db.query("update public.profiles set role='admin' where id=$1", [passenger]),
      /unique/,
    ))
  await test('sole admin cannot be demoted or deleted', async () => {
    await denied(
      () => db.query("update public.profiles set role='user' where id=$1", [admin]),
      /sole administrator/,
    )
    await denied(
      () => db.query('delete from auth.users where id=$1', [admin]),
      /sole administrator/,
    )
  })
  await test('own name update allowed, other profiles hidden', () =>
    as(passenger, async () => {
      await db.query("update public.profiles set first_name='Updated' where id=$1", [passenger])
      assert.equal(
        await value('select first_name from public.profiles where id=$1', [passenger]),
        'Updated',
      )
      assert.equal(Number(await value('select count(*) from public.profiles')), 1)
      assert.equal(
        Number(
          await value(
            "with changed as (update public.profiles set first_name='Hacked' where id=$1 returning id) select count(*) from changed",
            [driver],
          ),
        ),
        0,
      )
    }))
  await test('guest public feed excludes private fields', () =>
    as(
      null,
      async () => {
        const feed = await value('select public.public_feed()')
        assert.equal(feed.trips.length, 1)
        assert.ok(!('driver_id' in feed.trips[0]))
        assert.ok(!('created_by' in feed.trips[0]))
        assert.ok(!('profiles' in feed))
        await denied(() => db.query('select * from public.profiles'), /permission denied/)
        await denied(() => db.query('select * from public.trips'), /permission denied/)
        await denied(() => db.query('select * from public.pickup_requests'), /permission denied/)
        await denied(
          () => db.query('select public.adjust_passengers($1,1)', [trip]),
          /permission denied/,
        )
      },
      'anon',
    ))
  await test('passenger cannot manage schedules', () =>
    as(passenger, () =>
      denied(
        () =>
          db.query('select public.manage_trip(null,$1)', [
            JSON.stringify({
              bus_id: bus,
              route_id: route,
              driver_id: driver,
              departure_at: new Date().toISOString(),
              status: 'scheduled',
            }),
          ]),
        /Staff/,
      ),
    ))
  await test('unrelated employee cannot publish GPS or count', () =>
    as(otherDriver, async () => {
      await denied(
        () => db.query('select public.publish_location($1,13,120)', [trip]),
        /Only the assigned/,
      )
      await denied(
        () => db.query('select public.adjust_passengers($1,1)', [trip]),
        /Only the assigned/,
      )
    }))
  await test('assigned employee publishes exactly one latest location', () =>
    as(driver, async () => {
      await db.query('select public.publish_location($1,13.22,120.59)', [trip])
      await db.query('select public.publish_location($1,13.23,120.60)', [trip])
      assert.equal(Number(await value('select count(*) from public.bus_location')), 1)
      await denied(
        () => db.query('select public.publish_location($1,91,120)', [trip]),
        /check constraint/,
      )
    }))
  await test('transactional passenger delta enforces both limits', () =>
    as(driver, async () => {
      assert.equal(await value('select public.adjust_passengers($1,1)', [trip]), 1)
      assert.equal(await value('select public.adjust_passengers($1,1)', [trip]), 2)
      await denied(() => db.query('select public.adjust_passengers($1,1)', [trip]), /capacity/)
      await denied(() => db.query('select public.adjust_passengers($1,20)', [trip]), /Adjustment/)
      await db.query('select public.adjust_passengers($1,-1)', [trip])
      await db.query('select public.adjust_passengers($1,-1)', [trip])
      await denied(
        () => db.query('select public.adjust_passengers($1,-1)', [trip]),
        /check constraint/,
      )
    }))
  await test('capacity reduction cannot invalidate recorded counts', async () => {
    await as(driver, () => db.query('select public.adjust_passengers($1,1)', [trip]))
    await denied(
      () => db.query('update public.buses set capacity=0 where id=$1', [bus]),
      /Capacity|check constraint/,
    )
  })
  await test('trip assigned to passenger is rejected', () =>
    denied(
      () => db.query('update public.trips set driver_id=$1 where id=$2', [passenger, trip]),
      /must be an employee/,
    ))
  await test('active employee cannot be demoted until reassigned', () =>
    as(admin, () =>
      denied(
        () => db.query('select public.set_employee_role($1,$2)', [driver, 'user']),
        /Reassign/,
      ),
    ))
  await test('second active trip cannot use same bus', () =>
    denied(
      () =>
        db.query(
          "insert into public.trips(bus_id,route_id,driver_id,created_by,departure_at,status) values($1,$2,$3,$4,now(),'active')",
          [bus, route, otherDriver, admin],
        ),
      /unique/,
    ))
  await test('wrong-route stop cannot receive a pickup request', () =>
    as(passenger, () =>
      denied(
        () => db.query('select public.request_pickup($1,$2)', [trip, wrongPoint]),
        /on this trip route/,
      ),
    ))
  let request
  await test('passenger creates request and duplicate is rejected', () =>
    as(passenger, async () => {
      request = await value('select public.request_pickup($1,$2)', [trip, point])
      await denied(
        () => db.query('select public.request_pickup($1,$2)', [trip, point]),
        /already have an open/,
      )
    }))
  await test('other passenger cannot read or cancel request', () =>
    as(otherPassenger, async () => {
      assert.equal(Number(await value('select count(*) from public.pickup_requests')), 0)
      await denied(() => db.query('select public.cancel_pickup($1)', [request]), /own pending/)
    }))
  await test('unrelated employee cannot read or respond to request', () =>
    as(otherDriver, async () => {
      assert.equal(Number(await value('select count(*) from public.pickup_requests')), 0)
      await denied(
        () => db.query("select public.respond_pickup($1,'accepted')", [request]),
        /Only the assigned/,
      )
    }))
  await test('accepting a pickup leaves numeric passenger count unchanged', () =>
    as(driver, async () => {
      const before = await value('select onboard_count from public.trips where id=$1', [trip])
      await db.query("select public.respond_pickup($1,'accepted')", [request])
      assert.equal(
        await value('select onboard_count from public.trips where id=$1', [trip]),
        before,
      )
      await denied(
        () => db.query("select public.respond_pickup($1,'rejected')", [request]),
        /already been handled/,
      )
    }))
  await test('own pending pickup can be cancelled', () =>
    as(otherPassenger, async () => {
      const r = await value('select public.request_pickup($1,$2)', [trip, point])
      await db.query('select public.cancel_pickup($1)', [r])
      assert.equal(
        await value('select status from public.pickup_requests where id=$1', [r]),
        'cancelled',
      )
    }))
  await test('active trip cannot be hijacked through schedule RPC', () =>
    as(otherDriver, () =>
      denied(
        () =>
          db.query('select public.manage_trip($1,$2)', [
            trip,
            JSON.stringify({
              bus_id: bus,
              route_id: route,
              driver_id: otherDriver,
              departure_at: new Date().toISOString(),
              status: 'active',
            }),
          ]),
        /Only the assigned/,
      ),
    ))
  await test('public location disappears once a trip ends', async () => {
    const existing = await value('select to_jsonb(t) from public.trips t where id=$1', [trip])
    await as(driver, () =>
      db.query('select public.manage_trip($1,$2)', [
        trip,
        JSON.stringify({ ...existing, status: 'completed' }),
      ]),
    )
    await as(
      null,
      async () => {
        assert.equal(Number(await value('select count(*) from public.bus_location')), 0)
        assert.equal((await value('select public.public_feed()')).locations.length, 0)
      },
      'anon',
    )
    await as(driver, () =>
      denied(
        () => db.query('select public.publish_location($1,13,120)', [trip]),
        /Only the assigned/,
      ),
    )
    await as(passenger, () =>
      denied(
        () => db.query('select public.request_pickup($1,$2)', [trip, point]),
        /no longer active/,
      ),
    )
  })
  await test('administrator can promote and demote an unassigned employee', () =>
    as(admin, async () => {
      await db.query("select public.set_employee_role($1,'employee')", [otherPassenger])
      await db.query("select public.set_employee_role($1,'user')", [otherPassenger])
      assert.equal(
        await value('select role from public.profiles where id=$1', [otherPassenger]),
        'user',
      )
    }))
  await test('privileged functions have fixed search paths and no PUBLIC grants', async () => {
    const result = await db.query(
      "select proname,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and prosecdef",
    )
    assert.ok(result.rows.every((r) => r.proconfig?.some((c) => c.startsWith('search_path='))))
    assert.equal(
      await value(
        "select has_function_privilege('anon','public.admin_save(text,uuid,jsonb)','execute')",
      ),
      false,
    )
  })
  await test('admin CRUD validates entity types, references, and deletion', () =>
    as(admin, async () => {
      const createdRoute = await value('select public.admin_save($1,null,$2)', [
        'routes',
        JSON.stringify({
          route_name: 'TEST CRUD route',
          origin: 'Origin',
          destination: 'Destination',
        }),
      ])
      const createdPoint = await value('select public.admin_save($1,null,$2)', [
        'pickup_points',
        JSON.stringify({
          route_id: createdRoute,
          name: 'TEST CRUD stop',
          latitude: 13.22,
          longitude: 120.59,
          stop_order: 1,
          is_active: true,
        }),
      ])
      const createdBus = await value('select public.admin_save($1,null,$2)', [
        'buses',
        JSON.stringify({ plate_number: 'TEST CRUD', capacity: 30 }),
      ])
      await db.query('select public.admin_save($1,$2,$3)', [
        'buses',
        createdBus,
        JSON.stringify({ plate_number: 'TEST CRUD edited', capacity: 32 }),
      ])
      assert.equal(await value('select capacity from public.buses where id=$1', [createdBus]), 32)
      await denied(
        () => db.query("select public.admin_delete('routes',$1)", [createdRoute]),
        /in use/,
      )
      await db.query("select public.admin_delete('pickup_points',$1)", [createdPoint])
      await db.query("select public.admin_delete('routes',$1)", [createdRoute])
      await db.query("select public.admin_delete('buses',$1)", [createdBus])
      await denied(() => db.query("select public.admin_save('arbitrary',null,'{}')"), /Unsupported/)
    }))
  await test('employee can create and edit a schedule through the real RPC', async () => {
    const payload = {
      bus_id: bus,
      route_id: route,
      driver_id: driver,
      departure_at: new Date().toISOString(),
      status: 'scheduled',
      onboard_count: 100,
    }
    const created = await as(driver, () =>
      value('select public.manage_trip(null,$1)', [JSON.stringify(payload)]),
    )
    assert.equal(await value('select onboard_count from public.trips where id=$1', [created]), 0)
    await as(driver, () =>
      db.query('select public.manage_trip($1,$2)', [
        created,
        JSON.stringify({ ...payload, status: 'delayed' }),
      ]),
    )
    assert.equal(await value('select status from public.trips where id=$1', [created]), 'delayed')
    await as(driver, () =>
      denied(() => db.query("select public.admin_delete('trips',$1)", [created]), /Administrator/),
    )
    await as(admin, () => db.query("select public.admin_delete('trips',$1)", [created]))
  })
  console.log(
    `\n${passed} PostgreSQL security and integrity checks passed. Hosted Supabase and concurrent multi-connection load are separate checks.`,
  )
} finally {
  await db.close()
}
