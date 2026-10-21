# ADR0102 — Contextual editor proposals and reviewed transactions

2026-10-15. FINAL contextual Atlas is a nonmodal editor surface, distinct from Full Atlas. Cursor/selection updates only the local preview; toolbar, slash and Cmd/Ctrl+J open that surface. Explicit preparation uses the existing owner session, canonical source policy and separate approval. No provider request is caused by editor selection changes.

Application owns temporary EditorProposal identity, workspace, canonical version, source range/text/hash and bounded replacement validation. UI retains the captured CodeMirror Text object and checks it again after asynchronous Application review. Any document edit invalidates the proposal; selection-only movement does not. Acceptance dispatches an ordinary CodeMirror input transaction and keeps undo/redo. It never replaces React body state directly.

The Host's optional REPLACEMENT response contract is limited to one explicitly selected source and no durable conversation. It changes response instructions, not permissions, trust, routing or approval. Existing JSON edit proposals keep their contract. Whole-document/context policy remains visible in the approval review. Temporary editor sessions, continued collaboration, Save as Conversation, bounded selection transport and full workflows still require their acceptance coverage; this decision is not completion evidence.
