# Durable local sync protocol — implementation contract

This records the current v3 worktree, not full v3 acceptance. FINAL specifications remain authoritative. The shared Application coordinator, original command serializers, Host transaction guards and strict local replica adapters implement the paths below. Explicit first binding/merge review, durable conflict review, remaining command families and binary sync are still open.

## Identity and authorization

A local installation has durable workspace, owner principal and device IDs. Login does not automatically bind, merge or replace local data. A confirmed binding carries local workspace, remote workspace/principal, server origin, sync epoch, cursor and optimistic binding version. Requests and reconciliation pin the complete binding and authentication generation; a switched account/server cannot acknowledge another workspace's mutations.

Human original replay uses cookie authentication, CSRF and `Idempotency-Key`. The request's command ID must match that header. Host resolves the actor from authentication, never from client workspace/principal/audit fields. Stable primary IDs preserve offline identity; Activity, revisions and ordinary audit IDs retain their independent allocation. Bearer credentials cannot invoke the private human replay guard.

## Original intent and atomic local mutation

The existing local mutation transaction commits business entities, body/revisions/search/Wiki projections, immutable original command and ordered Outbox effects together. A `$local.command` record has schema version 1, the first mutation ID as command ID, original operation input and the full ordered mutation ID collection. Effect ordering includes transaction revision and operation index.

Replay serializers use original input and original effect base versions. They do not reconstruct commands from current entities, bootstrap metadata, changed Markdown or a workspace diff. A later local edit cannot silently replace an earlier command's payload. Stable ID restore preserves original device IDs in old mutations even when the restored installation receives a new device ID.

Outbox states are `PENDING`, `SENDING`, `CONFLICT`, `REJECTED`. Acknowledgement removes only the exact original accepted mutation IDs under replica CAS; there is no fabricated ACKED entity mutation. An uncertain network outcome keeps SENDING and its attempt metadata. A conflict retains original mutation and local projection for review.

## Server transaction and receipts

Optional `syncCommand` contains `commandId`, `deviceId` and full effects (`collection`, `id`, `op`, `baseVersion`). Ordinary Application services execute against narrow guarded transaction ports. Every declared effect must be consumed with the original version; unexpected effects, missing effects, foreign actor/workspace or stale versions roll back business changes and receipt together. Client canonical entity blobs never substitute for an Application command.

The server stores the original result and final canonical effects in the same transaction as entity changes, Activity/Outbox and durable WorkspaceChange. Repeated command keys with the same original request return the same receipt. A changed digest/device is an idempotency conflict. Authentication and workspace ownership are checked before cached receipt retrieval.

`GET /api/v1/sync/receipt?commandId=...&deviceId=...` is owner/device scoped and read-only. An unknown or foreign receipt returns 404. Recovery checks receipts before resending an uncertain command. A missing receipt permits only the original request; it never authorizes a rebuilt diff.

Backfill can write one Task twice (create base 0, complete base 1). The original effect group retains both mutations. Its canonical receipt contains one final Task effect at version 2, and acknowledgement consumes both exact original mutation IDs. Occurrence IDs preserve `occurrence:<definition-id>:<day>` and SKIPPED remains distinct from MISSED.

## Incremental pull and local replica commit

`GET /api/v1/sync?after=<seq>` reads persisted WorkspaceChange sequence, not snapshot/stringify/hash diff. Initial bootstrap, invalid epoch/cursor and recovery have separate snapshot/recovery boundaries. Normal incremental pages are scoped by authenticated workspace and epoch and carry ordered changes with canonical values/removals.

The coordinator serializes/coalesces pull, receipt recovery, original command claim/push, atomic acknowledgement and follow-up pull. A prepared replica commit checks local workspace revision, complete binding/cursor, pending mutation ownership, exact attempt state and entity/base versions. It writes canonical remote base and permitted local projections atomically. Newer pending local edits remain visible and are not overwritten.

Remote bases retain canonical remote workspace/audit facts. Local projections map workspace ownership explicitly. For recurrence workflows only the confirmed remote owner maps to the installation owner; foreign creators remain foreign. Principal-owned navigation preferences and scoped manual-order entries have their own explicit mapping contracts.

Unsupported collections or malformed workflow contracts are rejected before cursor advancement. Validated PLAN and recurrence records share the canonical workflow dispatcher. Unsupported or legacy commands remain unresolved in Outbox; they are not guessed, cleared, skipped or reported as synced. Supported original families currently include Work/edges, Note/Library save/deletion, Reminder, Calendar settings, Navigation, manual order, Category, Organization, Project knowledge, Recurrence lifecycle, Link creation/deletion, Note linking/promotion and original PLAN preview/publication. PLAN revision is not an advertised original replay command. Original File upload/rename/delete/restore now use scoped canonical replay and durable receipts; upload completes verified bounded binary transfer before metadata registration. Remote File pull contains metadata only. Original bytes hydrate on demand using pinned binding/provenance and SHA256 verification; raw native IPC excludes the generic JSON bridge. File extraction, derived relationships, policy automation and complete Files acceptance remain open.

## Markdown hydration

Bootstrap/pull metadata does not imply an available body. Durable MISSING body records carry origin, remote workspace/principal, epoch and version provenance. Reading missing content raises `LOCAL_BODY_UNAVAILABLE`; unexplained missing owned data raises corruption, not an empty draft.

Hydration pins binding/generation, validates canonical identity/version and metadata/base agreement, and rejects pending edits. Body, revision, search, Wiki and AVAILABLE marker commit together through replica projection ports. Hydration does not acknowledge Outbox, advance the sync cursor or create a user mutation. Notes and documents retain exact UTF-8 Markdown.

## Verification evidence

Sessions185–199 record exact SQLite/PostgreSQL, Host, real IndexedDB/offline/restart/browser and native transport commands/results. Frozen session198 passed 943 tests with one pre-existing conditional skip in378.74s; its expanded browser group passed78/78. Session200 earlier full check passed956 tests/1 pre-existing conditional skip in379.83s before the new PLAN guards. Original PLAN Work and owned Knowledge SQL/PostgreSQL parity passed4/4 in29.04s; real Host+IndexedDB Work and PLAN restart/recovery group passed6/6 in15.8s. A newer complete check is running .artifacts/session200-plan-full-check.log; its outcome is not assumed. These are implementation evidence, not a claim that all FINAL Local-first/Sync requirements are complete.

## Original PLAN publication

Preview captures the detached manifest, project context, stable workflow identity and original graph/document revisions. The Host executes ordinary preview and rejects changed revisions inside the transaction; it does not approve a freshly recomputed baseline. Publication executes the existing human-review WorkflowService. Its explicitly scoped WorkTransaction guard covers Work, edges, Category and Workflow effects; a composed knowledge guard covers Library and project materials in the same outer transaction. Nested ProjectService reads reuse the guarded transaction and do not restart complete-effect preconditions. LINKED-to-OWNED material creation retains both original versions; the receipt carries final version2.

A metadata pull can precede recovery of a lost body-bearing receipt. Exact same-version remote manifests can be hydrated only when manifest metadata, character count and policy match the canonical authenticated receipt. The bootstrap manifest does not contain a content hash. Title/count/policy mismatches remain conflicts. This does not permit arbitrary client bodies, silent local overwrite or cursor advancement across unsupported collections.
