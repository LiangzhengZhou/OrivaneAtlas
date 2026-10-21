# ADR 0127 — Separate canonical Link replication from presentation visibility

Status: implemented, targeted verification in progress, 2026-10-19.

The populated Project File acceptance reproduced a real cursor blocker. File
soft-delete journaled a File UPSERT but incremental presentation filtering also
returned a Link removal without a Link journal row. The strict local replica
correctly rejected this unlogged effect. The restore command stayed durable and
pending, never silently overwritten. Original traces and delta JSON are retained
under session285-file-sync-stack/session285-delta artifacts.

Cookie-authenticated local replicas explicitly request relationMode=canonical on
bootstrap and incremental sync. Canonical mode returns business Link records,
including their real versioned tombstones, and never invents derived Link effects
from endpoint changes. Bootstrap/recovery preserves these independent records so
deleting and restoring an endpoint cannot lose its relationships on installation
two. The strict record/value/version/cursor validator is unchanged.

Ordinary presentation snapshots/deltas retain ADR0096 visibility filtering.
Canonical metadata does not grant access to File bytes, bodies or AI context, nor
permission to open/link deleted endpoints: existing Application endpoint checks
and workspace/account authorization remain mandatory. Bearer requests for this
replica mode are denied; duplicate/unknown values reject. No arbitrary owner or
workspace selection is introduced. OpenAPI describes both aliases.

The local presentation continues deriving endpoint availability from live local
entities; canonical relationship existence is not endpoint visibility. Graphs
must not draw dangling hidden endpoints. Project Trash actions can retain File
identity while restoring it. No schema change or synthetic business version is
needed, and no new UI feature or public token permission is introduced.

Evidence: original three-configuration failures preserved; corrected Project
upload/download/delete/restore/remote replay three-configuration browser 3/3 PASS.
Focused Host presentation/canonical parity PASS; negative and broader regression
now passed, including cookie/Bearer/query negative checks and six-file151/151
regression. Subsequent new/legacy File browser gates passed6/6. This is not full
acceptance; see HANDOFF for the current complete matrix.
