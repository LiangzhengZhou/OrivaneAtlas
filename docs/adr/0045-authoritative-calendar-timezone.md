# ADR 0045 — Authoritative calendar timezone, compatibility phase

Accepted 2026-09-20; supersedes the UTC-only scheduling presentation of ADR0024, retaining UTC default for existing installations.

## Authority and compatibility
One host calendar timezone is configured by ARCLATTICE_CALENDAR_TIMEZONE (HostOptions.calendarTimezone). Omitted means UTC, preserving existing server eligibility. Validate/canonicalize timezone before opening the database; invalid configuration fails closed. Every WorkService uses the injected Clock.calendarTimezone (default UTC for existing adapters/tests). Authenticated work snapshots expose calendarTimezone, consumed by all clients rather than trusting browser timezone. No user-supplied timezone on mutations.

This phase is a deployment-wide single-user calendar policy, NOT a per-workspace preference or timezone inference. Different hosts may configure different IANA zones. Per-workspace versioned settings remain a later additive change. The configured timezone is operator configuration: keep it with deployment configuration when backing up/restoring; it is not silently persisted into task dates. No schema or stored date/history rewrite.

## Calendar dates vs instants
Task scheduled eligibility, Today, task views, overdue, Calendar and new Journal dates use the same host calendar day. YYYY-MM-DD remains an opaque Gregorian business date. Calendar month length/weekdays/month shifts and date-only formatting use UTC as a neutral arithmetic carrier, never browser-local timezone conversion. Instants (Activity/revisions) continue locale display. Recurrence keeps each existing rule's explicit IANA timezone and historical occurrence days; new recurrence defaults use host zone. Shared helpers must be DST-safe and handle years 0001–0099 without JS year remapping.

Legacy snapshots without calendarTimezone use UTC. A visible calendar timezone label makes the day boundary explicit; default UTC is not described as local time. Changing deployment timezone changes date-based eligibility at the next host start but does not edit dates, task versions, recurrence rules, Markdown or history.

## Validation
Domain boundary/DST/month tests; shared storage contract verifies non-UTC scheduling against an injected fixed instant; host config/snapshot tests; browser contexts whose timezone differs from host verify Calendar/Journal/Tasks and midnight rollover. Previous route fix is verified before this checkpoint.
