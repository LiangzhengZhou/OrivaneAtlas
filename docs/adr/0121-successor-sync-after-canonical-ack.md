# ADR 0121 — Re-plan same-entity successors after canonical ACK

2026-10-18. Implemented; focused regression evidence, not FINAL acceptance.

## Problem

The coordinator captures one ordered plan set for a cycle. A reviewed earlier
command can commit and ACK while a later never-sent command still carries the
old canonical base. Sending that successor immediately can cause an avoidable
CAS conflict. Real Host plus two isolated IndexedDB installations reproduced
this with two local Memo edits and a concurrent remote edit. The latest local
body remained durable, but the second edit required another review unnecessarily.

## Decision

After a canonical ACK, defer later plans touching the same entity to a fresh
ordinary coordinator cycle. The existing single-flight request loop performs
the cycle; it is not a resend retry or a parallel synchronization system. The
next cycle pulls, recovers receipts and uses the existing clean rebase planner
and guarded replacement transaction. Non-overlapping entities continue normally.

Original commands, replacement identity, attempts, binding/account/workspace
checks, source version, canonical receipt and entity CAS remain authoritative.
Already-sent uncertain commands still use receipt recovery. A genuine overlapping
edit still becomes a conflict requiring review. No silent LWW, forced version,
client-side conflict relaxation or request retry is introduced.

## Evidence

Failure logs: codex-memo-sequential-host.log and
codex-memo-sequential-host-cycles.log under .artifacts/. The second log proves
that merely invoking another cycle after sending the stale successor does not
resolve the conflict. Fixed test: codex-memo-sequential-host-fixed.log, selected
Host1/1 PASS, both commands accepted without another conflict, both installations
converge to exact latest body/version6. Later codex-memo-sequential-overlap-host.log
selected Host2/2 PASS covers LOCAL clean successor rebase and REMOTE followed by
a genuine overlapping successor requiring a second review. Wider focused
sync/receipt regression codex-successor-sync-regression.log7files55/55 PASS;
current composed runtime/controller/IDB/sync42/42 PASS. These are targeted
evidence, not the second full FINAL Acceptance.
