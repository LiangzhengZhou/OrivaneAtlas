# 0077 — Detached installation-owned binding state and remote principal identity

Status: implementation in progress, 2026-10-13.

Binding input must be detached before any IndexedDB callback. The sync state CAS
also checks the installation workspace in the same transaction; a mutable caller
cannot redirect a previously validated state into another workspace. Legacy data
without installation identity retains its existing persistence contract.

An optional remotePrincipalId records the authenticated remote identity alongside
origin/workspace/epoch. Older JSON states and backups remain byte-equivalent when
the field is absent. No SQL schema or IndexedDB store/index changes are needed.
Malformed identities are rejected. Replica commits compare this identity as well
as the existing binding version/origin/workspace/epoch/cursor.

This field is not a credential and does not grant server permissions. The future
binding Application surface must explicitly confirm choices and refuse automatic
sync for legacy bindings whose remote principal has not been confirmed. Private
bootstrap auth context must match the durable binding before transport. No login
may silently replace or merge a local workspace.
