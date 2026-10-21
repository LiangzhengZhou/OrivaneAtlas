# 0081 — Guarded Work sync coordinator

Status: Work-only implementation in progress, 2026-10-13.

Application serializes/coalesces requested rounds. A confirmed scoped binding is
required. Each round pulls canonical Work deltas, reconciles attempted receipts,
claims complete ready commands durably, sends the original intent with original
command/device IDs, commits accepted values and ACK atomically, then pulls again.
Complete uncertain commands can resend the same request only after receipt lookup;
partial, legacy and unsupported groups remain unresolved. Authentication/transport
failures retain the sending attempt. Epoch or scope changes stop the round.

A server version conflict first checks for a racing committed receipt. Otherwise
the exact sending group becomes CONFLICT with original versions/content intact;
there is no last-write-wins or silent intent rewriting. Full rebase proposals and
conflict review remain open. Results identify accepted/conflicted/unresolved groups
rather than claiming that all data synchronized.

Bootstrap supplies its private scoped Cookie/native UTF-8 transport and original
Idempotency-Key. Coordinator instances are tied to server generation. Login alone
does not enable sync or merge workspaces. Native endpoint policy adds only explicit
Work/sync v1 aliases and receipt GET; auth/account paths retain exact matching and
session side effects. Domain rules remain in Application, never duplicated in Rust.

Real isolated Host/IndexedDB browser tests cover coalescing, durable original intent,
reply loss after a real commit, close/reopen, receipt recovery without another send,
and real conflicting remote edits without overriding either side. Work-only
projection is not full Phase11 acceptance: other command families/collections,
binding choices, epoch recovery, conflict UI and binary sync remain open.
