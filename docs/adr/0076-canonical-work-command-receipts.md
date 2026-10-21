# 0076 — Canonical Work command receipts for atomic local acknowledgement

Status: implementation in progress, 2026-10-13.

A business command result alone cannot acknowledge all cascading local effects.
Guarded human replay therefore returns the authenticated command/device identity,
the ordinary business result and final canonical Work/Edge effects. Canonical
effects are read within the business transaction and persisted in the existing
device-scoped request receipt. Duplicate calls return that exact receipt; they
must not replace it with newer entity values. Ordinary non-replay API responses
retain their existing shape.

Live Work versions remain Domain versions. Edges are immutable with live version
1. A deleted edge has no live version; its accepted deletion receipt uses the
declared existing version plus one and a null value as its local tombstone
revision. This is acknowledgement metadata, not a changed server edge schema or
a substitute for cursor/epoch. The older change-log deletion version must not be
used as an accepted mutation receipt. Future pull reconciliation must preserve
the receipt's tombstone when processing the matching delete delta.

Canonical receipt storage, local Outbox removal and cursor advancement remain
atomic through LocalReplicaStore. Later pending same-entity writes are retained
and cannot be overwritten by the returned canonical business row. Purge and
other command families remain unsupported until their complete effect contracts
exist. No client audit, server identity, arbitrary entity payload or database
bypass is introduced.
