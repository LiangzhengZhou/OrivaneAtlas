# ADR 0131 — Reuse collection reads within one staged transaction

Status: accepted, implementation and acceptance in progress (Session289).

Profiling the 2,000 Document fixture shows repeated full collection reads and
metadata preparation during one workspace snapshot. LocalMutationTransaction may
share the in-flight durable list read for each collection within that transaction.
Each caller still receives a detached result with the latest staged writes and
internal records overlaid. No cache survives the stage or crosses actor/workspace.

The initial workspace revision and final read validation / atomic write CAS remain
mandatory. A concurrent durable change invalidates the entire stage as before;
bounded restart remains the existing caller responsibility. This is not permission
decision caching, snapshot publication before validation, or version substitution.
Failed stages publish no results or Outbox command. Tests must retain read-your-
writes, caller isolation and real two-connection invalidation behavior.

An experimental getMany / dense-range path passed correctness checks but worsened
typing latency by concentrating projection work into long tasks. It was removed
before acceptance; its implementation, tests and measurements are retained in
Session289 artifacts. The existing adapter getMany remains unchanged. Wiki
projection now bounds independent canonical-body validations to four concurrent
reads, validates every entry, and preserves final snapshot validation. This
changes scheduling, not the dataset, validation work or rendering quality.

Further measurement retained the original adapter and replaced individual base
reads with small batches of 32 through its existing getMany capability. Stage
getMany validates exact returned scope/identity/count, overlays pending records,
and returns detached values. Each batch finishes its readonly transaction before
the next validation burst; no entire-graph batch or dense-range optimization is
used. Foreign results and invalidated final snapshots still reject.

UI notification derivation separately reuses its pure input projection when
server/account/workspace, entity CAS versions and calendar timezone are identical.
File extraction/index status are included separately because these derived fields
can change without a File version increment. This cache contains no authorization
result. Outbox attention is checked independently for every workspace snapshot;
changes to its identity/state/timestamps still trigger reconciliation. Time/focus
wakes and system delivery preference changes remain triggers. Cleaned-up effects
stop before starting further ingest/reconcile/delivery phases, while an already
entered recovery operation completes normally. Existing service-level preferences,
permission, dedupe and receipt checks remain mandatory.

The workspace snapshot may borrow stage-owned list values only within its
read projection. Business writes are forbidden in that mode; the only permitted
internal staging is the existing derived Wiki source repair. The enclosing Work
unit still detaches the complete result before awaiting commit, and validates the
same workspace revision before publishing it. Ordinary commands retain detached
per-call reads. This removes an intermediate full copy without allowing a borrowed
reference to escape, disabling CAS, or publishing an invalidated snapshot.

UI duplicate refreshes may skip reconstruction only after reading the actual
durable workspace revision and finding it equal to the revision of the last
successfully published snapshot in this server/owner/workspace scope. A loader
instance belongs to one runtime identity. It reads revision before and after a
full load; failed, unpublished or concurrently changed reads do not establish a
cached revision. No snapshot object or permission result is stored in this gate.
All snapshot inputs are versioned local business records; independent File index
and notification stores keep their dedicated subscriptions. Outbox attention has
its own refresh tick even when the business snapshot reconstruction is skipped.
Broadcast hints do not supply authoritative revisions. Ordinary reads, commits,
receipt handling and server authorization remain unchanged.

Session290 experimentally copied large snapshot arrays in bounded chunks,
yielding between chunks and fields. The formal20-sample result did not establish
an overall benefit, so that final-copy scheduling experiment was retired with
source/tests preserved in artifacts. Complete synchronous result detachment and
final workspace revision validation remain in use for all operations.

The same read-projection borrowing boundary covers getMany results used only for
canonical body availability validation. Adapter results are already detached;
scope/count/identity checks and staged overrides precede borrowing. Normal
command getMany still clones every result. No borrowed projection value escapes
the final result copy and revision check.

IndexedDB collection list reads use bounded primary-key getAll pages in one
readonly transaction. Each success handler queues the next page before returning,
so the transaction remains active and consistent while browser tasks can run
between request completions. The complete collection is returned in the original
primary-key order. No record filtering, schema change, separate-transaction
pagination or weakened final revision validation is introduced. Environments
without IDBKeyRange retain the existing collection-index getAll fallback.

Notification UI refresh derives visible rows and unread count from one service
view rather than two separate durable scans. Overlapping invalidations coalesce
into a serialized refresh plus a requested follow-up. Runtime service identity
is checked before reading and publishing so a previous account's pending refresh
cannot publish into a new scope. Notification policy, visibility, delivery,
receipt recovery and independent attention invalidations remain unchanged.

Notification subscriptions no longer treat every business change as a notification
record invalidation. Specialized notification commits retain their own broadcast;
generic business/replica commits additionally emit that broadcast when they actually
include notification records or preferences. Business snapshots and Outbox attention
still receive ordinary changes. Two-connection tests cover both no extra wake for
an unrelated Task and a required wake for an atomic Task plus notification update.
Notification collection reads share the same single-transaction bounded paging.

Profiling after the scheduling experiment still attributes18.7ms of an Atlas-open
sample to complete snapshot copying. IndexedDB metadata reads already return
independently detached values. An optional detachedReads capability declares that
ownership contract; adapters without it retain existing complete result copying.
A read projection with that capability and no staged business writes may
transfer its owned result instead of copying it again. Its only permitted
internal writes remain derived Wiki sources, which stageInternal independently
copies and IndexedDB copies on commit. Wiki link output objects are separately
constructed. Results stay private until the unchanged final revision/repair CAS
commit succeeds. Ordinary commands and other adapters still copy. Tests prove mutation after two reads
does not cross either result or durable storage, and invalidated reads still fail.

Debugger timing identified the remaining repair case: a100KB save led to one
Wiki source repair, and the conservative internal-write guard copied the entire
snapshot in20.2ms. That extra copy is unnecessary under the ownership boundary
above. Real IndexedDB repair-result mutation tests must keep persisted Wiki syntax,
subsequent snapshots and exact original Markdown unchanged.

A background-priority list/getMany scheduling experiment retained every read,
transaction completion and revision check but did not establish a performance
benefit in its complete diagnostic cohort. It was retired, with source/tests in
artifacts. The metadata read port and scheduling remain unchanged.

A new bounded alternative to the retired whole-range experiment is limited to
8–32 distinct remoteBase keys. Within one readonly transaction, first read at
most33 primary keys and require an exact requested-key set. Only then read the
corresponding values in one bounded getAll; any sparse/missing/extra key falls
back to the original per-key requests in that same transaction. No unrequested
body value is materialized by the density probe. Duplicate, mixed-collection and
larger calls retain the original path. All scope/order/detachment/final revision
checks remain; tests and new profiling must establish correctness and benefit.

The UI may preserve references for Work items, edges and organization only after complete
value equality with the freshly authorized, revision-validated result. This is
structural sharing in UI state, not a read or authorization cache. Compare full
values, including same-version canonical corrections and derived File status;
changed order, removed fields, identity or content must publish the new value.
No version-only shortcut is used, since optimistic status and canonical metadata
can differ while retaining an entity version. Notes, Library, Files and the
snapshot root retain fresh references so body availability/retry subscriptions
continue to observe every newly loaded snapshot even when manifests are equal.

Readonly workspace queries may return the existing revision actually validated
by their final commit. A no-write query reports its validated starting revision;
a Wiki repair reports the next revision after the repair CAS succeeds. Failed
queries expose no stamp. A versioned query is an internal Application contract,
not a new durable counter, schema, HTTP API or permission capability.
The UI still rereads the actual durable revision before/after loading. It can
pin a successfully published result only when that final value equals the query's
validated stamp, including its own repair. A later concurrent revision forbids
pinning. This removes a duplicate full read caused by the query's own invalidation
hint without trusting broadcasts or weakening any CAS or validation step.

The note-backlink query also uses the read-projection boundary: it authorizes
the target, reads current local note bodies and document metadata, and constructs
fresh reference objects. It performs no writes. Its results await the same final
revision validation and bounded read-conflict recovery as workspace snapshots.
This avoids copying the entire document metadata collection in a read-only query.

A two-concurrent-batch experiment retained every validation but did not improve
the complete formal cohort. It is retired with source preserved in artifacts;
body-availability validation returns to sequential batches. JSON equality
retains full recursive value and field-count checks while using one left-key
array and loops instead of duplicate key arrays and per-object callback closures.

Within a single read-projection unit, Library metadata decoding and sorting may
share one promise between snapshot and Wiki readers. The instance belongs only
to that unit; queries cannot modify Library records, and Wiki repair touches only
its internal index. Ordinary command units retain fresh list derivation after
each write. No promise or metadata crosses query, actor or workspace boundaries.

The128-key/32-value-pages experiment passed correctness but did not improve its
complete three-sample diagnostic cohort. It is retired with source/tests preserved
in artifacts. The original32-key limit and Application batch size are restored;
the128-key case remains a fallback correctness regression.

Note backlinks may return no local references after target authorization and
all local note captures are empty. No Library target-resolution read is needed
when no source Markdown exists. Remote reconciliation still executes in bootstrap.
The UI helper similarly avoids resolution for no loaded active notes and builds
one active-parent ID set instead of scanning Library for each document.

While a document covers the retained Graph route, the route may defer incoming
snapshot props, following the existing inactive-document policy. Graph state is
not destroyed. Reactivation must receive the latest snapshot and current route;
saved Wiki edits must then update actual visible neighbors. This is UI rendering
deferral only and cannot bypass queries, authorization or durable validation.

Accepted Atlas conversation-route changes use the existing local view-store
pattern from Calendar. The shell still performs draft/navigation guards first;
only accepted routes publish to the Atlas child. Internal conversation selection
does not rebuild the entire App or reset unrelated Project route state. Full
navigation, document visibility, browser history and account scoping remain intact.

Atlas summary loading is independent of selected-session body loading. Summaries
refresh on runtime/scope changes, explicit reload and existing mutation paths;
selection still checks the current accessible summary set and reads the requested
page through the original server-authorized contract. Scope changes clear readiness
and cancel prior publication. Selecting another session need not refetch all100
summaries or invalidate the unchanged virtualized conversation list.

Background-event snapshot publication may use React transition priority after
the same durable read and revision/CAS validation. Explicit refresh and command
refresh remain immediate. The scope/generation guards still precede publication;
no snapshot data is discarded, cached across scopes or substituted for command
authorization. Rendering can yield to input/navigation while applying background
invalidations. The virtual conversation scroll container also isolates its layout
from the surrounding workspace; dimensions/content and row measurement stay intact.

R7 did not show a justified complete-cohort benefit for transition priority,
conversation layout containment or empty-profile state reuse. Those three
Session290 experiments are retired with source backups and all measurements;
the pre-experiment UI behavior is restored. They are not retained optimizations.
