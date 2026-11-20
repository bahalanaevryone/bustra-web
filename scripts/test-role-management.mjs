import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function testRoleManagement({
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
}) {
  const before = (await db.query('select id,role from public.profiles order by id')).rows
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261120133309_complete_user_role_management.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  const change = (
    actor,
    target,
    role,
    confirm = false,
    expected = null,
    first = null,
    last = null,
  ) =>
    as(actor, () =>
      db.query('select public.admin_update_user($1,$2,$3,$4,$5,$6)', [
        target,
        first,
        last,
        role,
        confirm,
        expected,
      ]),
    )
  const roleOf = (id) => value('select role from public.profiles where id=$1', [id])
  const countAudit = () => value('select count(*) from private.role_change_audit').then(Number)
  await test('multi-admin upgrade preserves existing profiles and the six public tables', async () => {
    assert.deepEqual(
      (await db.query('select id,role from public.profiles order by id')).rows,
      before,
    )
    assert.equal(Number(await value("select count(*) from pg_tables where schemaname='public'")), 6)
    assert.equal(await value("select to_regclass('public.one_administrator')"), null)
    assert.equal(await countAudit(), 0)
    assert.equal(
      await value(
        "select relrowsecurity from pg_class where oid='private.role_change_audit'::regclass",
      ),
      true,
    )
  })
  await test('registration still ignores forged Admin signup metadata', async () => {
    await db.query(
      'insert into auth.users(id,raw_user_meta_data) values(\'00000000-0000-4000-8000-000000000060\',\'{"first_name":"New","last_name":"User","role":"admin"}\')',
    )
    assert.equal(await roleOf('00000000-0000-4000-8000-000000000060'), 'user')
  })
  await test('guest, User and Employee cannot change roles, including self-promotion with forged confirmation', async () => {
    await as(
      null,
      () =>
        denied(
          () =>
            db.query('select public.admin_update_user($1,null,null,$2,true,null)', [
              passenger,
              'admin',
            ]),
          /permission denied/,
        ),
      'anon',
    )
    for (const actor of [passenger, driver, otherDriver]) {
      await denied(() => change(actor, actor, 'admin', true), /administrator access/)
      await denied(() => change(actor, admin, 'user', true), /administrator access/)
    }
    assert.equal(await roleOf(admin), 'admin')
  })
  await test('RLS and column grants prevent direct role writes by every browser role', async () => {
    for (const actor of [passenger, driver, admin])
      await as(actor, () =>
        denied(
          () => db.query("update public.profiles set role='admin' where id=$1", [passenger]),
          /permission denied/,
        ),
      )
    await as(passenger, () =>
      db.query("update public.profiles set first_name='My name' where id=$1", [passenger]),
    )
    assert.equal(await roleOf(passenger), 'user')
  })
  await test('Admin transitions require confirmation and failed saves do not partially change names or audit', async () => {
    const original = await value('select first_name from public.profiles where id=$1', [passenger])
    const audit = await countAudit()
    await denied(
      () => change(admin, passenger, 'admin', false, 'user', 'Changed before confirmation', 'Test'),
      /Confirm/,
    )
    assert.equal(await roleOf(passenger), 'user')
    assert.equal(
      await value('select first_name from public.profiles where id=$1', [passenger]),
      original,
    )
    assert.equal(await countAudit(), audit)
  })
  await test('admin can promote an existing User and persist names plus role atomically', async () => {
    await change(admin, passenger, 'admin', true, 'user', 'New', 'Administrator')
    assert.equal(await roleOf(passenger), 'admin')
    assert.equal(
      await value('select first_name from public.profiles where id=$1', [passenger]),
      'New',
    )
    assert.equal(Number(await value("select count(*) from public.profiles where role='admin'")), 2)
    const row = (await db.query('select * from private.role_change_audit order by id desc limit 1'))
      .rows[0]
    assert.equal(row.actor_id, admin)
    assert.equal(row.target_id, passenger)
    assert.equal(row.old_role, 'user')
    assert.equal(row.new_role, 'admin')
    assert.ok(row.changed_at)
  })
  await test('removing Admin privileges requires confirmation; a newly promoted admin can change other roles', async () => {
    await denied(() => change(admin, passenger, 'employee'), /Confirm/)
    await change(passenger, otherPassenger, 'employee', false, 'user')
    assert.equal(await roleOf(otherPassenger), 'employee')
    await change(admin, passenger, 'employee', true, 'admin')
    assert.equal(await roleOf(passenger), 'employee')
    await denied(() => change(passenger, otherPassenger, 'admin', true), /administrator access/)
    await change(admin, passenger, 'user', false, 'employee')
    assert.equal(await roleOf(passenger), 'user')
  })
  await test('Employee promotions retain unfinished-trip assignment safeguards', async () => {
    await db.query(
      "update public.trips set status='cancelled' where driver_id=$1 and status in ('scheduled','active','delayed')",
      [driver],
    )
    const bus = await value(
      "insert into public.buses(plate_number,capacity) values('ROLE TEST',40) returning id",
    )
    const route = await value('select id from public.routes limit 1')
    const trip = await value(
      "insert into public.trips(bus_id,route_id,driver_id,created_by,departure_at,status) values($1,$2,$3,$4,now(),'scheduled') returning id",
      [bus, route, driver, admin],
    )
    const audit = await countAudit()
    await denied(
      () => change(admin, driver, 'admin', true, 'employee', 'Partial', 'Save'),
      /Reassign unfinished trips/,
    )
    assert.equal(await roleOf(driver), 'employee')
    assert.equal(await countAudit(), audit)
    await db.query("update public.trips set status='cancelled' where id=$1", [trip])
    await change(admin, driver, 'admin', true, 'employee')
    assert.equal(await roleOf(driver), 'admin')
    await change(admin, driver, 'employee', true, 'admin')
  })
  await test('invalid, missing, stale and malformed changes cannot overwrite another role decision', async () => {
    await denied(() => change(admin, passenger, 'owner', true), /Choose/)
    await denied(() => change(admin, passenger, null, true), /Choose/)
    await denied(
      () => change(admin, '00000000-0000-4000-8000-000000000099', 'admin', true),
      /not found/,
    )
    await denied(
      () => change(admin, passenger, 'employee', false, 'admin', 'Overwrite', 'Attempt'),
      /role changed/,
    )
    await denied(() => change(admin, passenger, 'employee', false, 'user', ' ', 'Test'), /1 to 80/)
    assert.equal(await roleOf(passenger), 'user')
  })
  await test('cached legacy RPC cannot bypass Admin confirmation and still supports ordinary Employee changes', async () => {
    await as(admin, () =>
      denied(
        () => db.query('select public.set_employee_role($1,$2)', [passenger, 'admin']),
        /Confirm/,
      ),
    )
    await as(admin, () =>
      db.query('select public.set_employee_role($1,$2)', [passenger, 'employee']),
    )
    await as(admin, () => db.query('select public.set_employee_role($1,$2)', [passenger, 'user']))
  })
  await test('the last active administrator cannot be demoted or deleted, including by trusted direct SQL', async () => {
    assert.equal(Number(await value("select count(*) from public.profiles where role='admin'")), 1)
    await denied(() => change(admin, admin, 'user', true, 'admin'), /last active administrator/)
    await denied(
      () => db.query('delete from public.profiles where id=$1', [admin]),
      /last active administrator/,
    )
    await denied(
      () => db.query("update public.profiles set role='user' where id=$1", [admin]),
      /last active administrator/,
    )
  })
  await test('unverified, banned and deleted Auth accounts cannot be granted Admin privileges', async () => {
    await db.query(
      'update auth.users set email_confirmed_at=null,phone_confirmed_at=null where id=$1',
      [passenger],
    )
    await denied(() => change(admin, passenger, 'admin', true), /Verify this account/)
    await db.query(
      "update auth.users set email_confirmed_at=now(),banned_until=now()+interval '1 day' where id=$1",
      [passenger],
    )
    await denied(() => change(admin, passenger, 'admin', true), /Verify this account/)
    await db.query('update auth.users set banned_until=null,deleted_at=now() where id=$1', [
      passenger,
    ])
    await denied(() => change(admin, passenger, 'admin', true), /Verify this account/)
    await db.query('update auth.users set deleted_at=null where id=$1', [passenger])
  })
  await test('an inactive second admin is not counted when protecting the last active administrator', async () => {
    await change(admin, passenger, 'admin', true)
    for (const statement of [
      "banned_until=now()+interval '1 day'",
      'banned_until=null,email_confirmed_at=null,phone_confirmed_at=null',
      'email_confirmed_at=now(),deleted_at=now()',
    ]) {
      await db.query(`update auth.users set ${statement} where id=$1`, [passenger])
      await denied(() => change(admin, admin, 'user', true), /last active administrator/)
      await denied(() => change(passenger, otherPassenger, 'user'), /administrator access/)
    }
    await db.query(
      'update auth.users set banned_until=null,deleted_at=null,email_confirmed_at=now() where id=$1',
      [passenger],
    )
  })
  await test('bulk role changes cannot remove every administrator in one statement', async () => {
    await denied(
      () => db.query("update public.profiles set role='user' where role='admin'"),
      /last active administrator/,
    )
    assert.equal(await roleOf(admin), 'admin')
    assert.equal(await roleOf(passenger), 'admin')
  })
  await test('self-demotion with another active Admin immediately removes server privileges', async () => {
    await change(admin, admin, 'user', true, 'admin')
    assert.equal(await roleOf(admin), 'user')
    await denied(() => change(admin, admin, 'admin', true), /administrator access/)
    await as(admin, () =>
      denied(() => db.query('select public.role_change_history()'), /administrator access/),
    )
    await change(passenger, admin, 'admin', true, 'user')
    await change(admin, passenger, 'user', true, 'admin')
  })
  await test('role audit history is readable only by active admins and cannot be forged or edited by browsers', async () => {
    const history = await as(admin, () => value('select public.role_change_history(30)'))
    assert.ok(history.length > 0)
    assert.ok(history.every((row) => row.actor_id && row.target_id && row.changed_at))
    for (const actor of [passenger, driver]) {
      await as(actor, () =>
        denied(() => db.query('select public.role_change_history()'), /administrator access/),
      )
      await as(actor, () =>
        denied(() => db.query('select private.role_change_history(30)'), /administrator access/),
      )
    }
    await as(
      null,
      () => denied(() => db.query('select public.role_change_history()'), /permission denied/),
      'anon',
    )
    for (const actor of [admin, passenger, driver]) {
      await as(actor, () =>
        denied(() => db.query('select * from private.role_change_audit'), /permission denied/),
      )
      await as(actor, () =>
        denied(
          () =>
            db.query(
              "insert into private.role_change_audit(target_id,old_role,new_role,source) values($1,'user','admin','authenticated_admin')",
              [actor],
            ),
          /permission denied/,
        ),
      )
      await as(actor, () =>
        denied(() => db.query('delete from private.role_change_audit'), /permission denied/),
      )
    }
    await as(admin, () =>
      denied(() => db.query('select public.role_change_history(101)'), /between 1 and 100/),
    )
  })
  await test('audit records survive account deletion and do not expose emails or pickup locations', async () => {
    const target = '00000000-0000-4000-8000-000000000060'
    await change(admin, target, 'admin', true, 'user')
    await db.query("select set_config('request.jwt.claim.sub','',false)")
    await db.query('delete from auth.users where id=$1', [target])
    const rows = (
      await db.query('select * from private.role_change_audit where target_id=$1 order by id', [
        target,
      ])
    ).rows
    assert.equal(rows.length, 2)
    assert.equal(rows[1].new_role, null)
    const feed = await as(null, () => value('select public.public_feed()'), 'anon')
    assert.equal(feed.role_change_audit, undefined)
    assert.ok(!JSON.stringify(rows).includes('email'))
  })
  await test('a no-op name edit has no misleading role audit entry', async () => {
    const audit = await countAudit()
    await change(admin, passenger, 'user', false, 'user', 'Name', 'Only')
    assert.equal(await countAudit(), audit)
    assert.equal(
      await value('select first_name from public.profiles where id=$1', [passenger]),
      'Name',
    )
  })
}
