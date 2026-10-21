# ADR 0063 — Durable installation identity

Status: implemented and verified in browser product bootstrap and isolated Windows restart; Android runtime acceptance pending.

The local workspace, owner principal and device use independent stable UUIDs.
These identify locally owned data and mutation envelopes. They are not server
credentials, account identities or an authorization proof for remote replay.
Login must not replace them or silently merge data into an existing workspace.

Append IndexedDB metadata schema v2 with a separate identity store. Schema v1
entity, outbox and sync records remain untouched; the separate Blob database
keeps its existing schema. Concurrent first launches choose the identity in one
strict read-write transaction and return the same winner only after completion.
Corrupt identities are rejected without generating replacements or deleting data.

The identity is bootstrap metadata, not a business mutation and not a synthetic
Outbox entry. Workspace binding remains explicit in the existing sync-state
port. Product assembly belongs exclusively to web bootstrap; business services
continue to use the Application contracts verified in ADR0062.

Fresh creation, concurrent initialization, v1 upgrade, synthetic backup/restore,
corruption rejection and native restart require execution before acceptance.

Browser production tests and IndexedDB upgrade tests now execute these paths;
the isolated Windows probe verifies stable identity after forced process exit.
Remote account tests additionally prove local Markdown remains intact through
login, switch, logout and credential removal. The local context getter always
returns local identity; assigning a foreign actor is rejected. Login never makes
that assignment. IndexedDB backend v3 adds search projections without changing
the identity record or archive record format. Explicit binding, authenticated
replay and Android physical-runtime validation remain separate open gates.
