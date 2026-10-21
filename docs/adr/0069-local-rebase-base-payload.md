# ADR 0069 — Preserve mutation base for rebase

Status: implementation in progress; conflict/runtime acceptance pending.

A baseVersion alone cannot distinguish local and remote field changes. New local
mutations retain an optional detached basePayload alongside their intended value.
Creation records use null. Markdown mutations preserve exact original Markdown,
not an unloaded manifest, using the existing durable body/revision store.

The base, intended value, entity update and Outbox share the existing transaction.
Legacy entries without a base remain intact and cannot be silently inferred as
safe field merges. Structural, deletion and Markdown conflicts require explicit
policies and review; no last-write-wins. Base data is local user content, not a
credential and never automatically sent to an AI provider.

The additive JSON field does not rewrite historic migrations or IDs. Backup and
restore validate it as local JSON. Authenticated remote binding and server
Application validation remain mandatory; the base is not authorization proof.

## Rebase candidate and Markdown

Application computes independent business-field candidates while retaining remote
version/audit metadata. Same-field/structural/order/File-name edits and deletion
versus editing require review; missing legacy bases require review. Stable entity
identity cannot change. This pure computation does not apply or authorize data.

Document UI now re-exports the shared Application Markdown merge. It compares
base-aligned edit ranges in linear time, preserving insertion/deletion alignment
and exact Markdown. Disjoint ranges merge; overlapping or ambiguous ranges retain
both complete texts for review. Multiple separated edits on one side may produce
a conservative broad range and require review rather than silently choosing one
side. No claim of a maximal minimal-hunk merge or completed conflict UI.

Durable remote-base/ack/cursor commit, replay wiring and conflict resolution
surfaces remain open. Existing original body/revision/draft semantics are retained.
