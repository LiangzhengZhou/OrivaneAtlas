import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";

test("offline shell never intercepts private APIs, mutations or foreign origins", async () => {
  type FetchEvent = {
    request: Request;
    respondWith(value: Promise<Response>): void;
  };
  const handlers = new Map<string, (event: FetchEvent) => void>();
  const cache = {
    match: vi.fn(async () => new Response("static shell")),
    put: vi.fn(),
  };
  const open = vi.fn(async () => cache),
    fetch = vi.fn(async () => {
      throw new TypeError("offline");
    });
  runInNewContext(
    readFileSync(
      new URL("../public/offline-shell.js", import.meta.url),
      "utf8",
    ),
    {
      self: {
        location: { origin: "https://app.test" },
        addEventListener: (
          name: string,
          handler: (event: FetchEvent) => void,
        ) => handlers.set(name, handler),
      },
      caches: { open },
      fetch,
      URL,
    },
  );
  for (const request of [
    new Request("https://app.test/api/snapshot"),
    new Request("https://app.test/api/v1/files/bytes?id=private"),
    new Request("https://app.test/api/note/save", {
      method: "POST",
      body: "private",
    }),
    new Request("https://foreign.test/assets/private.js"),
  ]) {
    const respondWith = vi.fn();
    handlers.get("fetch")!({ request, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  }
  expect(open).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  let response: Promise<Response> | undefined;
  const navigation = new Request("https://app.test/");
  Object.defineProperty(navigation, "mode", { value: "navigate" });
  handlers.get("fetch")!({
    request: navigation,
    respondWith: (value) => {
      response = value;
    },
  });
  expect(await (await response!).text()).toBe("static shell");
  expect(cache.match).toHaveBeenCalledWith("/");
});
