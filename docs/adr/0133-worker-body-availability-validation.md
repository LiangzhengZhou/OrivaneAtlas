# ADR 0133 — Worker execution of exact body-availability validation

Date: 2026-10-21. Status: performance candidate, not acceptance.

R7 passed20 functional samples with659 unchanged hashes but only10/14 performance
budgets. Atlas CPU profiles repeatedly identify metadata message decoding and the
following canonical-manifest validation. Larger requests, native cloning and UI
priority experiments did not show sufficient benefit and are retired with evidence.

An optional read-adapter operation can execute the existing Application
remoteBodyUnavailable function in the read Worker. Application passes the exact
query-owned manifest and availability records in batches of at most32. The Worker
reads each requested canonical base in one readonly transaction, validates its
workspace, ID, version, remote identity, epoch and complete manifest fields with
that unchanged function, and returns ordered validation booleans instead of
transporting duplicate canonical manifests back to the UI thread.

This is execution placement, not a new policy or validation algorithm. Domain
and Application remain framework independent. Commands retain their existing
path. The stage only selects this operation in a read projection, checks result
length/type and still waits for final workspace revision/CAS validation. There is
no content/result cache. Only bootstrap assembles the Worker. Unsupported/failed
Worker reads fall back to exact IndexedDB reads followed by the same Application
validator; malformed responses never authorize unavailable bodies.

Required before retention: validator parity including full-field, identity and
epoch corruption, exact scope/order/missing keys, fallback, concurrent revision,
browser offline/account/body/Wiki regressions, original full20/14 performance
matrix and final complete automated acceptance. No thresholds or fixtures change.

Payload profiling found10.871MB canonical Wiki rows across5 reads, versus1.564MB
body validation responses. A second optional projection runs the same canonical
Wiki scope/object/tombstone and selected-field validation in the Worker, returning
five DocumentWikiLink fields as bounded tuples. All raw rows retain scope/object
checks before filtering; selected links retain source, target, text, alias, heading.
Stored rows are not changed. Unavailable-source IDs select the read, without a
cache. Commands/unsupported adapters retain raw reads. Main-thread tuple/type/source
guards and final revision/CAS validation remain mandatory.

The diagnostic Wiki-projection medians were27.937ms Graph,6.124ms50KB,5.898ms
100KB,17.918ms Atlas list and35.810ms Atlas open. Atlas is still over budget;
three samples are not formal acceptance. Do not impose a new source-ID count
limit: existing workspaces can exceed8192 documents, while response pages stay128.

The local resolver receives freshly constructed, exclusively query-owned link
objects, never persisted source records or cached caller objects. An explicitly
named owned-link resolver may update only targetDocumentId in that disposable
array, retaining all other fields and current complete title/alias resolution.
The existing general resolver remains copying. This removes a second5000-object
copy per workspace projection without changing relationships or ownership.
