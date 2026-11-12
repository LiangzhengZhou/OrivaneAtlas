# Orivane Atlas 3.1.12 — native image binary transport

- Legacy Markdown images now use the native binary download command instead of
  the generic Base64 JSON bridge. This avoids large image payloads being
  truncated/corrupted through the WebView IPC path.
- The native downloader accepts only the scoped library image byte route and
  validates image content type.
- Existing Markdown bytes, image assets and caches are unchanged.
