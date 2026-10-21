# ADR0124 — Granular credential grants and shared capability requirements

Status: implemented; targeted validation recorded in session283, 2026-10-18.

FINAL sections11–14 and Agent Phases22–23 require one capability contract for
internal Atlas, REST, MCP and reviewed proposals. Existing account tokens retain
their identities, hashes, principal, expiry and revocation state. Legacy `write`
and `read-write` remain explicit compatibility profiles; they must not become a
wildcard for newly introduced routes or private Memo access.

New credentials carry an explicit nonempty set of validated granular grants.
Read, write, execution, File content and proposal grants are independent. A File
metadata read does not authorize original bytes or extraction excerpts. A proposal
grant does not authorize publication. Capability execution requires the contract's
entity/action grants plus execution authority; human approval, source policy,
workspace/account isolation, CAS and Application rules remain mandatory.

CapabilityDefinition owns required grants. REST route requirements and MCP tool
metadata must be checked against that contract. Unknown routes/capabilities/grants
deny. Request authorization and the transaction-time credential recheck both use
the current credential; a pre-body authorization result is not sufficient.
Cookie sessions retain CSRF and account/workspace checks; bearer tokens cannot
use private human Memo, provider credentials or human-only approval endpoints.

Persist new grants append-only, preserving old token records without broadening
their historical route allowlist. Only backends actually storing account tokens
need token DDL; PostgreSQL business data parity remains part of final validation.
Tests must prove independent positive/negative grants, rollback/restart/revocation,
legacy compatibility, no Memo leakage, REST/MCP/proposal parity and no DB bypass.
Durable `NULL` grants identify a historical compatibility profile. Explicit JSON
arrays are validated as nonempty at issue and read; malformed/empty arrays never
fall back. Legacy identities, hashes, expiry and revocation are unchanged. The
unreleased SQLite42 migration adds nullable grants without converting legacy tokens.
PostgreSQL37 is a compatibility marker only: the business backend has no account
or credential table, so token DDL there would break fresh startup. Actual grant
persistence/backup/restart coverage belongs to the SQLite AccountStore. PG37 fresh,
upgrade and physical pre-upgrade restore are tested independently.

`granularRouteGrants` and `API_GRANTS_MATRIX.md` document normalized REST routes.
MCP additionally checks the shared capability's required grants, then repeats the
same checks through the current AccountStore before receipt lookup. A credential
cannot switch between legacy and granular mode during a request. Aggregate reads
require the constituent entity read grants. File metadata and content remain
independent. Human-only Atlas/Proposal approval, Apply and private Memo paths stay
human-only even with all scopes; scopes never substitute for human approval.

This decision does not claim full release acceptance. Android physical gates and
the full second FINAL matrix remain separate from these API targeted results.
