# Unified upgrade — runtime closure audit

Current source audit: session 092, 2026-10-02. Historical sessions 090/091
are baselines; their unconnected-foundation findings are superseded below.
This audit covers the runtime blockers explicitly assigned in session 092,
without redesigning the completed Shell, Project, Graph or document UI.

## Implemented and runtime-integrated

| Capability | Production path and verification |
| --- | --- |
| ProjectKnowledgeScope | Project knowledge search, DocumentWorkspace Wiki completion, KnowledgeGraph and Host Assistant retrieval use the shared application resolver. Order is Current Space, Primary Owned, other Owned, Linked, Inherited, workspace fallback. Shared application scenarios run against both databases; browser integration exercises all four consumers in one Project A context. |
| RetrievalService | Assistant propose invokes the shared search_documents registry implementation, combining title/body/alias full text, Wiki neighbors/backlinks, scope priority and recency. Permission filtering precedes result limits, followed by Gateway content-policy and parent-Space checks before approval. No Assistant snapshot.filter context assembly. |
| AiContextItem | Host constructs typed current/selected/retrieved/linked/mentioned manifests from server-loaded revisions and policies. Approved prompt content derives from that manifest and revalidated successful conversation history. Reserve and every provider attempt recheck document versions, route fingerprint, content policy, actor and session version. Changing approved context prevents invocation. |
| AiCapability | Assistant retrieval and document proposal/application, human capability endpoint and MCP share seven implementations: search_documents, read_document, get_project, list_project_tasks, create_task, propose_document_edit, link_documents. Authorization and REVIEW_WRITES gate PROPOSE/WRITE; MCP cannot manufacture approval. Capabilities call application services/ports, never SQL adapters. MCP document disclosure additionally requires both document and Space ALLOW/ANY, never SECRET. |
| Provider Adapter | Gateway uses the real adapter or the explicit compatibility adapter. Vault-backed adapters implement Chat/Responses invocation, actual SSE stream, optional embedding route and model listing. Tools/jsonSchema/vision are false for these adapters; no tool schemas or autonomous provider tools are sent. Credentials, reservations, usage and fallback fingerprints retain their existing boundaries. |
| Streaming | Real network SSE is incrementally decoded into text-delta, usage, completion/error events; the Gateway event union also represents tool-call/tool-result, which unsupported adapters reject. Assistant consumes authorized transient events while the durable AgentRun/session receives the final result. supportsStreaming=false invokes complete without fabricated deltas. Timeout/cancellation and uncertain-send settlement remain active; an observed provider event or unknown network outcome cannot trigger automatic fallback. |
| AgentSession | SQLite/PostgreSQL actor-owned versioned session stores retain USER/ASSISTANT, explicit capability TOOL_CALL/TOOL_RESULT/PROPOSAL and ERROR records. Host session API, approval and completion use them transactionally. Assistant reloads and continues the same session, including outstanding approvals. Rejected conversation content is excluded from future model prompts; successful historical context is revalidated. AgentRun remains the execution/audit/usage record. |
| Persistent aliases | Normalized workspace-unique aliases are persisted beside documents, with previous titles retained on rename. Collision, delete/restore and workspace boundaries are enforced; Wiki resolution and autocomplete consume persisted aliases. Deleted documents reserve their aliases but do not resolve. |
| Document hierarchy | Same-Space parentDocumentId persists in both backends and is used by the Space list and editor parent selector. Self/cycles, cross-Space parents and deleting parents with live children are rejected. Restore requires a live parent and Space; rename preserves hierarchy. Spaces remain top level. |
| PostgreSQL knowledge parity | Real Library/ProjectMaterial/AgentSession adapters run through the actor-bound PostgresUnitOfWork.knowledge transaction port. Shared application and independent-transaction round-trip tests cover bindings/roles/inheritance, scope/retrieval, Wiki unresolved/backlinks/re-resolution/rebuild, aliases, hierarchy, revisions and sessions, with workspace isolation. Valid existing bindings are backfilled into the runtime repository. |
| Trusted AI endpoints | Administrator cookie/CSRF and workspace authorization control a persistent versioned allowlist. Exact normalized endpoint matching participates in vault configuration and every actual network send; DNS is validated and pinned. Only bounded loopback/RFC1918/ULA destinations gain trust; metadata/link-local/unspecified targets, credentials, query/hash and arbitrary paths remain rejected. Revocation and old receipt replay cannot restore trust. Trust does not override content policies or store credentials. |
| Existing upgrade | Neutral themes, AppShell/navigation, Command Palette/Undo, Project Overview/Tasks/Knowledge, explicit spaces, separate dependency/knowledge graphs, document diff/merge and Wiki flows remain in place. No obsolete GraphCanvas or old project tabs were restored. |

## Persistence and migration evidence

Previously added SQLite 0021/0022 and PostgreSQL 0012/0013/0014 are preserved.
Session 092 appends SQLite **0023 document metadata**, **0024 AgentSession**;
PostgreSQL **0015 document metadata**, **0016 knowledge runtime repositories and
binding backfill**, **0017 AgentSession**. Applied migration SQL is not rewritten.

Document/revision/alias/hierarchy/Wiki changes and Activity/Outbox are atomic;
session/tool changes and Activity/Outbox are atomic. Audit remains independent.
Trusted endpoint configuration reuses the existing instance_setting envelope,
with actor-derived workspace entries and atomic version/receipt checks.

Wiki index can be rebuilt through the human-authorized application endpoint;
Host startup rebuilds existing live documents and retains known rename aliases
before replacement. Bodies and revisions are not rewritten. Both adapters expose
the same rebuild behavior.

Fresh/upgrade/data-preservation/transaction rollback and verified backup restoration
are covered by the migration suites. New-file restoration is the rollback path;
never downgrade a live database in place. The shipped account/HTTP Host continues
to use SQLite; the PostgreSQL knowledge application runtime is a production adapter
port, not a replacement account/HTTP server in this task.

PostgreSQL restoration is also exercised with real offline physical snapshots of
the disposable portable cluster: restore schema14 into an independent directory
after schema17 upgrade, and restore current aliases/hierarchy/Wiki/sessions through
the application adapters. This is actual data restoration, separate from tests
using a migration backup-hook double. No production/system PostgreSQL is stopped.

## Optional / environment-limited

- Semantic embedding indexing is optional; baseline retrieval does not depend on
  an immature embedding persistence layer. Vault embedding routes can invoke the
  provider adapter, but no semantic-index availability is falsely advertised.
- Third-party real-provider billing/compatibility requires configured credentials.
  Automated tests invoke the production transport with controlled network responses;
  no paid provider calls were made. Non-streaming providers can opt out explicitly.
- Autonomous model tool execution, structured-block UI, shared Inspector expansion
  and broader Graph/Undo design are outside this runtime-closure scope. Unsupported
  provider tools are rejected rather than displayed as available.
- Native Cargo validation was unavailable in the default environment during
  preparation. Release execution reused the existing isolated toolchain: Cargo
  check passed, release-profile tests15 passed/1 strict-host fixture ignored,
  Android JVM tests3 passed and both native packages/signatures were rebuilt and
  verified. Physical-device and installed-app upgrade acceptance remain separate.
- Existing frontend chunk-size warning remains; transient streaming events are bounded
  process memory, not a reliable message bus. Final messages are durable.

## Final validation

Final frozen-source validation completed on 2026-10-02 (Asia/Shanghai):

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check`: all passed.
  Both full test executions report **521 passed, 1 native fixture skipped**.
- `pnpm test:e2e --reporter json`: **162 passed**, 0 failed, 0 skipped, 0 flaky;
  desktop-en, desktop-zh and mobile-zh. Updated screenshots were inspected.
- Independent SQLite/PostgreSQL migration, shared knowledge application parity
  and actual PostgreSQL physical backup restoration suites: **41 passed / 5 files**.
  Fresh/upgrade, preservation, independent-transaction round-trip, workspace
  isolation and restoration are covered.
- `git diff --check`: passed. Additional untracked-file whitespace inspection:
  72 files, zero errors. At the end of runtime closure, all 435 frozen
  source/config/API/test file hashes matched the versions validated;
  HEAD remained 73384c56b189cc05f65b80b247169d2091ffcc51.

Detailed runtime-closure evidence is retained in private local verification records,
outside the public source candidate. Version 2.0.0 release preparation subsequently
changed only release metadata/documentation and the OpenAPI version-consistency
assertion, then repeated the full validation with the same 521/1, 162/0/0/0 and
41-passed results. See [prepared release notes](RELEASE_2.0.0.md).

No core runtime blocker remains within the assigned closure scope. Runtime closure
and preparation did not publish or deploy. Subsequent authorized GitHub release
execution added native checks with existing isolated tooling; see the release
notes for results and limitations. No server deployment is part of this release.
