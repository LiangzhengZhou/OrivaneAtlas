# 0084 — Durable remote Markdown body availability

Status: next implementation contract, 2026-10-13.

Metadata-first knowledge deltas must not download every Markdown body. A canonical
remote manifest can legitimately arrive before its body, while a locally created
or previously hydrated body disappearing is corruption. Existing UNLOADED bootstrap
presentation alone cannot distinguish those cases: local cached manifests also use
that value.

Persist an internal version-scoped availability record with each accepted remote
manifest. Its ownership is paired with the Note/Library record in the strict replica
transaction; provenance identifies the confirmed origin/workspace/principal/epoch
and exact canonical entity version. MISSING means this canonical body was not
downloaded; AVAILABLE means durable verified body exists. A missing body without
the matching explicit remote MISSING record remains LOCAL_DATA_CORRUPT.

Read unavailable content as an explicit unavailable state/error, never empty
Markdown. Editing requires a verified body. Local saves continue to require their
old authoritative body and retain existing revisions. Restart and backup preserve
availability. A new remote manifest must not overwrite later pending local edits.

Lazy hydration is an authenticated exact-version read. Before and after IO, pin
origin/account/workspace/generation; verify ID, kind, version and canonical metadata.
Commit body, revision, search, Wiki source and AVAILABLE with the same entity and
binding/revision CAS. A newer manifest/pending edit/scope change rejects the stale
hydration. No new user Outbox, full snapshot, cursor advance or implicit sync bind.

Knowledge search indexes only verified hydrated bodies. Wiki startup does not
hydrate all bodies and does not run unconditional rebuild: explicit unavailable
versions have no authoritative source links until hydrated. Earlier valid body/
revision data is preserved rather than erased merely because new content is not
downloaded yet. Full-body receipts use the same paired projection contract.

Acceptance: metadata bytes independent of total body size; unavailable vs corrupt;
offline read feedback; restart/backup; version/identity race; later pending edit;
strict atomic body/index/provenance commit; no Outbox/cursor manufacture; real Host
metadata delta and hydration plus SQLite/PostgreSQL parity.
