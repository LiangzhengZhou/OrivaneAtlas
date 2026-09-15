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

## Contribution rules

- Every business access carries a workspaceId; every mutation identifies a principalId.
- Important entities use optimistic version checks. Core deletion is soft deletion unless a documented exception exists.
- Business changes and Activity/Outbox records are committed together. In-memory events are not a reliable message system.
- Schema changes require a migration and backup/restore validation.
- Public HTTP changes update docs/api/openapi.json.
- Agent tool changes update permission and approval documentation.
- Domain code must not depend on UI frameworks, databases, or AI SDKs.
- Markdown content must be preserved and must not be silently converted into tasks.
- Credentials, provider secrets, encryption keys, signing keys, and user data never belong in source code, browser storage, or commits.
- User-visible text requires en-US and zh-CN variants; user-authored content must not change with the UI language.

## AI and collaboration scope

AI integrations are optional product capabilities. Future multi-user or local-AI collaboration must retain explicit principals, workspace authorization, approvals, auditability, and safe tool boundaries. This repository is not an AI handoff queue. Do not add arbitrary shell execution or unrestricted plugin execution to the host.

## Documentation policy

Public documentation should help users, operators, or contributors run and understand the product. Do not add credentials, private addresses or paths, production logs, account inventories, internal maintenance procedures, or historical handoff notes.

See SELF_HOSTING.md, STORAGE.md, the OpenAPI contract, and the public architecture notes.
