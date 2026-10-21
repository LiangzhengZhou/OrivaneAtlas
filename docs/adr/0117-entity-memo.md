# ADR 0117 — First-class EntityMemo

Proposed 2026-10-16 for FINAL blocker 2. Status: partial implementation only.
Domain/Application/private-owner validation and real IndexedDB durability have14
focused passing tests. Local staging is implemented but not exposed in runtime;
SQLite/PostgreSQL adapters and append-only migrations now exist and have focused
transaction/lifecycle tests. Full replay/private-owner sync, runtime UI and
acceptance remain pending.
Nothing is committed or merged; this is not a completed blocker.

## Problem

Projects, Tasks, Milestones and Files need one continuous, personal working memo
each. A memo is not a Document: it has no title, folder, Space, wiki identity or
export surface, and it must never be listed in Knowledge. Reusing Document would
leak memos into library search, wiki resolution, trash and AI retrieval and would
let a user create several "memos" for one owner.

## Decision

`EntityMemo` is a new workspace-scoped, versioned, soft-deletable entity.

- Fields: `id`, `workspaceId`, `ownerPrincipalId`, `targetKind` (`PROJECT | TASK | MILESTONE | FILE`),
  `targetId`, `bodyMd`, `version`, `deletedAt`, `createdAt/By`, `updatedAt/By`.
- Identity is derived, not random: UUIDv5 under the RFC DNS namespace, with
  `JSON.stringify([workspaceId, ownerPrincipalId, targetKind, targetId])` as its name.
  Tuple encoding prevents separator collisions; the canonical actor must come
  from an explicitly reviewed workspace/account binding. Exactly one memo can exist per principal and target, on every device, without
  coordination. Two offline devices that both create a memo converge on the same
  id and are then an ordinary same-version conflict, never two memos.
- Storage enforces the same rule: a unique key on `(workspace_id, owner_principal_id, target_kind,
  target_id)` in SQLite and PostgreSQL, in addition to the primary key.
- `bodyMd` is Markdown text only, capped at 100000 characters like Reminder.
  It is never converted into a task. It reuses the existing conservative three-way
  Markdown merge and conflict review (field name `bodyMd`).
- Lifecycle follows the owner. Soft-deleting or restoring the owner does not
  rewrite the memo; the memo is hidden while its owner is deleted and visible again
  on restore. Purging the owner purges the memo in the same transaction. Archiving
  or completing a Project/Milestone leaves the memo editable.
- Authorization requires the memo owner to match the authenticated principal,
  in addition to target permissions: reading requires reading the target;
  writing requires update permission on the target. Project access alone never
  grants access to another principal's private memo. File memos also
  require the File content permission that Files already enforce, so a memo can
  never be a side channel around a File's AI/export policy. Memos default to the
  owner's content policy and are excluded from AI context unless that policy allows
  the owner's body.
- External REST/MCP access defaults to denied even when the target is readable;
  private memo content needs an explicit dedicated content permission. Replication,
  snapshots and backup reads must preserve principal filtering. Workspace/account
  mapping explicitly maps the local owner to the authenticated remote principal,
  never trusting an owner supplied by an external caller.
- Mutations go through the existing command path: stable-id replay, the
  `Idempotency-Key` receipt, Activity and Outbox in the same transaction. Audit is
  unchanged. No new real-time or sync mechanism is introduced.

## Local-first

A new replica collection `entityMemos` is added to every place that enumerates
collections (replica, pull, replay request, replay ack, unit of work, import steps,
merge selection). A memo is created lazily on first non-empty save; an empty memo is
never written. Reload and restart read the same durable record.

## Schema and rollback

New SQLite migration 0041 and PostgreSQL migration 0036 create `entity_memo`,
`entity_memo_activity`, `entity_memo_outbox`, the unique owner key, and the workspace
change triggers. Migrations are additive; rollback is the existing pre-migration
snapshot (SQLite) and transactional migration (PostgreSQL). Schema-object checks list
the new tables. Backup/restore contracts include the table.

Private change rows carry a nullable `owner_principal_id` in the existing
workspace journal. Public/default change readers exclude private rows; explicitly
owner-scoped internal reads filter both the change and current entity. This scope
must come from authenticated context, never a request-supplied principal. Purge
retains owner identity on tombstones. Existing public REST/MCP credentials do not
implicitly grant access. Host/bootstrap/replay wiring must preserve this rule
before Memo is exposed in runtime.

Current targeted evidence: migration suites42/42; real SQLite/PostgreSQL Memo
contracts4/4, including versions above int32 and through MAX_SAFE_INTEGER,
SQLite backup/restore and a PostgreSQL offline physical snapshot restored into
an independent disposable data directory. Private-body filtering survives both
restores. Real IndexedDB close/reopen and isolated archive restore preserve the
Memo, its original commands, versions and pending Outbox; focused command/restore
regressions6/6. A local `memo.save` command is now captured atomically. Its replay
handler and owner mapping now preserve original commands/receipts, and private
pull plus explicit edit/concurrent-create review are covered by real Host/two-IDB
tests. Reviewed workspace import maps the destination target first, then derives
its private Memo UUIDv5. Remote owner fields are never accepted as authorization.
Import re-review reads the authenticated owner's private journal, pins the
account/service/workspace and checks the cursor again afterwards. A changed
destination requires a new review; choosing a body updates the replay effect's
CAS together with the command version. Private content is not added to bootstrap.
Product UI, delete/purge review and the complete binding/browser matrix remain
open; none of this evidence closes blocker2 or constitutes FINAL acceptance.

## API

Reviewed import preserves a source Memo even when its saved Markdown is empty or
whitespace-only. Ordinary first empty save remains a no-op. The existing explicit
import protocol (workspace precondition plus exact canonical replay effect at
version0) invokes a distinct Application import operation, which creates the
owner-derived row and Activity/Outbox atomically without changing source text.
An existing destination Memo still fails version0 CAS. A re-reviewed update uses
the ordinary nonzero-version save operation. No fake text, owner override,
permission bypass, new persistence mechanism or unreviewed fallback is allowed.

`POST /api/memo/save` (cookie plus CSRF, strict keys, no bearer) and target-scoped
`GET /api/memo` for an owner. Private journal reads require explicit authenticated
opt-in; public/default readers and Bearer credentials cannot expose Memo content.
OpenAPI is updated by hand and covered by `openapi.test.ts`. Public REST/MCP
exposure and its scopes belong to blocker 5 and are not decided here.

## Out of scope

### 2026-10-18 continuation: explicit acceptance of remote hard purge

Remote null canonical Memo values cannot be rebased into a recreated Memo or
Document. A captured singleton conflict can explicitly accept the purge. The
Application validates owner-derived local/remote identities and binding provenance;
IndexedDB revalidates before opening the existing strict retirement transaction.
The transaction checks identity, binding, workspace revision, exact pending command,
current row and remote base, writes the canonical tombstone, archives original
command/body evidence and retires only the captured Outbox entry. Repeated or stale
review fails atomically. No new schema, public Memo grant or silent LWW is added.
Sequential never-sent followers are accepted only as an exact captured chain:
owner/target/device, contiguous entity versions, individual command membership,
body/deletion intent and zero attempts are checked. Original and follower command
bytes remain in durable evidence. The same transaction compares every Outbox row
and follower command before retiring the chain. The UI previews the latest body
and exposes intermediate versions; it does not promise those edits will replay
after accepting a permanent purge. Previously transmitted followers remain denied.
Real IndexedDB Memo/previous deleted-knowledge17/17 PASS (overlapping prior35/35).
Binding changes after preparation fail with no metadata/Outbox changes.

Browser testing also exposed a missing error boundary: sync transport collapsed
404 to an untyped error, leaving a purged-target Memo in SENDING recovery. It now
preserves NOT_FOUND. The coordinator treats it as a reviewable conflict only for
Memo, and performs receipt lookup first. Private canonical pull and all existing
identity/CAS checks remain required for accepting deletion. This does not grant
permissions, treat every 404 as deletion, or discard an unconfirmed operation.
Latest desktop target-purge browser2PASS; mobile initially failed because the test
left its editor modal open over Account. Test now explicitly closes that editor;
all-locale rerun pending, no forced click or relaxed timeout.

Rich editing UI beyond a plain Markdown pane, memo templates, implicit memo-to-task
conversion, cross-owner memos, and memo search ranking. FINAL's explicit Atlas
actions (extract tasks, organize into or append to a Document) remain required
through Proposal/Preview/Apply; this ADR does not waive them or authorize silent
formalization.

## Verification required before this ADR becomes Accepted

Domain and Application unit tests; storage contract run against Memory, SQLite and
PostgreSQL (CAS, uniqueness, soft delete, restore, purge, workspace isolation,
Activity/Outbox atomicity); migration and backup tests; local IndexedDB
write/reload/restart; sync replay and conflict tests; host route, auth and receipt
tests; browser tests in desktop-en, desktop-zh and mobile-zh with screenshots.
