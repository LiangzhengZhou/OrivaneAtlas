# ADR 0114: Browser offline reload caches only the static shell

Accepted 2026-10-16 for the Pre-Acceptance Delta.

IndexedDB and BlobStore already own durable business data. A browser network
offline reload also needs its application HTML and immutable build assets.
The production Web shell registers a same-origin service worker; native keeps
its bundled resources and does not register it. Registration is nonblocking.

The worker caches the shell, same-origin hashed /assets resources and brand /
favicon. It never intercepts /api, cross-origin requests, mutations or private
binary reads. Navigation is network-first with static fallback; hashed assets
are cache-first. This is not a business cache or alternate sync implementation.
Ordinary updates fetch current HTML and new hashed resources online. Existing
open clients may continue using their previous hashed resources.

Acceptance includes actual browser context.setOffline, reload and local image
decode, plus verifying CacheStorage contains no API responses. No data schema,
release metadata or production service change.
