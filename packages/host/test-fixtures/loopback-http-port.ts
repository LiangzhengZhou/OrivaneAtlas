import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** Some system-assigned ports accept TCP but are blocked by Fetch. */
export async function loopbackHttpPort() {
  for (let attempt = 1; ; attempt++) {
    const server = createServer((_request, response) => response.end());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    try {
      await fetch(`http://127.0.0.1:${port}`, {
        method: "HEAD",
        headers: { Connection: "close" },
      });
      return port;
    } catch (error) {
      if (attempt === 3) throw error;
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  }
}
