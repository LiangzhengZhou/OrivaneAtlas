# Local v3 migration implementation record

This records implemented migration boundaries and executed evidence. It is not
release/deployment authorization or a claim that all FINAL v3 schema work is done.

## Current sources

SQLite migrations are append-only through 0037; PostgreSQL through 0032. Their
numbers differ because historical backend migrations are independent. Behavioral
parity is tested through Application ports, not by comparing migration numbers.
The local IndexedDB schema is version 4; local archive format is version 2 and
installation identity format is version 1. Existing migrations are preserved.

Current local changes include manual ordering, formal Files metadata/original-byte
completion and device-scoped mutation receipts. SQLite already had ConnectedStore
tables; PostgreSQL 0032 adds the missing AgentRun and connected Activity/Outbox
tables and transaction adapter. It preserves existing knowledge_link rows and
their durable WorkspaceChange trigger. New tables remain workspace scoped.

## Upgrade and recovery

Use the existing backend migration runner and backup gate. Do not change applied
checksums, manually advance schema versions, reinterpret one backend's database
as another, or overwrite an existing local workspace with a restore.

The PostgreSQL 0032 test starts a real isolated v31 cluster, inserts a historical
knowledge link, takes a physical backup, upgrades through the current runner,
checks schema and exact old payload preservation, and restores the v31 backup
into a separate cluster. Version-gated integrity checks accept the historical
schema without demanding newly introduced tables. The upgraded source remains
intact. Session199 upgrade/restore group passed 4 tests in 94.66s.

Shared SQLite/PostgreSQL tests check complete/incomplete original replay effects,
stable identity, deleted-ID reuse rejection, authenticated workspace scope and
transaction rollback of business changes and Activity/Outbox. Note promotion
retains exact Markdown, provenance and AI policy and rolls back document, link
and optional source deletion together. Session199 promotion parity group passed
4 tests in 30.37s.

Local archive restore creates a new installation/device identity while preserving
the original pending mutation IDs and their original device provenance. Secret
vault data is excluded. IndexedDB upgrade/backup/crash/restart behavior is covered
by real browser tests; session199 expanded local browser group passed 78 tests.

## Remaining FINAL gates

Files extraction/relationships/background binary sync and NotificationRecord/local
scheduler requirements remain open. Their eventual schema changes require new
migrations and fresh/upgrade/parity/restore checks. Explicit first binding and
conflict/merge review UX remain open; current safeguards do not authorize silent
merge or last-write-wins. No production migration has been run during this work.
