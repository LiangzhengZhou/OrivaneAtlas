# Orivane Atlas v2.3 implementation candidate — local acceptance

> Historical pre-release acceptance record (2026-10-06). The metadata and
> “not performed” statements below describe that local verification window.
> v2.3.0 was subsequently published; current implementation metadata is 2.3.0.
> This record is not v2.4 acceptance evidence. v2.4 work remains local.

Verified 2026-10-06 against the supplied v2.3 product specification. Publication metadata intentionally remains2.2.0 until human acceptance, as permitted by the specification. All changes remain local.

1. **Baseline:** main, HEAD `389b9386b84bdf99093b75a438d773d94f4ad4e2`. Existing work preserved; no reset.
2. **Worktree:** modified source and intended icon derivatives plus new feature/tests/docs files. Latest tracked diff:184 files,9415 insertions,4783 deletions before this report. Full status evidence `.artifacts/session124-final-status.txt`; no commit.
3. **Design system:** token-driven controls, ghost IconButton, semantic pressable/list/menu/calendar surfaces, shared floating/dialog behavior, dark/light and explicit primary variants. Feature layout no longer supplies parallel legacy control visuals.
4. **Shell:** quiet sync state, contextual topbar, navigation settings own drag handles, fuzzy keyboard command palette with actions/navigation/entities/recents, shared Inspector/Atlas Context Pane.
5. **Tasks/Focus:** reduced row metadata and management menus, hierarchy project filters/pickers, preserved view state and recent scope, shared indexes and virtualized collections. Focus retains the action-list role.
6. **Projects/Gantt:** root-first hierarchy, lazy children and inactive tabs, on-demand dependency view; real virtualized start-to-due bars, due milestones, today marker and week/month axis.
7. **Calendar:** semantic contiguous day grid and indexed previews, selected-day action context, compact agenda, distinct start/due/completion/reminder/journal semantics. Formal Reminder lifecycle and native notification path preserved.
8. **Graph:** one route/depth authority, chevrons only change expansion, no synthetic hash events, isolated selection/viewport/URL state, scoped adjacency traversal and modern controls.
9. **Documents/Knowledge:** safe drafts/close flush, active-pane mounting and lazy bodies, Markdown source preserved, line breaks, revision/conflict/image regressions verified; list-first Library and server Retrieval body search.
10. **Atlas/AI Settings:** conversation-first summary list, pagination, rename/archive/restore/delete/undo, existing project/space binding, cursor delta fallback, friendly error retry and section-based provider/model/profile/binding settings.
11. **Cold startup:** paired200ms request-delay median FCP336→144ms;800ms920→132ms. Metadata usability remains comparable (200ms2271.2→2288.2ms;800ms4099.9→4083.6ms). Shell-before-session regression passes. These are local measurements, not p95 claims.
12. **Transfer:**500-document bodies growing1KB→50KB increase current initial bytes1217900→1218400, while baseline1711277→26799277. Brotli50KB-corpus bootstrap11486–11488bytes. Separate150ms/128KiB/s browser probe transfers approximately49KB for3094126 decoded bytes and zero eager bodies. Its roughly18s FCP is dominated by the static JS download; see the honest limits in the cold report.
13. **Native transport:** JSON UTF-8, binary Base64, exact status/content parity and method/origin/account guards.5MiB serialized bridge6990585→5242973bytes, serialization median4.6211→3.5454ms, measured process working set44785664→38690816bytes. Rust serialization/HTTP fixture measurements are not actual WebView IPC scheduling measurements.
14. **Application icon:** canonical source `branding/application-icon-source.png`, RGBA1320×1191, SHA256 `CB8711F35456A3DED810C8658FE303AAFB95DF35978B88F81046BE8DF33412DC`. All platform derivatives share this source; contain/padding preserves aspect, with an automatically generated contrasting backplate. Seven Windows sizes appear byte-identically in EXE and NSIS. Android resources and mirrors match.
15. **Sidebar logo:** before and after SHA256 `12E98E78FD60082975FA0FD655AD1C80C00598186232971AE22CA4971E7BB176`. `Sidebar.tsx` still references `/orivane-atlas.png`; bytes unchanged.
16. **Unit/integration:** final `pnpm check` passes112 test files and657 tests, zero skips; lint/typecheck/build pass. Includes the actual Rust strict-host fixture. Evidence `.artifacts/session124-acceptance-check.log`.
17. **Playwright/visual:** complete suite330/330 (desktop en, desktop zh, mobile zh), then extended cold matrix9/9 including3 new150ms cases.333 distinct cases covered; do not describe this as a single333-case run.24 visual matrices regenerate408 screenshots; all17 required pages reviewed in representative latest light/dark zh/en images across the specified dimensions.
18. **Storage:** append-only SQLite0033 and PostgreSQL0027 Wiki index state migrations. Fresh schemas, exact v2.2 schema32/26 upgrade, shared metadata parity, physical backups and restore regressions pass in the final suite. Historical migrations unchanged.
19. **Native:** Rust20 passed/0 failed/3 default ignored; ignored strict-host and Windows scheduler cases explicitly exercised separately. Windows release EXE/NSIS pass. Android fresh arm64 library equals packaged JNI hash, Gradle95/95 tasks executed, JVM6/6 with no skips, APK production identity and v2/v3 signature verify, icon safe-zone/parity pass. Local symlink fallback uses only the newly compiled verified library.
20. **Limits/blockers:** no remaining source blocker identified. ADB has no connected Android device; physical notification appearance is not verified. Windows interactive installer/notification appearance is not claimed. Automated scheduler persistence/cancel and binary/icon packaging are verified. Local samples and throttled-static-bundle cost are documented, not hidden as environment excuses.
21. **Not performed:** no commit, push, tag, GitHub Release, deploy, production-server operation or subagent. `git diff --check` passes; source absolute-path/private-key/API-key-pattern audit only matches the intentional negative branding test. Generated updater ACL-only build noise restored to exact baseline bytes after native builds.

## Performance evidence

[Interaction benchmark](performance/v2.3-interaction-benchmark.md): all14 five-sample same-window ratios pass≤1.10, measured ratios0.109–0.809. Fixture150 projects/1500 tasks/3000 edges/2000 documents/5000 wiki links/100 sessions; live list10, board14, conversation9 rows;50KB/100KB typing content verified.

[Cold startup report](performance/v2.3-cold-start.md): corpus transfer, compression, paired shell/metadata,150ms bandwidth-limited session/search/body hydration and native payload measurements. Raw failed profiling/probe attempts are retained as diagnostics, not counted as passes.

Native evidence: `.artifacts/session124-rust2.log`, `session124-native-transport-final.log`, `session124-windows-notification.log`, `session124-windows-build.log`, `session124-android-validation.log`, `session124-android-gradle.log`, `session124-apk-signature.log`, `session124-android-icons.log`, EXE/installer icon parity JSON and fresh JNI parity JSON.
