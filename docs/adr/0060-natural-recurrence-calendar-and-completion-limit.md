# ADR 0060 — Natural recurrence calendar and completion limit

Status: accepted for local v3 implementation; verification in progress.

The FINAL recurrence editor requires multiple weekly weekdays, monthly day or ordinal weekday, and termination after completed occurrences. Calendar semantics remain in Domain; Application owns occurrence lifecycle and transactional termination. Native schedulers do not duplicate these rules.

Optional `weekdays` use ISO Monday=1 through Sunday=7. Explicit weekday rules use Monday calendar weeks anchored to the week containing `startDate`, with no emission before that date. Omitted weekdays retain the historical start-weekday interval. Optional `monthlyRule` selects a day (absent month days are skipped), an ordinal weekday (1–5), or last weekday (-1). Omitted monthly rules retain the start-date day. Existing records need no rewrite.

`endAfterCompleted` is exclusive with `endDate`; only nondeleted COMPLETED or BACKFILLED occurrences with completion timestamps count. MISSED and SKIPPED do not count. Tick reconciles task completion before checking this limit, then atomically ends the definition; explicit generation also refuses new occurrences once the limit is reached. Historical occurrences and task ownership are retained. Existing open tasks are not silently canceled when a series ends.

The existing workflow JSON payload stores these optional fields in both adapters. No new columns or table constraints are introduced in this change; historical migrations remain immutable. Persistence, duplicate ticks, old rules, backup/restore and API contracts must be verified before acceptance. Unknown request fields and invalid combinations remain rejected. Calendar window expiry ignores series termination when finding its next calendar boundary.

The editor exposes natural calendar choices and conditional end fields. Timezone and close behavior are progressive advanced controls. Summary uses localized timezone names. Domain validation, not form controls, is authoritative.
