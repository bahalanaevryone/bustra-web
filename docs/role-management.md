# User, Employee and Admin role management

This update replaces the former one-administrator restriction. Existing authorized Admins may assign **User**, **Employee** or **Admin** to registered accounts through **Admin dashboard → Users → Edit → Account access**. Registration remains unchanged and always creates a User. All three roles use the same Login page.

## Changed files

- `src/features/admin/UserEditor.tsx`: the three-option dropdown, editable names, confirmation before granting/removing Admin privileges, server error handling and immediate permissions refresh after self-demotion. Names and role are saved atomically; a rejected role change does not leave names partially saved. An editor retains its original role for optimistic concurrency checks, even if another Admin changes the account while it is open.
- `src/features/admin/RoleAudit.tsx`: recent role changes with account, previous/new role, actor and Philippine timestamp. This appears below User Management and is available only to Admins.
- `src/features/admin/EntityEditor.tsx`: routes profile editing to the new User editor. Other entity editors retain their existing behavior.
- `src/pages/Dashboard.tsx`: includes the role audit panel in User Management.
- `src/features/auth/Protected.tsx`: redirects a signed-in account to its current role's dashboard when the old dashboard is no longer authorized.
- `src/features/auth/AuthProvider.tsx`: retains profile Realtime updates and the 15-second polling fallback, and refreshes permissions on browser focus/visibility changes. Authorization uses the current profile role, not editable signup metadata or stale role claims.
- `scripts/test-role-management.mjs`, `scripts/test-database.mjs`, `tests/operations.spec.ts`: migration, authorization, audit and UI regression tests.

## Migration and trusted operations

Apply `supabase/migrations/20261120133309_complete_user_role_management.sql` once after all preceding migrations. It does not change existing roles, names, accounts, trips or registration. It:

1. Removes the `one_administrator` unique index.
2. Replaces the sole-admin trigger with last-active-admin protection, retaining unfinished-trip checks for Employees.
3. Adds `public.admin_update_user(user, first_name, last_name, role, confirm_admin, expected_role)` as an invoker wrapper around a guarded implementation in the unexposed `private` schema.
4. Keeps the older `set_employee_role` API compatible for ordinary User/Employee changes. Cached clients cannot bypass confirmation for an Admin transition.
5. Adds private audit storage and an Admin-only `role_change_history` read operation.

No new environment variables or API keys are required. Keep `private` outside the Data API's exposed schemas. The six main public application tables remain unchanged; the audit is an internal supporting table.

Only a currently active Admin can perform role changes. An active Admin has `profiles.role = 'admin'`, an Auth account with a confirmed email or phone, no deletion timestamp, and no current ban. New Admin recipients must also have an active, verified account. Verification follows the existing registration process; no registration role selector is added.

The operation checks authorization before locking and again after waiting. A transaction-level advisory lock and deterministic locks on administrator profiles serialize changes. The statement trigger also covers direct trusted SQL updates/deletions, including bulk changes. The row guard refuses to demote/delete an Admin unless another active Admin remains. Self-demotion is allowed after confirmation when another active Admin exists. Project-owner changes to Auth bans/verification are separate trusted maintenance operations, outside this role editor.

Changing an Employee to User or Admin requires reassigning or finishing their scheduled, active or delayed trips first. Otherwise the employee would lose the permissions needed to operate those trips.

RLS remains enabled on profiles. Browser roles, including Admin JWTs, receive no direct `UPDATE(role)` permission. Existing name-only self-service grants remain. The trusted operation derives its actor from `auth.uid()`, reads database roles and validates the requested role, expected previous role, name lengths and explicit Admin confirmation. Ordinary Users/Employees cannot promote themselves or other accounts, including by crafting RPC calls. Every privileged function has a fixed search path and explicit execute grants; new public wrappers use invoker security. See [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [function security](https://supabase.com/docs/guides/database/functions).

The confirmation flag verifies that the client explicitly confirmed an Admin transition; the server cannot prove that a human read a particular dialog. Authorization and last-admin protection apply independently of that flag.

## Audit history

`private.role_change_audit` records actor UUID, target UUID, old/new role, timestamp and operation source. A profile deletion records a null new role. No foreign keys tie audit records to accounts, so history survives later account removal. It stores no emails, passwords, tokens or passenger coordinates. Existing historical role changes cannot be reconstructed and are not invented.

RLS is enabled, and browser table/sequence permissions are revoked. Clients cannot append, edit or delete audit entries. A guarded Admin-only read RPC returns at most 100 entries; the interface requests the latest 30. Database triggers record actual changes automatically, in the same transaction as the role update. No-op role/name edits produce no misleading role-change entry. Failed saves roll back both profile changes and audit entries. Trusted database owners still control database maintenance and retention.

The first Admin remains a developer responsibility: register and verify the account, then run the exact-UUID bootstrap through trusted SQL access. Bootstrap refuses to run after an Admin exists. Subsequent Admin assignments use User Management; no public bootstrap endpoint is introduced.

## Test the update

1. Sign in using an existing Admin. Open **Users**, then **Edit** beside a verified existing account. The Account access dropdown must contain User, Employee and Admin.
2. Choose Admin and Save. Confirm that the privilege confirmation appears before any write. Use Go back to cancel and verify that no role/name changes were saved; then save and confirm.
3. Check the User Management role badge and Role change history. The audit should show the actor and old/new role.
4. In a second signed-in browser/account, refresh or wait for Realtime/the 15-second fallback. The new Dashboard link should follow the role. Navigating to an unauthorized old dashboard must redirect to the current one.
5. With at least two active Admins, edit an Admin and select User or Employee. Confirm removal and check that the account loses Admin operations. Self-demotion should move the current session to its new dashboard.
6. Attempt to demote the sole remaining active Admin. Expect a clear server error and no partial name/role save. An unverified, banned or deleted second account must not count as the remaining active Admin.
7. Try an Employee who still has unfinished trips. Expect the reassignment error; reassign/finish those trips before changing that Employee's role.
8. Verify ordinary Users/Employees cannot open User Management or execute role/audit operations directly. New signup must still default to User even if submitted metadata claims Admin.

Run `npm.cmd run check` and `npm.cmd run test:e2e`. Database checks exercise actual PostgreSQL grants, RLS, triggers, role operations, confirmation, atomic saves, stale edits, inactive admins, bulk removal and audit retention. Browser tests cover all roles, confirmation cancellation, audit display, last-admin errors, self-demotion, permission refresh and stale edits at desktop/mobile widths. Browser/backend fixtures do not replace real two-device Realtime checks or a concurrent multi-connection load test.

## Function missing from schema cache

If User Management reports `PGRST202` / `Could not find the function public.admin_update_user(...) in the schema cache`, first confirm that the role migration is applied to the exact Supabase project used by the app. The required signature is `public.admin_update_user(uuid,text,text,text,boolean,text)` with named arguments `p_user`, `p_first_name`, `p_last_name`, `p_role`, `p_confirm_admin`, `p_expected_role`.

When the function already exists with the correct grants, run `notify pgrst, 'reload schema';` through trusted SQL access, then retry the editor. A browser refresh alone does not reload the server schema cache. Do not grant this function to guests or bypass the guarded operation.

Run `node --env-file=.env.local scripts/check-connection.mjs` to verify the actual REST API, including these exact role arguments and the audit RPC. The probes use only the publishable key and no account session: successful signature resolution returns an expected permission denial, and a missing-function response fails the check. They do not change any account. The Pages workflow now runs this live API check before publishing, in addition to local PostgreSQL tests and mocked browser coverage. See [PostgREST schema cache reload](https://docs.postgrest.org/en/stable/references/schema_cache.html).
