# Orivane Atlas v2.0.0

GitHub Release tag: **v2.0.0**. Title: **Orivane Atlas v2.0.0**.
Windows x64 and Android arm64 packages are built from this version, with the
existing updater key and Android production certificate.

## Major upgrade

Orivane Atlas 2.0 introduces a knowledge-first workspace with multi-space project
knowledge, a persistent Wiki system and an integrated AI runtime.

- Workspace Shell with light/dark design, collapsible navigation and Command Palette.
- Project-owned, linked, inherited and primary knowledge spaces.
- Wiki links, persistent aliases, backlinks, unresolved-link resolution and hierarchy.
- Separate Knowledge Graph and scoped Project Dependency Graph.
- Document Workspace with revisions, diff/merge, Slash commands and Undo.
- Atlas Assistant with retrieval, approved AI context, shared capabilities, provider
  adapters, real streaming and durable AgentSession conversations.
- Explicitly trusted local/private AI endpoints under administrator authorization.
- SQLite/PostgreSQL knowledge persistence parity and tested migrations/restoration.

## Breaking changes

- Project navigation is Overview / Tasks / Knowledge. Integrations relying on old
  document, graph, timeline or activity tabs should migrate; legacy route mappings
  are retained by existing compatibility code.
- Upgraded schema targets are SQLite24 / PostgreSQL17. Old binaries must not write
  these databases. Rollback uses a verified pre-upgrade backup, not schema downgrade.
- AI context and writes remain subject to policy, versions and explicit approval;
  a private endpoint requires exact administrator trust, not an arbitrary SSRF bypass.

## Migration notes

Back up and validate restoration before upgrading. SQLite0021–0024 and
PostgreSQL0012–0017 add Wiki indexes, knowledge bindings, metadata/hierarchy and
sessions. Existing projects, Markdown documents, revisions and workspace isolation
are preserved. See [Migration to 2.0](MIGRATION_2.0.md) and [Changelog](../CHANGELOG.md).
Upgrade the self-hosted server to matching 2.0 source/migrations before using the
new clients. Publishing this release does not automatically deploy or migrate servers.

The shipped account/HTTP Host remains SQLite. PostgreSQL parity covers production
knowledge application adapters; it does not claim a PostgreSQL account deployment.

## Known limitations

- Windows installer upgrade acceptance and Android physical-device validation
  have not been performed. Windows updater signatures are verified, but this is
  not an Authenticode publisher certificate.
- The native strict-host fixture remains ignored without its separate local
  fixture. All other native unit tests passed; no test was removed to publish.
- Automated provider tests use controlled network responses; paid real-provider
  compatibility requires configured credentials. Embedding indexing is optional,
  and autonomous model tools are not advertised.
- Existing frontend large-chunk warning remains.

## Source validation

Release preparation validated on 2026-10-02: lint, typecheck, test, build and check
all passed. Full tests: **521 passed / 1 native fixture skipped**. Complete E2E:
**162 passed / 0 failed / 0 skipped / 0 flaky** across desktop-en, desktop-zh and
mobile-zh. Independent SQLite/PostgreSQL migration, application parity and actual
backup restoration suites: **41 passed**. `git diff --check` passed.
Native checks: `cargo check --locked --offline` passed; release-profile tests
**15 passed / 1 strict-host fixture ignored**. Android JVM tests **3/3 passed**;
APK package app.orivane.atlas, version2.0.0/versionCode2000000 and v2/v3 production
signature verified. Windows updater signature, including tamper/truncation
rejection, verified independently. Existing isolated tooling was reused, not installed.
Third-party attribution is in [notices](../THIRD_PARTY_NOTICES.md).
