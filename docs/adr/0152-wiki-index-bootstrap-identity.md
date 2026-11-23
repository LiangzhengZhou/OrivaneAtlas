# ADR 0152 · Preserve persisted Wiki index identities in replica bootstrap

Accepted 2026-11-24 for local implementation. A connected graph fixture with 1,000 documents could be previewed but its first account replica could not activate. The workspace bootstrap sent the five display fields of each Wiki occurrence. The replica transaction requires the stored ID, workspace and version that subsequent change-log records reference.

The authenticated bootstrap reads those three fields from the existing workspace-scoped index in the same transaction as the rest of the manifest. Ordinary graph reads retain their existing display projection. Repeated references and unresolved targets keep their own persisted IDs. The client continues to reject incomplete records before committing or advancing its cursor. No synthetic identity, Markdown rewrite, schema migration or additional permission is required.

The server can be updated first. Older clients consuming this bootstrap already expect canonical records. Older servers sending presentation-only occurrences require a host update before first activation of affected replicas. Verify the full manifest against the incremental records for the same occurrences and open a real populated account replica. Test both SQLite and PostgreSQL stores. Desktop/mobile UI and data rollback evidence remain in the upgrade ledger.
