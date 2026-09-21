# Development guide

This guide is for contributors working on Orivane Atlas. Production operations, credentials, private server details, and historical handoff records are not part of the public development workflow.

## Architecture

Keep the dependency direction explicit:

UI -> Application -> Domain / Ports -> Adapters

- apps/web: React/Vite user interface.
- packages/application: use cases, authorization, transactions, and ports.
- packages/domain: framework-independent entities and rules.
- packages/storage-* : persistence adapters and migrations.
- packages/host: HTTP host and infrastructure assembly.
- packages/i18n: en-US and zh-CN user-visible strings.
- src-tauri: native client packaging and platform integration.

## Setup and validation

~~~powershell
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm test:e2e
~~~

Useful focused commands are pnpm lint, pnpm typecheck, and pnpm format. Run end-to-end tests on an isolated development machine and never use production data for tests.

After building, validate the 900px layout with `pnpm exec playwright test --config playwright.narrow.config.ts --grep "inline prerequisites|workspace timezone appearance|parent tree and canvas"`. Run this separately from the default suite because the disposable hosts share ports 1420/1421. Tests save screenshots for visual review; they do not replace native-device acceptance.

Biome honors Git ignore rules and excludes generated native schemas and the preserved refactor backup; maintained source and architecture boundaries remain checked. Do not reformat backup copies or generated schemas to fix source lint. For native transport integration coverage, set `ATLAS_NATIVE_TEST_EXE` to the locally built Rust release test executable before running `pnpm check`; without that fixture, report the native integration coverage as skipped. Browser native mocks are not real-device validation.

## Contribution rules

- Every business access carries a workspaceId; every mutation identifies a principalId.
- Important entities use optimistic version checks. Core deletion is soft deletion unless a documented exception exists.
- Business changes and Activity/Outbox records are committed together. In-memory events are not a reliable message system.
- Schema changes require a migration and backup/restore validation.
- Public HTTP changes update docs/api/openapi.json.
- Agent tool changes update permission and approval documentation.
- Domain code must not depend on UI frameworks, databases, or AI SDKs.
- Markdown content must be preserved and must not be silently converted into tasks.
- Credentials, provider secrets, encryption keys and signing keys never belong in source code, browser storage or commits. User data never belongs in source code or commits. The versioned, server/account/workspace-isolated local draft cache is an explicit browser-storage exception (ADR 0041); it is not an offline replica. Sensitive/secret drafts are memory-only.
- User-visible text requires en-US and zh-CN variants; user-authored content must not change with the UI language.

## AI and collaboration scope

AI integrations are optional product capabilities. Future multi-user or local-AI collaboration must retain explicit principals, workspace authorization, approvals, auditability, and safe tool boundaries. This repository is not an AI handoff queue. Do not add arbitrary shell execution or unrestricted plugin execution to the host.

## Documentation policy

Public documentation should help users, operators, or contributors run and understand the product. Do not add credentials, private addresses or paths, production logs, account inventories, internal maintenance procedures, or historical handoff notes.

See SELF_HOSTING.md, STORAGE.md, the OpenAPI contract, and the public architecture notes.
