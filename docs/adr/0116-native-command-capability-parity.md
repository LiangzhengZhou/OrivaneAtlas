# ADR 0116 — Native command registration and local capability parity

Accepted 2026-10-16 as FINAL acceptance correctness fix A010.

The existing native handler registry includes raw File upload/download and four
notification commands, but the application ACL manifest and main-window capability
only list the older eight commands. Tauri2.11.5 webview invocation checks every
application command when an app ACL manifest exists; an unlisted command has no
resolved access and is rejected. Direct Rust transport tests bypass this invocation
boundary, so they cannot establish that the native UI can call the command.

Register all fourteen existing commands in the app ACL manifest and allow exactly
those generated command permissions for local main-window content. No remote
capability, wildcard, extra window, filesystem or shell permission is granted.
Business authorization, server binding, raw-byte transport and notification policy
remain in their existing Application/native adapters. No Domain logic moves to Rust.

A parity regression compares actual invoke handlers, app ACL commands and local
capability declarations, including the six previously omitted handlers. Native doctor
validates the exact permission set. Rebuild native products to regenerate ACL assets;
old compiled products do not count as verification. No schema or release metadata
change. Physical notification delivery remains a separate manual gate.
