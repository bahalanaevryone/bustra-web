# Verification record

Verified locally on 20 November 2026 using Node 24, Chrome, and embedded PostgreSQL. No live database mutation, live account creation, GitHub push, or hosted deployment was performed.

| Check                           | Outcome and scope                                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                      | Passed strict typecheck.                                                                                                                                                                            |
| Production build                | Passed Vite build; separate React, map, Supabase, and validation chunks. Upstream Zod comment annotations produce harmless Rollup warnings.                                                         |
| Unit tests                      | 5 passed: registration validation/untrusted role stripping, password/name errors, safe return URLs, GPS freshness, basic non-AI ETA prerequisites.                                                  |
| PostgreSQL tests                | 30 passed against the actual initial migration in PGlite. Real SQL roles, grants, RLS, triggers, and functions; mock Auth identity function for tests only.                                         |
| Browser tests                   | 22 passed across desktop and iPhone-sized Chrome, including additional 320px compact-screen checks. Backend responses and signed-in sessions are controlled test fixtures, not hosted integrations. |
| Responsive visual review        | Homepage and admin/employee dashboards captured and reviewed at desktop and mobile sizes; checks confirm no document-wide horizontal overflow. Wide tables scroll within their cards.               |
| Supabase read-only connectivity | Auth settings: HTTP 200. Public feed: HTTP 404, function missing from API schema cache. Migration needs to be applied. Management connector lacks permission for this project.                      |
| Optional AI script              | Python syntax parsed successfully. No training dependencies installed or model trained; no arrival dataset exists.                                                                                  |
| Dependency audit                | npm installation reported zero known vulnerabilities at installation time.                                                                                                                          |

Database checks cover forced default passenger role, single admin protection, role/name grants, guest-safe reads, direct private-table denial, staff schedule permissions, assigned-driver GPS, legal coordinates, numeric capacity limits, valid employee assignments, conflicting active trips, duplicate pickup requests, request ownership, same-route stop validation, assigned-driver responses, unchanged count on acceptance, pending cancellation, assignment hijack prevention, hiding ended-trip GPS, and function privileges/search paths.

The browser suite covers common login and exact five-field registration; password visibility; public map and offline states; explicit demo restrictions; route/schedule filters; trip dialogs and Escape close; guest dashboard redirects; pickup intent through login; admin bus form submission/filtering; assigned employee passenger +/- and request acceptance; GPS start/stop with browser-provided test coordinates; unassigned controls disabled; and compact-screen overflow.

## Remaining hosted checks

Apply the reviewed migration, bootstrap the admin, and create your own verified passenger and employee accounts. Then verify signup/login/reset emails with configured redirects; profile-role refresh; two-device Realtime delivery under RLS; actual phone GPS permission/accuracy/offline/route-exit cleanup over HTTPS; database advisor findings on the target; and simultaneous updates using independent PostgreSQL connections. PGlite is a real PostgreSQL engine but these tests do not simulate multi-connection load or hosted Auth/publication configuration.

No claim is made that hosted auth emails, live passenger requests, live GPS, or AI inference have been end-to-end tested. The app is ready for the documented backend setup, not represented as an already operating transport service.
