# Orivane Atlas 3.1.14 — image metadata transport fix

- Native transport now allows the authorized `/api/library/asset/meta` route.
- If metadata revalidation fails or is unavailable, the image cache treats it as
  a miss and downloads the authoritative bytes instead of failing the whole
  image.
- This fixes the "图片加载或解码失败" regression on desktop and Android where an
  existing cache entry made every retry fail with `INVALID_SERVER`.
- Server bytes and local Markdown are unchanged.
