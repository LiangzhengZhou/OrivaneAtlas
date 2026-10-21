# ADR0099 — First-class File workspace tabs

2026-10-15. FINAL Files use the same persistent Workspace Tabs surface as Documents. A FILE request is distinct from a DOCUMENT request and carries canonical File identity; it never pretends that original binary content is Markdown. Library navigation and upload open a File tab directly. The File content surface is an accessible region, not a floating Inspector/dialog.

Only the active File pane mounts parser preview, processing subscriptions and virtualized chunks. File tab metadata retains unsaved name/policy drafts while browsing or switching tabs. Closing a dirty tab requires confirmation; pending mutations prevent closing. Shared policy save still requires explicit confirmation and sends no content. Opening a linked Document activates its existing original Document tab and preserves original File bytes. Application and storage contracts remain unchanged.

Acceptance: multiple File tabs, actual inactive DOM unmount, name/policy draft restoration, canceled/confirmed close, direct single-click Library navigation, File↔Document navigation, original-byte download, processing restart and both languages/mobile. No legacy File dialog fallback.
