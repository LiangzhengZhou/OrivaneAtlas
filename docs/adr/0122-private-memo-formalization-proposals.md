# ADR0122 — Explicit private Memo formalization

Status: implementation in progress, 2026-10-18. FINAL section88 requires explicit
Atlas extraction, organization and append through Proposal/Preview/Apply.

Memo remains private and independent of Document. No Project/File read scope
grants Memo access, and no background retrieval includes Memo bodies. Sending
Memo text to a model must be a separate explicit user action with a captured
source, not a side effect of selection, editing or opening the scratchpad.

Formalization proposals capture owner/workspace, Memo identity/target/version and
a hash of the exact Markdown. Proposed text is data, never executable commands.
Application reviews the current source again before any formal mutation.
Task creation, new Document and append to an existing Document use their existing
Application services, destination authorization and CAS. Append also captures the
destination version. Source verification and formal mutation must share the local
durable transaction; Activity/Outbox retain the ordinary supported command.

One proposal applies one explicit formal mutation. Several extracted actions are
reviewed individually; no implicit bulk mutation or parallel Memo/Document identity
is introduced. Source Memo is retained unchanged. The UI shows preview and an
explicit Apply, and rejects a stale source or destination rather than rebasing it.

Each proposal allocates a stable UUID through an Application ID port. Task and
Document creation reuse that ID via the ordinary stable-create services, so a
second Apply fails CAS without duplicating entities or Activity/Outbox. Append
continues to use the captured destination version. Application and real IndexedDB
tests cover duplicate Apply, invalid destination rollback, stale source/append,
exact source retention and reload. These tests do not claim Atlas UI wiring.

Required verification: owner/workspace isolation, exact source/version/hash,
unknown actions/fields, limits, stale destination, permission recheck, rollback,
offline durable apply, ordinary replay and browser preview/apply. This ADR does not
claim those gates have passed or waive explicit model-data permission.

Local UI evidence: Task/new Document/append require Preview/Apply, work offline,
retain source and reload exact durable bodies: three locales3/3 PASS in
codex-memo-document-durable-browser.log. Compact dialog3/3 and actual mobile
screenshot inspected. Atlas runtime integration remains open.
