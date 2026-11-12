# Orivane Atlas 3.1.13 — verify local image bytes before rendering

- Legacy image chunks are hash-verified from the local replica before use.
- A local image blob must actually decode before it is returned; otherwise the
  loader falls back to the authorized server copy.
- This prevents a stale/corrupt local asset from masking a valid server image.
- Native binary image transport from 3.1.12 remains.
