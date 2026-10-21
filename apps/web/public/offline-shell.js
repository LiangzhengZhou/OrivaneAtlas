/* Static application shell only. Business data and private bytes stay in IndexedDB. */
const shellCache = "orivane-static-shell-v1";
const shellPath = "/";
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(shellCache);
      const response = await fetch(shellPath, { cache: "reload" });
      if (!response.ok) throw new Error("Shell unavailable");
      const html = await response.clone().text();
      await cache.put(shellPath, response);
      const resources = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
        .map((match) => new URL(match[1], self.location.origin))
        .filter(
          (url) =>
            url.origin === self.location.origin &&
            url.pathname.startsWith("/assets/"),
        );
      await cache.addAll([
        ...resources.map((url) => url.href),
        "/orivane-atlas.png",
        "/favicon.png",
      ]);
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/")
  )
    return;
  const document = request.mode === "navigate";
  const asset =
    url.pathname.startsWith("/assets/") ||
    ["/orivane-atlas.png", "/favicon.png"].includes(url.pathname);
  if (!document && !asset) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(shellCache);
      if (!document) {
        const cached = await cache.match(request);
        if (cached) return cached;
      }
      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic")
          await cache.put(document ? shellPath : request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(document ? shellPath : request);
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});
