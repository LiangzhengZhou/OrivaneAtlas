# v3 Full FINAL Acceptance — 2026-10-20

Status: **IN PROGRESS / NOT RELEASE READY**. Formal metadata remains **2.4.0**.

## Scope and provenance

Only `D:\Lib\Codex_workplace\ArcLattice` is used. HEAD remains
`a9dc99a37486a191139c548a70150df2d20d6c67`; existing staged, unstaged and
untracked work and original failure evidence are retained. No commit, push, tag,
release, deployment, production-server operation or metadata change is authorized
or performed. Session290 records implementation and failed experiments.

## Performance

The unchanged baseline is `docs/benchmarks/v3-phase7-interaction.json`, backed by
the20 original baseline samples in `.artifacts/v3-baseline-a9dc/.artifacts`.
Comparison uses all20 current samples, original median and maximum10% regression.
The production interaction/typing fixture, trusted input and final saved Markdown
assertions are unchanged. Dedicated performance runs use desktop-zh, worker1,
trace off; no other heavy test/build runs concurrently.

Latest completed formal cohort: **session290-formal-r5,13/14 PASS**.
Functional20/20 PASS,659 source/dist/test/config/lock SHA hashes unchanged.
Functional runner exit0; comparison exit1. Atlas opening now passes, but100KB
typing exceeds its original budget. Passing rows from R4/R5 are not combined.

| Original action | Baseline ms | R5 ms | Change | Gate |
| --- | ---: | ---: | ---: | --- |
| Now → Scheduled |11.3900|9.6500|-15.28%|PASS|
| Task tab switch |11.5905|11.3140|-2.39%|PASS|
| Project filter |18.4990|15.8055|-14.56%|PASS|
| List → Board |11.5185|10.8765|-5.57%|PASS|
| Calendar open |19.2075|14.3295|-25.40%|PASS|
| Calendar month switch |3.3970|3.2770|-3.53%|PASS|
| Dependency local graph |31.9170|32.2710|+1.11%|PASS|
| Task picker open |3.3405|3.4570|+3.49%|PASS|
| Task picker drill-down |2.7485|2.5435|-7.46%|PASS|
| Knowledge local graph |27.3945|23.9945|-12.41%|PASS|
|50KB typing p95|7.2665|7.2585|-0.11%|PASS|
|100KB typing p95|6.9605|8.4580|+21.51%|FAIL|
| Atlas conversation list |15.9020|17.2145|+8.25%|PASS|
| Atlas conversation open |32.2640|34.4595|+6.80%|PASS|

All raw samples, ranges, reports, manifests, integrity and exits are retained under
`.artifacts/session290-formal-r5-*`. Earlier R1/R2/R3/R4 failures are retained. Diagnostic
three-sample cohorts are not substituted for formal acceptance. Latest candidate
has targeted Atlas route/summary/scroll changes; background read-response
scheduling is under correctness validation before another complete comparison.

Actual commands:

```powershell
node node_modules/@playwright/test/cli.js test --config=playwright.performance.config.ts --project=desktop-zh --repeat-each=20 --reporter=line,json --output=.artifacts/session290-formal-r5-results
node scripts/session289-performance-comparison.mjs session290-formal-r5
```

## Complete browser matrix

Latest completed full run: `.artifacts/session289-session290-full-r1-*`.
Command: `node scripts/session289-full-browser.mjs session289-session290-full-r1`.
Production build, three configurations, workers2, retries0, no filters.

| Result | Total | desktop-en | desktop-zh | mobile-zh |
| --- | ---: | ---: | ---: | ---: |
| DISCOVERED |684|228|228|228|
| EXECUTED |684|228|228|228|
| PASS |681|227|227|227|
| FAIL |3|1|1|1|
| SKIP |0|0|0|0|
| INTERRUPTED |0|0|0|0|
| NOT RUN |0|0|0|0|
| FLAKY |0|0|0|0|

14 test files,43.1m,exit1. JSON/HTML/screenshots/failure traces/log/command/exit
and per-test summary are retained; Session285 failure artifacts are not replaced.
Inventory comparison with681 found only one added route-listener race title ×3;
no original title removed to match a number.

All3 failures share **INVALID FIXTURE**: the offline1500-File fixture directly
committed records without advancing Workspace Revision. The durable-revision
loader correctly did not treat an invalidation hint as a new revision. The fixture
now advances revision with expected-version CAS in the same transaction and also
asserts1501 durable File records. All original virtualization, exact bytes, original
download, offline restart and permission assertions remain. Three-configuration
targeted reproduction after repair passes3/3,13.4s. This is TARGETED PASS, not a
replacement complete matrix. A new complete matrix on the final candidate remains
required. Later Worker/route changes also require that new complete run.

## Quality and consistency

Latest completed full quality run:
`.artifacts/session290-full-check-r3.log` / `-exit.txt`.
`pnpm dlx pnpm@11.19.0 check`: **278 files,1454/1454 PASS,0 SKIP**,540.95s,exit0.
Lint925 files, all11 package/root type checks and production build pass. Real
Native Transport fixture is enabled with `ATLAS_NATIVE_TEST_EXE` and loopback
`NO_PROXY=127.0.0.1,localhost,::1`. This full run predates Worker and Atlas changes;
it is not final-source acceptance. A new full check is mandatory.

Subsequent targeted evidence includes readonly ownership/CAS, scoped JSON/epoch/
identity predicates, real IndexedDB paging and worker failure/partial-publication
guards, Wiki rename/edit/deletion, native account isolation, File original bytes,
notification persistence and Atlas history. Counts overlap and must not be summed.
Current targeted browser cohorts include36/36 Worker offline+secure-account,
15/15 keyboard/virtualization/history,9/9 Graph/account/document context and18/18
Atlas summary/identity/provider/context/history. Their raw prefixes are recorded
in Session290. Later changes still require full final-source checks.

## UI, accessibility and Native

Reduced motion, reduced transparency, high contrast and forced colors have
explicit media/computed-style assertions, targeted6/6 across all configurations.
Current full matrix includes the systematic route audit and screenshot captures;
capture counts alone are not visual approval. Actually viewed surfaces and open
Atlas viewport observations are recorded in `UI_NATIVE_AUDIT_2026-10-19.md`.
Sidebar Logo and brand assets remain unchanged.

Current Windows EXE/NSIS and Android APK asset rebuild/automated Native gates still
require final-candidate evidence. Previous packaging and scheduler passes are
historical. Simulated route tests and builds cannot establish physical delivery.

- Windows Toast cold-start click: **MANUAL ACCEPTANCE OUTSTANDING**.
- Android physical notification: **MANUAL ACCEPTANCE OUTSTANDING**.

## Remaining work

Resolve the remaining formal performance gate; obtain a new full684 browser
result and final-source full check; refresh Native automation/assets and finish
actual visual review. Release readiness must remain blocked while any automated
gate fails or final-source validation is incomplete. Even if all automated gates
pass, the correct status is **AUTOMATED ACCEPTANCE PASS — MANUAL RELEASE GATES
OUTSTANDING** until the two physical interaction gates are independently accepted.
