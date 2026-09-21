# Project workspace release candidate

This document describes the current source candidate. It is not a release announcement and does not imply that production or installed native clients have been updated.

## Product changes

- Separate Project settings and Markdown brief; lifecycle, owner-only hierarchy, DIRECT/SUBTREE scope and restorable project URLs.
- Atomic task prerequisite creation/replacement, captured-set conflict protection, TASK-only execution dependencies and Ready/Waiting/Blocked/Paused previews.
- Persisted, versioned workspace calendar timezone with a validated host fallback.
- Searchable hierarchical parent picker; graph Inspector with task status, project category, edit, navigation and archive/trash actions. Dashed graph edges project hierarchy/ownership and are not editable execution edges.
- Historical endpoints on newly recorded dependency Activity, including removals through inline editing.
- Scannable task rows, comfortable/compact density, light/dark/system appearance and mobile bottom navigation.

## Data and API compatibility

SQLite schema 17 → 18 and PostgreSQL repository schema 8 → 9 add workspace calendar preferences and nullable dependency endpoint columns. SQLite preserves existing Activity/Outbox rows and their references while extending the allowed event types. Old removed-edge history remains incomplete rather than being fabricated.

Existing date strings, Markdown, task ownership and recurrence rule timezones are not rewritten. An unset workspace timezone uses ARCLATTICE_CALENDAR_TIMEZONE (UTC by default). Preferences are included in database backups; host fallback configuration and the separate encrypted provider vault require their existing backup procedures.

POST /api/work/calendar-settings and its /api/v1 alias accept version and timezone (null inherits host). Human session, CSRF, work:update and the existing durable idempotency receipt are required. PAT/Agent clients cannot call this new setting mutation. Task create/update accept prerequisiteIds; update also accepts expectedPrerequisiteIds. Graph permission is required when the prerequisite set changes. See OpenAPI for the wire contracts.

## Reproducible validation

Run on an isolated development machine with the documented Node/pnpm versions:

```text
pnpm check
pnpm test:e2e
pnpm exec playwright test --config playwright.narrow.config.ts --grep "inline prerequisites|workspace timezone appearance|parent tree and canvas|work planning:|organization selection"
```

The full check builds Host/Web and includes the actual SQLite/PostgreSQL repository tests. Browser fixtures use disposable accounts/databases and loopback ports 1420/1421; run browser commands sequentially. Screenshots are in test-results and test-results-narrow. Native mock coverage is not device acceptance.

Local validation on 2026-09-21: full check 468 passed / 1 native-fixture skip; complete browser suite 126 passed. After the final graph and visual changes, build/lint/typecheck passed, all 15 affected desktop/mobile cases passed, and all 5 narrow cases passed. SQLite pre-upgrade rollback snapshot and post-upgrade preference/edge-history restoration were verified in isolated tests. The full suites were not rerun after those final UI-only changes. The existing large frontend chunk warning remains.

## Deployment and rollback gate

Before deployment, compare the intended source against the server's authoritative baseline, preserve local changes, and capture an online database backup plus a separate provider-vault/configuration backup. Verify restoration into a new database file before changing the project service. Shared-server checks must follow the restricted deployment runbook; do not run the portable PostgreSQL or browser suite there.

Retain the old application artifacts and pre-upgrade database. Rollback uses both matching old code and the pre-upgrade snapshot; do not open an upgraded database with old code or overwrite a live database. A real rollback rehearsal and authenticated production read/write acceptance remain deployment gates.

Native version metadata has not been incremented, no EXE/APK has been rebuilt for this candidate, and no Git commit, push, tag or public release has been performed. The current shell lacks Cargo/Rust on PATH; reuse a verified existing native toolchain or prepare it explicitly before producing signed native candidates. Production promotion and real-device upgrade acceptance remain separate steps.
