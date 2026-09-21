# ADR 0044 — Project hierarchy and URL read model

Accepted 2026-09-20. No schema or API changes.

The project overview uses nested lists, explicit disclosure buttons and existing archive/category filters. A filtered child whose parent is absent becomes a visible root with parent context. Legacy cycles are bounded and every visible project is rendered once. This is ownership hierarchy, never WorkEdge CONTAINS.

Project URLs are #projects/<encoded-id>?tab=<tab>&scope=DIRECT|SUBTREE. Unknown tab/scope falls back to brief/SUBTREE. Browser navigation restores project, tab and scope without a new router. Breadcrumbs follow projectId ancestors. A dirty brief remains mounted across tab/scope changes; leaving its project requires the existing discard confirmation, and cancellation restores the last accepted URL. Invalid/deleted project IDs fall back to project overview.

Validation: route parsing round-trip and malformed input tests; hierarchy collapse, breadcrumb, refresh, Back/Forward and scope E2E on desktop en/zh and mobile zh.
