import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
export async function serveWebFixture(initialDist) {
  let dist = resolve(initialDist);
  const mime = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".json": "application/json",
    ".wasm": "application/wasm",
  };
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      const file = resolve(dist, "." + (path === "/" ? "/index.html" : path));
      if (!file.startsWith(dist + sep) || path.startsWith("/api/"))
        throw new Error();
      const bytes = await readFile(file);
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      });
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
  const origin = "http://127.0.0.1:" + server.address().port;
  return {
    origin,
    setDist(path) {
      dist = resolve(path);
    },
    close() {
      server.close();
    },
  };
}
