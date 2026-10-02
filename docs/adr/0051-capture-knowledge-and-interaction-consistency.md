# ADR 0051 — Capture to knowledge and consistent interactions

Accepted 2026-10-02.

Project and Document selectors share a current-level drill-down implementation.
Browsing and search never flatten descendant collections. Task membership order
retains the existing owner/reference compatibility contract.

Note promotion is one Application command under the existing atomic request
boundary. It preserves Markdown, content policy and provenance, creates an
explicit-space Document and a source relation, then optionally soft deletes the
source with version validation. Linking a Note to a Space creates only the
existing KnowledgeLink. No implicit Space creation is permitted.

Note/Journal Wiki references are derived from authoritative Markdown and the same
Wiki parser and alias resolver as Documents. They require no new persistence
model: refresh/reconciliation recomputes references, including rename, deletion,
and restoration. The original Markdown remains the source of truth.

Atlas exposes conversations; provider configuration and execution activity live
in Settings. Browser event streaming retains authenticated access and transient
event semantics, with polling as a compatibility fallback.
