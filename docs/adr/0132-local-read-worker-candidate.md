# ADR 0132 — Local metadata read worker candidate

Date: 2026-10-20. Status: proposed performance experiment; not acceptance.

CPU profiles show IndexedDB collection value materialization on the editor thread
overlapping typing and Atlas navigation. Exact local data and final revision/CAS
validation must remain intact. No benchmark thresholds or rendering work changes.

An optional infrastructure reader may run readonly collection and bounded base
reads in a dedicated module Worker. Only bootstrap selects this adapter. It opens
the already migrated database without creating or upgrading it, scopes every key
by database/workspace/collection, and waits for each readonly transaction to finish.
Collection pages remain bounded; exact-key base reads never read unrelated bodies.

The worker returns complete JSON strings, whose parsing creates an independently
owned result on the UI thread. LocalJson excludes binary, dates, non-finite numbers
and undefined. Reads containing negative zero use the original structured-clone
message payload so JSON serialization cannot normalize that numeric value.
CRLF, Unicode, fields and ordering must remain exact. No result or
authorization cache is introduced. Application authorization, full value checks,
read-conflict handling and final revision/repair CAS continue unchanged.

Collection responses stream at most128 records per message so the UI never parses
a complete large collection in one callback. Pages remain private in the pending
request until a separate transaction-complete message. Worker errors discard all
partial pages. Wiki preparation may yield once through an optional infrastructure
callback before the unchanged complete alias resolution, separating two CPU bursts
without removing links or bypassing the final revision check.

Where the browser Scheduler API exists, metadata response parsing and verification
continuations run in FIFO background-priority tasks. Input and foreground UI tasks
can run first. Every page and final completion remains mandatory; the original
timeout and authoritative fallback are unchanged. Browsers without the API execute
the same response handler directly. Scheduler failure rejects pending reads and
falls back to the original IndexedDB path, never publishing incomplete pages.

Unsupported/failed workers use the existing IndexedDB reader. The client disables
a failed worker, rejects its pending requests and terminates it; database adapter
close also terminates it. Worker database version changes close its connection.
There are no network requests, credentials, schema changes or new durable counters.

Bootstrap selects background deferral while a text input, textarea or editable
element owns focus. Other navigation uses the direct handler to avoid adding
unnecessary scheduler tasks. This UI policy is injected into the infrastructure
reader; Domain/Application have no DOM dependency. Empty collections send only
the required final-completion message, rather than an additional empty page.
Once messages are queued, later completion messages stay in that same FIFO queue
even if focus changes. A completion cannot overtake deferred data pages.

Required evidence before retention: real IndexedDB transaction/isolation and exact
JSON tests, failed/unsupported worker fallback, browser offline/account/File/Memo/
sync regression, unchanged production benchmark and full quality/acceptance gates.
Retire the experiment with evidence if it does not show a justified benefit.

R6 retained the original input budgets but failed Atlas list/open. A bounded
Worker-only candidate advertises128 exact keys per read to read projections.
Application commands and adapters without that capability keep32. Each key is
still read and checked individually in one readonly transaction, with identical
ordering, duplicates, missing values, scope validation and final revision CAS.
The fallback remains authoritative IndexedDB; no range body scan or cache is added.
This differs from the retired main-thread128-key range experiment: decoding and
individual requests run in the Worker and only bounded results cross the port.

The Worker128 candidate passed27 correctness tests but its complete three-sample
diagnostic did not improve Atlas or Graph. It is retired with all seven source
copies and measurements in session290-retired-worker-batch-* / worker-batch-*.
The original32 bound is restored. Extended exact-read/fallback/scope regressions
remain, without the rejected capability.

The restored32-key profile measured11.167ms self CPU in response processing
during Atlas open. A separate native structured-clone transport candidate sends
the same bounded row arrays directly, avoiding Worker JSON.stringify and UI
JSON.parse. Browser cloning retains isolated ownership, negative zero and exact
text without a content cache. Pages, FIFO, scope validation, transaction completion,
fallback and final revision CAS are unchanged. This requires new measurements.

The native-clone diagnostic passed3 functional samples but did not improve Atlas
or100KB; its codec source and samples are preserved and original JSON encoding
is restored. The next candidate separates request batching from response paging:
read-projection adapters can advertise up to8192 exact remoteBase keys in one
Worker readonly transaction, while emitting at most32 results per message. No
unrequested rows or bodies are read. Final completion follows the transaction;
failed transactions discard partial pages. Commands and other adapters keep32.
This removes sequential per32 RPC/transaction setup without creating large UI
parse callbacks. All exact-key scope/order/duplicate/missing and final CAS checks
remain mandatory; it is an experiment until measured.

The single-transaction candidate passed31 correctness checks and3 browser
functional samples but increased50KB typing and did not improve Atlas. Its seven
source files and measurements are preserved in session290-retired-worker-rpc-*
and worker-rpc-*. Original32 RPC behavior is restored. Neither rejected transport
candidate is retained as a performance solution.
