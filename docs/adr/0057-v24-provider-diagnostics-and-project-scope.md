# ADR 0057 — Provider diagnostics and explicit project dependency scope

Accepted 2026-10-07 for the authorized local v2.4 implementation.

Provider HTTP transports preserve adapter method, headers, path and body through
the existing trusted endpoint and pinned DNS boundary. Public failures carry
allowlisted classifications, status and retryability; upstream text, headers and
credentials never become diagnostics. Connection validation and model discovery
are separate operations. Unsupported discovery is not evidence of failed auth.
The encrypted host vault, workspace authorization and approval paths remain the
only paths to model execution.

Project dependency membership defaults to DIRECT_PROJECT, using task.projectIds.
PROJECT_TREE is an explicit presentation scope including descendant projects.
External blockers are graph boundary nodes, not scope members or focus choices.
No ownership or persistent entity semantics change. Scope is part of graph view
state and URL restoration, without resetting unrelated feature state.

Application icon derivatives preserve canonical alpha by default. Android
adaptive backgrounds are independent, explicit platform resources. Sidebar brand
assets remain byte-identical. Release metadata remains 2.3.0 during local work.

This decision records boundaries, not completed acceptance. No publication or
production operations are authorized by this document.
