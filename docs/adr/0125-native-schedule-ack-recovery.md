# ADR0125 — Recover native schedule acknowledgement before local presentation

Status: implementing, 2026-10-19.

A reproduced interrupted local SCHEDULED commit leaves PENDING after a native
schedule was already accepted. Restart after the deadline previously issued a
second immediate presentation. Native ACK and IndexedDB CAS cannot be atomic.

The native adapter journals an acceptance receipt, fsync before returning, keyed
by SHA256 of the entire validated platform intent (identity, workspace scope,
deadline, route, preview text, urgency). It stores no content. Reconciliation
returns matching receipts, including past-deadline probes. Application first
rechecks current target, permission/source preferences, quiet hours and privacy;
only an exact receipt can recover SCHEDULED. Unknown, duplicate or mismatched
receipt IDs/deadlines reject. Partial future acknowledgements do not advance
unacknowledged records. A reconciliation failure cannot fall through into an
immediate presentation in the same pass. No CAS or entity boundary is relaxed.

Windows records accepted entries individually after AddToSchedule, and matching
already-present OS schedules on retry. Android records acceptance after its
durable platform reconciliation; expired receipt probes are not rescheduled.
No business policy moves to Rust/Kotlin. Delivery, Reminder and NotificationRecord
remain separate. Receipts are device-local and never workspace-synced.

This does not claim exactly-once effects across the OS/file boundary: process death
between OS acceptance and receipt fsync requires replay of the stable native ID;
while a future OS schedule exists it can be observed and receipted on replay.
Actual OS delivery/click, permission changes while the application is stopped,
and physical Android validation require separate gates. Do not claim those PASS
from the deterministic Application regression. Keep process interruption evidence.
