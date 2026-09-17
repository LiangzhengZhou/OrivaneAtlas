import { invoke, isTauri } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bootstrap } from "./bootstrap";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
  Channel: class {},
}));
vi.mock("@arclattice/i18n", () => ({
  createI18n: async () => ({ resolvedLanguage: "en-US" }),
  resolveLocale: () => "en-US",
}));
const origin = "https://atlas.example";
const metadata = new Map<string, string>();
const fetcher = vi.fn<typeof fetch>();
const identity = (id = "a") => ({
  context: { workspaceId: id, principalId: id },
  csrf: "csrf-" + id,
  account: { id, username: id },
});
beforeEach(() => {
  metadata.clear();
  vi.mocked(isTauri).mockReturnValue(false);
  vi.mocked(invoke).mockReset();
  fetcher.mockReset();
  fetcher.mockImplementation(async () => Response.json(identity()));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("location", { origin, protocol: "https:" });
  vi.stubGlobal("document", { documentElement: { lang: "" } });
  vi.stubGlobal("navigator", { language: "en-US" });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => metadata.get(key) ?? null,
    setItem: (key: string, value: string) => metadata.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("native offline logout clears local identity and reports unconfirmed remote revocation", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  metadata.set("orivane.atlas.server-origin", origin);
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "configure_server") return undefined as never;
    return {
      status: 200,
      contentType: "application/json",
      body: btoa(JSON.stringify(identity())),
    } as never;
  });
  const runtime = await bootstrap();
  expect(runtime.account?.id).toBe("a");
  vi.mocked(invoke).mockRejectedValueOnce("NETWORK_ERROR");
  await runtime.logout();
  expect(runtime.account).toBeNull();
  expect(runtime.context).toBeNull();
  expect(runtime.logoutWarning).toBe(true);
});

it("successful password change clears the revoked current identity", async () => {
  const runtime = await bootstrap();
  fetcher.mockResolvedValueOnce(Response.json({}));
  await runtime.changePassword("old-password", "new-password");
  expect(runtime.account).toBeNull();
  expect(runtime.context).toBeNull();
});

it("rejects a response whose JSON parsing finishes after logout", async () => {
  const runtime = await bootstrap();
  let finish!: (value: unknown) => void;
  fetcher.mockImplementation(async (url) =>
    String(url).includes("/api/tokens")
      ? ({
          status: 200,
          ok: true,
          json: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        } as Response)
      : Response.json({}),
  );
  const old = runtime.tokens();
  const rejected = expect(old).rejects.toThrow("SERVER_CHANGED");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await runtime.logout();
  finish([{ id: "private-old-account" }]);
  await rejected;
  expect(runtime.account).toBeNull();
  expect(runtime.context).toBeNull();
});

it("rejects both an in-flight sync and a queued sync at the identity boundary", async () => {
  const runtime = await bootstrap();
  let finish!: (value: Response) => void;
  let syncCalls = 0;
  fetcher.mockImplementation(async (url) => {
    if (String(url).includes("/api/sync")) {
      syncCalls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
    return Response.json({});
  });
  const first = runtime.snapshot();
  const queued = runtime.snapshot();
  const assertions = [
    expect(first).rejects.toThrow("SERVER_CHANGED"),
    expect(queued).rejects.toThrow("SERVER_CHANGED"),
  ];
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await runtime.logout();
  finish(Response.json({ cursor: "old", snapshot: { items: ["private"] } }));
  await Promise.all(assertions);
  expect(syncCalls).toBe(1);
});

it("successful reauthentication replaces identity and clears old snapshot cursors", async () => {
  const runtime = await bootstrap();
  fetcher.mockResolvedValueOnce(Response.json(identity("b")));
  await runtime.session({ username: "b", password: "not-persisted" });
  expect(runtime.context?.workspaceId).toBe("b");
  expect(runtime.account?.id).toBe("b");
  expect(JSON.stringify([...metadata.values()])).not.toContain("not-persisted");
  fetcher.mockResolvedValueOnce(
    Response.json({ cursor: "new", snapshot: { items: [] } }),
  );
  await runtime.snapshot();
  expect(String(fetcher.mock.lastCall?.[0])).toBe(origin + "/api/sync?cursor=");
});

it("does not claim successful remote logout on a network failure; retry can complete", async () => {
  const runtime = await bootstrap();
  fetcher.mockRejectedValueOnce(new Error("offline"));
  await expect(runtime.logout()).rejects.toThrow("NETWORK_ERROR");
  expect(runtime.account?.id).toBe("a");
  fetcher.mockResolvedValueOnce(Response.json({}));
  await runtime.logout();
  expect(runtime.account).toBeNull();
});

it("ignores malformed/credential-bearing server shortcuts and forgetting is metadata-only", async () => {
  metadata.set(
    "orivane.atlas.saved-accounts",
    JSON.stringify([
      null,
      {
        id: "bad",
        userId: "x",
        displayName: "x",
        serverUrl: "https://user:password@atlas.example",
      },
    ]),
  );
  const runtime = await bootstrap();
  expect(runtime.savedAccounts().map((a) => a.userId)).toEqual(["a"]);
  const count = fetcher.mock.calls.length;
  runtime.forgetAccount(runtime.savedAccounts()[0]!.id);
  expect(runtime.savedAccounts()).toEqual([]);
  expect(fetcher.mock.calls.length).toBe(count);
  expect(runtime.account?.id).toBe("a");
});
