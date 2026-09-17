# ADR 0018 — Bundled native UI and authenticated server transport

Accepted 2026-09-16. The bundled native UI does not share an origin with the
self-hosted API. Browser cross-origin fetch conflicts with strict server origin
checks, SameSite cookies, and preflight restrictions. Do not weaken server CORS,
CSRF, or cookie policy to fix this integration.

Use narrow local-only native commands to select an HTTPS origin and call the
existing application API. Loopback HTTP is development-only. Native requests
send the selected server origin, never forward to redirects, validate TLS, and
keep the session cookie in process memory only. Passwords remain request-local.
No arbitrary headers, filesystem access, shell, or remote IPC is exposed. Origin
changes invalidate in-flight replies and clear cookies. Only known API paths
are allowed. The server remains responsible for account/workspace authorization
and CSRF checks; native origin headers are not authentication.

Bootstrap alone chooses native transport versus ordinary same-origin browser
fetch. Private images and backup downloads must use the same authenticated
transport. UI consumes runtime contracts; it does not invoke native APIs.

Login has a three-second native connection timeout and eight-second overall
request timeout. Browser requests have an eight-second login deadline. Invalid
origins fail locally; wrong credentials, forbidden origin/access, rate limiting,
timeout, network/TLS and invalid server replies receive distinct bilingual
feedback. No automatic password retry or reduction of password hashing cost.

Acceptance: actual strict-host login/session/read/logout through native transport,
rejection of off-origin redirects and paths, no cookie reuse after origin switch,
timeouts/retry, UI message/accessibility tests, private image/backup paths, and
platform builds. Physical-device tests remain separate from simulated bridges.
