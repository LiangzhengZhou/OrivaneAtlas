# 0073 — Preserve logical Work commands beside durable effects

Status: implementation in progress, 2026-10-13.

A Project completion or reparent operation can change multiple entities. Replaying
each entity as another business command would run Application effects twice and
lose the original completion resolution. Do not infer that resolution from a
later collection of entity diffs or implement Domain logic in an adapter.

Product LocalRuntime Work operations capture a detached original command input.
After the existing Application service completes, the staged transaction records
one `$local.command` with its stable first mutation ID and the ordered effect IDs.
Each effect references that command ID. The command, effects, activity and Outbox
share the existing durable commit. Generated entity/edge IDs are preserved by the
effects. No new database store or backup format is required.

Command records survive individual receipt removal, avoiding orphaned group
references. Future acknowledged-group retention/GC and authenticated replay must
use these references; a command record is neither authorization nor proof of
server acceptance. Old entries remain intact and require explicit reconciliation.

This step captures Work create/update/delete/purge/edge/settings intent only.
Other runtime families and server replay/group acknowledgements remain open.
Do not advertise a complete coordinator or silently replay legacy entity diffs.
