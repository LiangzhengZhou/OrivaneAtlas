# ADR 0056 — Feature view state and metadata bootstrap

Accepted 2026-10-05 for the authorized v2.3 implementation scope.

Feature query, presentation, selection and scroll preferences survive navigation
in a keyed view cache. Graph route updates cannot reset Task or Document state.
URL routes describe navigation and shareable graph state; synthetic hash events
are not a state transport. Selection and opening are distinct actions, with one
Context Pane switching between entity details and Atlas.

Initial WorkspaceBootstrap contains authorized entity metadata and the durable
change cursor, never the full document/note Markdown corpus. Bodies hydrate on
opening through application contracts. Metadata must explicitly distinguish an
unloaded body from an empty body, and caches must include server, workspace,
principal, entity and version. An unloaded body cannot be submitted as a draft,
used to replace content, or used to approve AI context. Server retrieval reads
authoritative content and retains existing permission/version checks.

HTTP JSON negotiates Brotli/gzip without buffering SSE or double compression.
Native JSON uses text/structured IPC; only binary data uses Base64. This changes
transport representation, not origin, path, cookie or request-generation guards.
Clean Wiki indexes survive restart; a persistent version/dirty marker controls
rebuild and must recover safely from an interrupted rebuild. Any persistent
marker change requires append-only SQLite/PostgreSQL migrations and restore tests.

These decisions define implementation boundaries, not completed acceptance.
Publication metadata remains at the accepted v2.2 release during local work.
