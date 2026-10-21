# 0075 — Guard ordinary Work replay with declared original effects

Status: implementation in progress, 2026-10-13.

A logical project command may update several tasks. Replaying each stored entity
diff would repeat Application policies; replaying just the original command
without checking its effect set could instead move a newly created remote task.

The Application UnitOfWork decorator validates original entity versions and
intercepts ordinary Work/Edge writes. Unexpected, missing or stale declared
effects fail inside the same transaction, rolling back the command and events.
Per-entity ordered effects permit repeated writes without depending on global
repository enumeration order. Server-owned authorization and Domain rules still
execute in WorkService. Input is detached before asynchronous reads.

This foundation is not a public replay API or authorization mechanism. Command
envelope validation, actor-derived scope, receipts, canonical results and local
coordinator wiring are separate required work. Purge has repository-owned related
effects and Workflow changes; it must not be admitted to this narrow guard until
all those effects can be declared and verified. Calendar, navigation, Files and
other families also require their own complete effect contracts.
