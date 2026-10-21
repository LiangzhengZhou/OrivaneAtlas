# Native automation and UI/Glass audit — 284

## Session290 full-browser visual review in progress

Current complete run: `.artifacts/session289-session290-full-r1-*`; this is not
yet a completed acceptance result. Actually viewed current route-audit images:
desktop-en1024 dark Calendar/Projects, desktop-zh1024 dark Graph and light Settings,
mobile-zh390 dark Calendar and light Projects. In those views, CJK labels/actions
do not overlap and Sidebar/brand assets retain their existing appearance. Mobile
Calendar selected-day Task/Reminder/Journal actions are visible above bottom nav
at the captured viewport; the historical below-fold finding is not reproduced
in that image. This is specific visual evidence, not approval of every capture.

The focused populated Atlas images show a small message viewport, particularly
on mobile; existing fixed viewport subtraction merits further review. No layout
changes are mixed into the current frozen full run. Performance remains blocked.

## 2026-10-20 — Session290 incremental evidence

Not Full Acceptance. Current notification-center browser file passes18/18 across
desktop-en/desktop-zh/mobile-zh, including persisted read/snooze/dismiss/restart,
privacy, native-route simulation, forced-colors and the systematic route audit.
Evidence prefix `.artifacts/session290-notification-browser`; raw JSON, exit/log,
screenshots and retained-failure traces use distinct paths from prior sessions.
The scope-refresh guard and subsequent event optimizations postdate this run;
the final matrix must cover the final source.

The systematic audit captures240 route images (96 EN +96 ZH +48 mobile) at
1024/1280/1440/1920 and390/430, both themes. Captured images are not automatically
visual approvals. Actually inspected in this session:1280-light-ai EN (accurate
offline history-load error),1024-dark-settings ZH,390-light-library mobile,
forced-color Task dialog EN/mobile, plus Session289 mobile secure-account and
390-light-projects. No clear overlap or clipped action was observed in these
specific images; other surfaces remain pending visual signoff.

Reduced-motion/transparency/contrast/forced-colors now have explicit media and
computed-style assertions: session290-reduced-a11y passes6/6 across all three
configurations. This precedes later performance changes and must be covered by
the final full matrix. The684 title inventory is unchanged.
No brand asset was changed. Latest Native assets still predate Session290 Web
changes. Windows Toast cold-start click and Android physical notification remain
MANUAL ACCEPTANCE OUTSTANDING; bridge tests and packaging cannot close them.

This is an audit in progress, not Full Acceptance or release readiness.

Latest focused visible-read browser run passes9/9: Knowledge Wiki neighbors,
Atlas paged Markdown/history reading position and active-document AI context,
across all three configurations. Actually inspected its desktop-zh Knowledge
document screenshot and mobile-zh Atlas history screenshot. The document actions,
CJK text, tab and sidebar have no observed overlap; the mobile message viewport
is small with composer/list both present, so this image alone does not sign off
the whole mobile interaction flow. Full final visual review remains outstanding.

## Provenance / retained scope acceptance

API Granular Scopes: **Targeted Acceptance PASS / Full Acceptance Pending**.
Original root and .git resolve to D:/Lib/Codex_workplace/ArcLattice. HEAD remains
a9dc99a37486a191139c548a70150df2d20d6c67 and release metadata2.4.0.723 porcelain
entries retained. No current documentation or related API evidence log contains
the reported alternative C:/Users/admin/ArcLattice path. No operations performed
there. Actual283 logs show original D: runner root and132/132,46/46,3/3 PASS;
those are distinct overlapping matrices, not a summed test count.

PostgreSQL37 is SELECT1 compatibility marker. Host uses SqliteUnitOfWork and
SQLite AccountStore/migration42 for credentials. PostgreSQL stores business data,
not account tokens. Its credential persistence gate is N/A; fresh/upgrade/physical
restore remain covered by283 evidence. Do not recreate token architecture on PG.

## Notification Native gates

| Gate | Current result / limitation |
| --- | --- |
| Domain/Application/local IndexedDB causes and policies | PASS40/40,6files, session284-notification-focused.log |
| Native doctor / ACL configuration | PASS after existing process-local GNU toolchain loaded; initial missing-PATH failure preserved |
| Rust notification/COM input tests | PASS4,2 opt-in OS tests not run in default filter; session284-rust-notifications.log |
| Real Windows scheduler process-exit durability | PASS1 parent +1 child, explicitly ran ignored test; session284-real-native-scheduler.log |
| Browser durable notification/read/dismiss/preferences/deep-link signal | PASS within15/15 three-project matrix; bridge simulation is not OS click proof |
| Current EXE/NSIS and Android compile | Historical targeted PASS; not rebuilt in284 |
| OS activation cold-click / focus / consume-once after app exit | MANUAL ACCEPTANCE OUTSTANDING, COM callback test does not establish OS launch |
| Android physical notification/permission/reboot | MANUAL ACCEPTANCE OUTSTANDING |
| Native persisted ACK then local CAS/write interruption | UNVERIFIED: external effect precedes local SCHEDULED commit; add deterministic crash/restart proof before claiming closure |

Doctor uses only existing process-local RUSTUP_HOME/CARGO_HOME and GNU1.98.1.
No OS/user toolchain installation or configuration change. OS scheduling probe
uses its disposable identity and cleans only its own schedule/shortcut.

## UI/UX and Glass initial matrix

Production build PASS. Three-project Notification/Float/audit browser15/15 PASS
30.2s in session284-ui-browser-correct-route.log. Initial12PASS/3FAIL retained:
audit erroneously opened bare #graph and required ordinary-page Bell. Corrected
fixture to create a real local Project and open its graph route; Graph gets its
own readiness assertion. No redundant Graph PageHeader/Bell was added to pass.

140 screenshots: desktop-en/desktop-zh at1024/1280/1440/1920, mobile-zh at390/430;
light/dark; Overview/Tasks/Calendar/Library/Project Graph/Atlas/Settings. Directory
.artifacts/session284-ui-audit. These initial captures use sparse offline data;
populated File/Document/Project/tabs/menus and full interaction audit remain open.

Actually inspected: desktop-en1440 light Atlas and1024 dark Calendar;
desktop-zh1280 dark Project Graph; mobile-zh390 light Calendar and430 dark Settings.
Do not interpret capture count as140 manually approved screenshots.

Findings:

1. FIXED: legacy Task Dialog backdrop ignored reduced-transparency/high-contrast
   preference. Scoped no-blur fallback also covers mobile. All three browser
   configurations assert computed high-contrast backdrop-filter:none.
2. OPEN: mobile brand bar plus tall month grid pushes selected-day Agenda below
   the fold. Keep brand image bytes/aspect, review surrounding layout and density.
3. OPEN: Project Graph emphasizes hierarchy depth/system controls; audit FINAL
   information hierarchy before changing controls. No generic second Inspector
   Atlas tab may return.
4. OPEN: Atlas offline session-list failure displays model-request failure before
   a model invocation. Separate data loading and model execution error semantics;
   do not suppress real errors or invent a successful conversation.
5. REVIEW: reduce default bordered control emphasis; maintain one primary action
   per surface and entity-specific open/inspect semantics.

Glass source inventory: token-driven transient Notification Center has opaque,
mobile, reduced-data/transparency and contrast fallbacks. Atlas Float currently
uses opaque raised surface; this is acceptable elevation, not a reason to blur
everything. No Glass should be applied to document bodies, Task rows, Settings
content or virtual lists. Preserve Orivane identity, low chrome and content-first
layout; no copied external UI assets or application code.

Sidebar SHA remains12E98E78FD60082975FA0FD655AD1C80C00598186232971AE22CA4971E7BB176.
No commit/push/tag/release/deploy/server operations or version bump.
## 2026-10-19 — Session285 File/sync correction verified; continuous UI audit active

Project upload now first-class local Blob/File plus REFERENCES, two exact existing
commands. Failed association preserves File identity and offers relationship retry;
real-IDB success/storage failure/link failure/restart tests PASS. Single-command
transaction and replay guards unchanged. ADR0126 records partial success semantics.
A real browser defect remained after upload repair: File soft-delete caused Host
presentation delta to include Link removal with no durable Link journal record.
Strict local validator correctly rejected workDelta; restore stayed PENDING.
Original traces, outbox and raw delta evidence retained (session285-project-file-
sync-stack-results, session285-delta-*.json). No client validator weakened.
ADR0127 adds explicit cookie-only relationMode=canonical to durable bootstrap/sync.
Only logged canonical Link changes enter replica deltas, presentation API keeps
endpoint visibility, bearer/unknown/duplicate mode rejected. OpenAPI updated.
Host/pull/ACK/transaction/File regression6files151/151PASS; latest focused Host
negative cookie/Bearer/query verification1/1PASS (115 unselected, not disabled).
Current File Atlas + chunk/receipt restart + Project File workflow9/9 browserPASS
40.3s across en/zh/mobile. Current typecheck/lint/buildPASS. Initial lint formatting
failure retained; only two recent icon files formatted, lint finalPASS894files.
All3 1500-task Gantt browserPASS; three-row compact-height Gantt3/3PASS. Project
Knowledge now no bordered outer card, fewer primary buttons/empty group headings,
creation form collapses after first Space, legacy delete in shared danger menu.
Actual new mobile Project image inspected; current document/mobile Atlas/Memo
permission screenshots inspected. Full visual/automated acceptance NOT complete.
Current command79723: extended UI/keyboard/Glass/FullAtlas/Recurrence three-project
browser matrix; inspect session285-ui-surfaces-current.log/results. File Atlas
screenshot now uses test output path, avoiding future overwrite of historical227
artifacts (current run earlier refreshed that legacy path; do not call it pristine).
After UI audit, complete corrected-resource native APK/EXE then second full FINAL.
No commit/push/tag/release/deploy/server/version changes. Manual OS cold-click and
Android physical notification still outstanding, not simulated PASS.

## 2026-10-19 — Session285 current Native/UI and first full-quality run

Current Android arm64 validation EXIT0: session285-current-android-validation.log.
95Gradle tasks executed; JVM Notification4/Update3 PASS; fresh JNI SHA D5FE5483F3AD9F6F6B94FF7B8E52EBBCAB57FC020A4E2DA712D8BE5AB1665FBF parity;
signed APK v2/v3 and package/version2.4.0 PASS; all10 icon-density checks PASS.
Physical Android/real Windows toast cold-click remain MANUAL gates.
Current extended UI44/45PASS; mobile failure was deprecated hidden Sidebar hover
instead of existing MoreSheet. Replaced with actual MoreSheet visible handle/focus/
Escape checks, retains desktop hover. Follow-up three-project palette/recurrence/
DateField9/9PASS28.4s; recurrence/DateField previously assumed synchronous remote
commit and now wait for exact asynchronous canonical replay, original rule/ISO
assertions retained. Forced-colors actual desktop blur14px reproduced2FAIL/1PASS;
fixed CSS opaque fallback, current three-project3/3PASS within44/45 matrix.
Viewed current FullAtlas desktop/mobile, recurrence zh, forced-color dialog,
mobile Project Knowledge, editor Atlas stale proposal; no all-page blanket PASS.
First current pnpm check: lint/typecheckPASS; full Vitest1362PASS/13FAIL/1existing
skip,263files,495.61s; source failure evidence in session285-full-check-current.log.
All13:11 stale exact current migration version assertions (SQLite40→42,PG35→37),
2old exact bootstrap/sync URL assertions (canonical mode now explicit). Physical
old-backup schema assertions and original-byte/CAS/permission checks unchanged.
Current focused10-file real migration/restore/account regression running97055:
session285-full-failure-targeted-fixes.log. No parallel build/browser task.
Next: inspect focused result, rerun full check, current Windows Rust/EXE/NSIS/ACL,
second full browser matrix and performance, finish remaining screenshot review.
Investigate legacy ProjectMaterial FILE original-read path separately: current
new uploads correctly use first-class File; old metadata remains preserved but
legacy runtime download intentionally rejects. Do not silently discard/migrate
old bytes or call this path verified. No publish/server/version action.
