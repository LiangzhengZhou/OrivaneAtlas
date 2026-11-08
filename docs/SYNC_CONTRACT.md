# Local-first sync contract

Status: 2026-11-06. This is the working contract for write commands.

## Command lifecycle

1. The local runtime writes the replica and records one command intent.
2. The command has stable commandId/deviceId and a list of mutation effects.
3. Replay sends the command once with an idempotency key.
4. The Host returns a receipt and canonical accepted effects.
5. The local runtime validates canonical values and marks effects ACKed.
6. A failed/incomplete command remains retryable; a permanent rejection is
   surfaced as a conflict/failure, never silently discarded.

## Effect rules

- Every changed collection/entity that the Host will see must appear in the
  effects list.
- Effect base versions are the local pre-write versions; CREATE uses 0.
- A command must not claim an effect it did not write.
- A command must not write an effect it did not claim.
- Body-bearing collections follow the body/remote-base availability rules;
  a body-unavailable note may use the explicit compatibility fallback.

## Conflict rules

- Version mismatch -> VERSION_CONFLICT, command remains unresolved.
- Missing target -> NOT_FOUND, command fails permanently.
- Authorization failure -> FORBIDDEN, command fails permanently.
- Duplicate replay -> return the original receipt, do not duplicate effects.
- Reachability failures/timeouts -> retry, never convert to success.

## Validation rules

- External HTTP/replay input is validated at the Application boundary.
- Canonical work/library/note values are validated before ACK.
- Migration and schema versions are checked before startup.
- New migration steps are additive; destructive cleanup needs a separate
  migration and backup/rollback evidence.

## Current gaps

- Project archive/recovery uses one work.update command with exact items/library/files/projectMaterials effects. Missing or extra effects roll back the whole transaction; cached Markdown is required offline.
- Some LOCAL-ONLY link paths are documented in OFFLINE_CAPABILITY_MATRIX.
- A single generated command/effect schema is not yet the source of truth.
