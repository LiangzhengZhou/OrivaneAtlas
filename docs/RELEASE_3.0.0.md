# Orivane Atlas 3.0.0

Orivane Atlas 3.0 adds durable local-first workspaces, explicit synchronization and conflict review to the knowledge and project workspace.

- Work offline with IndexedDB storage, restart recovery, an outbox, device-scoped receipts and acknowledgement recovery. Entity versions and workspace revisions reject stale writes.
- Store and synchronize first-class files with chunked transport, exact-byte downloads, extraction/search and Project Knowledge integration.
- Keep EntityMemo and private memos within their account, workspace and owner boundaries. Atlas proposals retain explicit review and content authorization.
- Use the notification center, native scheduling recovery, graph navigation, task workflows, notes, Markdown and mobile navigation.
- Grant scoped API/MCP access without bypassing private content, file permissions or human-only operations.

The recurrence lifecycle and knowledge-link unlink fixes restart only aborted workspace-revision transactions, with a bounded attempt limit. They retain the original entity version, input, atomic transaction and outbox semantics.

## Validation

The accepted product implementation passed the complete desktop-en, desktop-zh and mobile-zh browser matrix:684/684,228 per configuration, zero retries, failures, skips or interruptions. Full quality validation passed284 test files and1475 tests, with zero skips and the real native transport fixture enabled. Lint, architecture boundaries, type checking and production builds passed.

Formal performance R11 passed all14 metrics across20 complete samples under the original median and10% regression budget. All673 frozen source/build/test hashes matched. Earlier R9/R10 failures remain recorded; metrics were not combined across runs. Release preparation changed version metadata and documentation only. The3.0.0 release check also passed284 files /1475 tests with zero skips, lint, type checking and production build. Of the673 R11 files,671 remain byte-identical; the only changes are the root package version and the copied OpenAPI version. Browser JavaScript/CSS/Worker assets and all measured application/storage/test source are unchanged.

Native automated evidence includes30 ordinary Rust tests, three explicitly executed OS recovery parent tests, real Host transport, Windows EXE/NSIS, Android policy tests, production APK identity, updater signatures and packaged icon checks. The3.0.0 native rebuild passed30 ordinary Rust tests, all three explicit OS recovery parents, seven Android policy tests and95 executed Gradle tasks. Production APK v2/v3 signatures retain the existing certificate; the Windows updater signature was independently verified. Default ignored test helpers are not counted as ordinary passes.

## Upgrade and backup

Back up the complete database and encrypted provider vault separately before upgrading. Upgrade the matching server before connecting new clients. Preserve the old source, compiled assets and a pre-upgrade database snapshot. Verify restoration into a new file; never open an upgraded database with an older Host or overwrite a live database during a restore rehearsal.

The server includes append-only SQLite migrations through42 and PostgreSQL migrations through37. Device IndexedDB migration and account/workspace binding checks remain mandatory. PostgreSQL is not used to store account credential plaintext.

## Outstanding manual acceptance

- Windows notification activation by a real cold-start click after the application exits.
- Android physical-device notification permission, background delivery, reboot/timezone recovery and actual notification click.

These remain unverified manual gates. Automated scheduling probes, route simulations, APK signing and successful builds do not establish physical-device acceptance. See the dated final acceptance report for the evidence boundary.

Windows updater signatures authenticate update packages against the embedded application key; they are not an Authenticode claim. Android arm64 releases retain the existing application identity and production signing certificate.
