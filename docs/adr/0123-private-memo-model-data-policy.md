# ADR0123 — Private Memo model-data policy

Status: implementation in progress, 2026-10-18.

FINAL section88 requires explicit Memo Atlas extraction, organization and append.
An owner check and a Project read permission do not grant model processing. The
existing content guard defaults absent policies to PRIVATE / LOCAL_ONLY / DENY;
there is currently no owner policy repository that could safely grant an exception.

Memo therefore carries an optional, owner-edited `aiPolicy` using the existing
classification / processing boundary / AI access contract. Absence continues to
mean deny; old stored records and immutable replay commands are not rewritten.
Ordinary body updates preserve the previous explicit policy. Only an authenticated
human metadata edit may change it; model outputs and formalization proposals may
not change policy. Policy edits use the same Memo version CAS, Activity, Outbox,
owner mapping, binding and receipt path as body edits. They are not per-call consent
that overrides a denied policy. Import into a new owner does not inherit an AI grant.

Existing SQLite/PostgreSQL Memo payloads are JSON. This optional additive field
does not require changing physical tables or rewriting historical payload/version
pairs. Validate current/fresh/upgrade/backup parity on both backends before closing
the gate; never synthesize a different canonical record at the same version.

Memo is an AI-specific source reference, not a KnowledgeLink EntityRef or Document.
Source selection and every approval/execution recheck must read the current
owner-filtered Memo through Application, validate exact identity/version/body and
the current policy, and retain target/File permissions. No background retrieval,
Project read scope, raw caller text or fake Document may grant private Memo access.
Temporary Atlas output still goes through reviewed local formalization proposals.

Required tests include absent/invalid/denied/ASK/SECRET/location policy, owner and
workspace isolation, policy revocation after proposal/approval, replay and second
installation convergence, stale source, SQL/PG round trips and private API scopes.
This ADR is not evidence that the Atlas runtime or these gates are complete.
