# v3 Phase 3 local interaction performance checkpoint

This verifies the direct-manipulation checkpoint, not the complete v3 FINAL
Definition of Done. Release metadata remains 2.4.0. Nothing was published or
deployed.

The baseline runtime is the archived source at
`a9dc99a37486a191139c548a70150df2d20d6c67`. Both runtimes use production Web
builds, the same dependencies, the real SQLite Host and the same fixture:
150 projects, 1,500 tasks, 3,000 edges, 2,000 documents, 5,000 Wiki links and
100 sessions with 1,000 messages each. The browser opens messages in pages of 50.

Twenty samples per runtime were collected serially, in the predeclared order
baseline10/current10/baseline10/current10. All 40 functional tests passed. Every
sample is included; no retry or outlier removal. The comparison uses the ordinary
median and the unchanged maximum 10% regression gate for all 14 actions.
Measurements and sample names are in
`benchmarks/v3-phase3-interaction.json`.

Typing sends the same trusted CDP `Input.insertText` used by Playwright keyboard,
without per-key Playwright trace DOM snapshots inside the timed CPU sample.
Both test harnesses use this protocol; the baseline production source is
unchanged. The test verifies that all 30 characters reach saved Markdown.
Historical traced-input measurements were retained and are not mixed with this
comparison. Interaction timings use CDP ScriptDuration; typing uses the p95 of
30 TaskDuration deltas. These are browser CPU measurements, not server RTT.

All 14 median gates pass. The 50KB typing p95 median improves from 6.917ms to
5.118ms; 100KB improves from 6.097ms to 3.710ms. Live DOM counts across all
current samples are exactly 10 list rows, 14 board rows and 9 session entries.
Task/Board rows still use measured variable heights. The compact Calendar Agenda
uses fixed 44px rows with retained full titles; collapsed secondary groups do
not mount their virtual lists.

Separate regression tests verify three browser configurations, row geometry,
scroll-to-last-entity, full long titles, trusted touch release, cycle rejection,
navigation persistence, document close flushing, offline draft recovery, IME
and unsaved leave protection. The old task benchmark now explicitly selects
title ordering rather than assuming that numeric titles match recently-updated
order. No last-row or geometry assertion was removed.

Cold start, Local-first, Files, later Atlas/Graph changes, the full visual matrix,
native validation and final v3 acceptance still require their own verification.
