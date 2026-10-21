import {
  bodyManifest,
  type LibraryEntry,
  type Note,
  planLocalCommands,
  prepareLocalWorkPull,
} from "@arclattice/application";
import { IndexedDbLocalStore } from "@arclattice/storage-local";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { work } from "../../../tests/fixtures";
import { bootstrap } from "./bootstrap";

const localWorkspaces: {
  runtime: Awaited<ReturnType<typeof bootstrap>>;
  workspaceId: string;
  noteId: string;
}[] = [];

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
  localWorkspaces.length = 0;
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("BroadcastChannel", undefined);
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
afterEach(async () => {
  try {
    for (const { runtime, workspaceId, noteId } of localWorkspaces) {
      expect(runtime.context.workspaceId).toBe(workspaceId);
      const note = (await runtime.loadWorkspace()).notes.find(
        (entry) => entry.id === noteId,
      );
      expect(note).toBeDefined();
      if (!note) throw new Error("LOCAL_NOTE_LOST_AT_ACCOUNT_BOUNDARY");
      expect((await runtime.readDocumentBody(note)).bodyMd).toBe(
        "Protected local Markdown",
      );
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
async function authenticatedRuntime() {
  const runtime = await bootstrap();
  const localContext = runtime.context;
  const note = await runtime.saveNote(null, 0, {
    kind: "NOTE",
    day: null,
    title: "Local ownership",
    bodyMd: "Protected local Markdown",
  });
  localWorkspaces.push({
    runtime,
    workspaceId: localContext.workspaceId,
    noteId: note.id,
  });
  await runtime.initializeRemoteAccount();
  expect(runtime.context).toEqual(localContext);
  expect(() => {
    runtime.context = runtime.remoteContext;
  }).toThrow("FORBIDDEN");
  expect(runtime.context).toEqual(localContext);
  return runtime;
}
it.each(["ROUNDTRIP", "STALE_VERSION", "ACCOUNT_CHANGED"])(
  "lazy Note lifecycle preserves body/version/account scope: %s",
  async (mode) => {
    const runtime = await authenticatedRuntime();
    const store = await IndexedDbLocalStore.open(
      "orivane-atlas.local-workspace",
    );
    const binding = {
      workspaceId: runtime.context.workspaceId,
      remoteWorkspaceId: "a",
      remotePrincipalId: "a",
      serverOrigin: origin,
      epoch: "epoch",
      cursor: 0,
      version: 1,
    };
    const remote: Note = {
      id: crypto.randomUUID(),
      workspaceId: "a",
      title: "Lazy lifecycle",
      bodyMd: "Private Markdown\r\n\n- [ ] Original only",
      kind: "NOTE",
      day: null,
      version: 1,
      createdAt: "2026-10-20T00:00:00Z",
      updatedAt: "2026-10-20T00:00:00Z",
      createdBy: "a",
      updatedBy: "a",
      deletedAt: null,
      provenance: "HUMAN",
      classification: "PRIVATE",
      boundary: "REMOTE",
      aiAccess: "DENY",
    };
    try {
      await store.syncState.save(binding, null);
      const pull = await prepareLocalWorkPull(
        runtime.context,
        binding,
        {
          epoch: "epoch",
          cursor: 1,
          snapshot: null,
          recovery: false,
          hasMore: false,
          records: [
            {
              seq: 1,
              workspaceId: "a",
              collection: "notes",
              entityId: remote.id,
              op: "UPSERT",
              version: 1,
            },
          ],
          changes: {
            values: {},
            collections: {
              notes: { upserts: [bodyManifest(remote)], removed: [] },
            },
          },
        },
        await store.outbox.list(binding.workspaceId),
        store.metadata,
      );
      if (!pull) throw new Error("Missing Note projection");
      await store.replica.commit(pull);
      let resolveBody!: (response: Response) => void, entered!: () => void;
      const bodyPending = new Promise<Response>((resolve) => {
        resolveBody = resolve;
      });
      const requested = new Promise<void>((resolve) => {
        entered = resolve;
      });
      fetcher.mockClear();
      fetcher.mockImplementation(async (url) => {
        if (String(url).includes("/api/document/body")) {
          entered();
          return mode === "ACCOUNT_CHANGED"
            ? bodyPending
            : Response.json(remote);
        }
        return Response.json(identity());
      });
      if (mode === "STALE_VERSION") {
        await expect(runtime.deleteNote(remote.id, 2, true)).rejects.toThrow(
          "VERSION_CONFLICT",
        );
        expect(fetcher).not.toHaveBeenCalled();
      } else if (mode === "ACCOUNT_CHANGED") {
        const pending = runtime.deleteNote(remote.id, 1, true);
        const rejected = expect(pending).rejects.toThrow(
          /SERVER_CHANGED|FORBIDDEN/,
        );
        await requested;
        await runtime.logout();
        resolveBody(Response.json(remote));
        await rejected;
        expect(
          await store.metadata.get(binding.workspaceId, "notes", remote.id),
        ).toMatchObject({ version: 1, value: { deletedAt: null } });
        expect(
          await store.metadata.get(
            binding.workspaceId,
            "$local.noteBody",
            remote.id,
          ),
        ).toBeNull();
      } else {
        const deleted = await runtime.deleteNote(remote.id, 1, true);
        expect(deleted).toMatchObject({ version: 2, bodyMd: remote.bodyMd });
        expect(deleted.deletedAt).not.toBeNull();
        const restored = await runtime.deleteNote(remote.id, 2, false);
        expect(restored).toMatchObject({
          version: 3,
          deletedAt: null,
          bodyMd: remote.bodyMd,
        });
        expect(
          fetcher.mock.calls.filter(([url]) =>
            String(url).includes("/api/document/body"),
          ),
        ).toHaveLength(1);
      }
    } finally {
      store.close();
    }
  },
);

it("background synchronization leaves an unbound local workspace entirely offline", async () => {
  const runtime = await bootstrap();
  expect(await runtime.synchronizeConnectedWorkspace()).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  await runtime.initializeRemoteAccount();
  fetcher.mockClear();
  expect(await runtime.synchronizeConnectedWorkspace()).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
it("first remote Atlas operation initializes the session without blocking local bootstrap", async () => {
  const runtime = await bootstrap();
  const localActor = runtime.context;
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockImplementation(async (input, init) => {
    if (String(input).endsWith("/api/session"))
      return Response.json(identity());
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("csrf-a");
    return Response.json({ id: "run", status: "WAITING_APPROVAL", version: 1 });
  });
  const run = await runtime.propose("Explicit question", "personal", []);
  expect(run.status).toBe("WAITING_APPROVAL");
  expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
    origin + "/api/session",
    origin + "/api/ai/propose",
  ]);
  expect(runtime.context).toEqual(localActor);
});
it("receipt recovery requires explicit binding and never sends local content merely after login", async () => {
  const runtime = await authenticatedRuntime();
  fetcher.mockClear();
  await expect(runtime.recoverLocalReceipts()).rejects.toThrow("FORBIDDEN");
  await expect(runtime.pullLocalWorkChanges()).rejects.toThrow("FORBIDDEN");
  await expect(runtime.syncLocalWork()).rejects.toThrow("FORBIDDEN");
  expect(fetcher).not.toHaveBeenCalled();
});

it("private Work delta transport commits canonical data and cursor locally, while empty polls make no durable change", async () => {
  const runtime = await authenticatedRuntime();
  const store = await IndexedDbLocalStore.open("orivane-atlas.local-workspace");
  try {
    const binding = {
      workspaceId: runtime.context.workspaceId,
      remoteWorkspaceId: "a",
      remotePrincipalId: "a",
      serverOrigin: origin,
      epoch: "epoch",
      cursor: 0,
      version: 1,
    };
    await store.syncState.save(binding, null);
    const canonical = {
      ...work(crypto.randomUUID(), "a"),
      title: "Remote canonical",
      createdBy: "a",
      updatedBy: "a",
    };
    const page = {
      epoch: "epoch",
      cursor: 1,
      recovery: false,
      hasMore: false,
      snapshot: null,
      records: [
        {
          seq: 1,
          workspaceId: "a",
          collection: "items",
          entityId: canonical.id,
          op: "UPSERT",
          version: 1,
        },
      ],
      changes: {
        collections: { items: { upserts: [canonical], removed: [] } },
        values: {},
      },
    };
    fetcher.mockClear();
    fetcher.mockResolvedValueOnce(
      Response.json({
        ...page,
        records: [],
        changes: { collections: {}, values: {} },
      }),
    );
    fetcher.mockResolvedValueOnce(Response.json(page));
    expect(await runtime.pullLocalWorkChanges()).toEqual({
      changed: true,
      cursor: 1,
      hasMore: false,
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      "/api/v1/sync?after=0&epoch=epoch&bodyMode=metadata&privateMemos=only",
    );
    expect(String(fetcher.mock.calls[1]?.[0])).toContain(
      "/api/v1/sync?after=0&epoch=epoch&bodyMode=metadata&relationMode=canonical&privateMemos=include",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await store.syncState.get(runtime.context.workspaceId)).toEqual({
      ...binding,
      cursor: 1,
      // Private-history initialization and the public delta each commit through CAS.
      version: 3,
    });
    expect(
      await store.metadata.get(
        runtime.context.workspaceId,
        "items",
        canonical.id,
      ),
    ).toMatchObject({
      version: 1,
      value: { ...canonical, workspaceId: runtime.context.workspaceId },
    });
    const before = await store.metadata.exportWorkspace!(
      runtime.context.workspaceId,
    );
    fetcher.mockResolvedValueOnce(
      Response.json({
        ...page,
        records: [],
        changes: { collections: {}, values: {} },
      }),
    );
    expect(await runtime.pullLocalWorkChanges()).toEqual({
      changed: false,
      cursor: 1,
      hasMore: false,
    });
    expect(
      await store.metadata.exportWorkspace!(runtime.context.workspaceId),
    ).toEqual(before);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(await store.syncState.get(runtime.context.workspaceId)).toEqual({
      ...binding,
      cursor: 1,
      version: 3,
    });
  } finally {
    store.close();
  }
});

it("an in-flight private receipt lookup cannot acknowledge local changes after logout", async () => {
  const runtime = await authenticatedRuntime();
  const store = await IndexedDbLocalStore.open("orivane-atlas.local-workspace");
  try {
    await runtime.service.create(runtime.context, {
      title: "Uncertain local task",
    });
    const binding = {
      workspaceId: runtime.context.workspaceId,
      remoteWorkspaceId: "a",
      remotePrincipalId: "a",
      serverOrigin: origin,
      epoch: "epoch",
      cursor: 0,
      version: 1,
    };
    await store.syncState.save(binding, null);
    const plan = (
      await planLocalCommands(
        runtime.context,
        store.metadata,
        await store.outbox.list(runtime.context.workspaceId),
      )
    ).find((plan) => plan.command?.name === "work.create");
    if (!plan) throw new Error("MISSING_LOCAL_COMMAND");
    await store.outbox.transitionMany(
      plan.mutations.map((mutation) => ({
        workspaceId: runtime.context.workspaceId,
        mutationId: mutation.id,
        binding,
        expectedState: "PENDING",
        expectedAttemptCount: 0,
        expectedLastAttemptAt: null,
        nextState: "SENDING",
        at: "2026-10-13T00:01:00Z",
      })),
    );
    const before = await store.metadata.exportWorkspace!(
      runtime.context.workspaceId,
    );
    let finish!: (response: Response) => void;
    fetcher.mockImplementation(async (url) =>
      String(url).includes("/api/v1/sync/receipt")
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : Response.json({}),
    );
    const pending = runtime.recoverLocalReceipts();
    const rejected = expect(pending).rejects.toThrow("SERVER_CHANGED");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await runtime.logout();
    finish(Response.json({ commandId: plan.id, effects: [] }));
    await rejected;
    expect(
      await store.metadata.exportWorkspace!(runtime.context.workspaceId),
    ).toEqual(before);
  } finally {
    store.close();
  }
});

it("document body caches are versioned and cannot cross authenticated identities", async () => {
  const runtime = await authenticatedRuntime();
  const document: LibraryEntry = {
    id: "document",
    workspaceId: "a",
    kind: "DOCUMENT",
    spaceId: "space",
    title: "Private",
    bodyMd: "private-body",
    version: 1,
    createdAt: "2026-10-05",
    updatedAt: "2026-10-05",
    createdBy: "a",
    updatedBy: "a",
    deletedAt: null,
    provenance: "HUMAN",
  };
  fetcher.mockResolvedValueOnce(Response.json(document));
  expect(await runtime.readRemoteDocumentBody(bodyManifest(document))).toEqual(
    document,
  );
  const calls = fetcher.mock.calls.length;
  expect(await runtime.readRemoteDocumentBody(bodyManifest(document))).toEqual(
    document,
  );
  expect(fetcher).toHaveBeenCalledTimes(calls);
  const updated = { ...document, version: 2, bodyMd: "updated-body" };
  fetcher.mockResolvedValueOnce(Response.json(updated));
  expect(await runtime.readRemoteDocumentBody(bodyManifest(updated))).toEqual(
    updated,
  );
  expect(fetcher).toHaveBeenCalledTimes(calls + 1);
  fetcher.mockResolvedValueOnce(Response.json(identity("b")));
  await runtime.session({ username: "b", password: "not-persisted" });
  const authenticatedCalls = fetcher.mock.calls.length;
  await expect(
    runtime.readRemoteDocumentBody(bodyManifest(updated)),
  ).rejects.toThrow("NOT_FOUND");
  await expect(runtime.readRemoteDocumentBody(updated)).rejects.toThrow(
    "NOT_FOUND",
  );
  expect(fetcher).toHaveBeenCalledTimes(authenticatedCalls);
});

it("an in-flight document body cannot survive logout", async () => {
  const runtime = await authenticatedRuntime();
  const document: LibraryEntry = {
    id: "document",
    workspaceId: "a",
    kind: "DOCUMENT",
    spaceId: "space",
    title: "Private",
    bodyMd: "private-body",
    version: 1,
    createdAt: "2026-10-05",
    updatedAt: "2026-10-05",
    createdBy: "a",
    updatedBy: "a",
    deletedAt: null,
    provenance: "HUMAN",
  };
  let finish!: (value: Response) => void;
  fetcher.mockImplementation(async (url) =>
    String(url).includes("/api/document/body")
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Response.json({}),
  );
  const pending = runtime.readRemoteDocumentBody(bodyManifest(document));
  const assertion = expect(pending).rejects.toThrow("SERVER_CHANGED");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await runtime.logout();
  finish(Response.json(document));
  await assertion;
});
it("runtime construction does not await session and initialization is shared", async () => {
  const runtime = await bootstrap();
  expect(fetcher).not.toHaveBeenCalled();
  expect(runtime.remoteInitialized).toBe(false);
  await Promise.all([
    runtime.initializeRemoteAccount(),
    runtime.initializeRemoteAccount(),
  ]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(runtime.remoteInitialized).toBe(true);
  expect(runtime.remoteContext?.workspaceId).toBe("a");
});

it("native JSON is consumed as UTF-8 without a Base64 decoder", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  metadata.set("orivane.atlas.server-origin", origin);
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "configure_server") return undefined as never;
    if (command === "saved_accounts") return [] as never;
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(identity()),
      encoding: "utf8",
    } as never;
  });
  const decoder = vi.spyOn(globalThis, "atob");
  try {
    const runtime = await authenticatedRuntime();
    expect(runtime.remoteContext?.workspaceId).toBe("a");
    expect(decoder).not.toHaveBeenCalled();
  } finally {
    decoder.mockRestore();
  }
});

it("native offline logout clears remote identity while preserving the local workspace and reports unconfirmed remote revocation", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  metadata.set("orivane.atlas.server-origin", origin);
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "configure_server") return undefined as never;
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(identity()),
      encoding: "utf8",
    } as never;
  });
  const runtime = await authenticatedRuntime();
  expect(runtime.account?.id).toBe("a");
  vi.mocked(invoke).mockRejectedValueOnce("NETWORK_ERROR");
  await runtime.logout();
  expect(runtime.account).toBeNull();
  expect(runtime.remoteContext).toBeNull();
  expect(runtime.logoutWarning).toBe(true);
});

it("successful password change clears the revoked current identity", async () => {
  const runtime = await authenticatedRuntime();
  fetcher.mockResolvedValueOnce(Response.json({}));
  await runtime.changePassword("old-password", "new-password");
  expect(runtime.account).toBeNull();
  expect(runtime.remoteContext).toBeNull();
});

it("rejects a response whose JSON parsing finishes after logout", async () => {
  const runtime = await authenticatedRuntime();
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
  expect(runtime.remoteContext).toBeNull();
});

it("rejects both an in-flight sync and a queued sync at the identity boundary", async () => {
  const runtime = await authenticatedRuntime();
  let finish!: (value: Response) => void;
  let syncCalls = 0;
  fetcher.mockImplementation(async (url) => {
    if (String(url).includes("/api/bootstrap")) {
      syncCalls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
    return Response.json({});
  });
  const first = runtime.loadRemoteWorkspace();
  const queued = runtime.loadRemoteWorkspace();
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
  const runtime = await authenticatedRuntime();
  fetcher.mockResolvedValueOnce(Response.json(identity("b")));
  await runtime.session({ username: "b", password: "not-persisted" });
  expect(runtime.remoteContext?.workspaceId).toBe("b");
  expect(runtime.account?.id).toBe("b");
  expect(JSON.stringify([...metadata.values()])).not.toContain("not-persisted");
  fetcher.mockResolvedValueOnce(
    Response.json({
      schemaVersion: 1,
      cursor: 1,
      epoch: "new",
      workspace: {
        items: [],
        edges: [],
        projectMaterials: [],
        organization: [],
        links: [],
      },
      notes: [],
      library: [],
    }),
  );
  await runtime.loadRemoteWorkspace();
  expect(String(fetcher.mock.lastCall?.[0])).toBe(
    origin + "/api/bootstrap?relationMode=canonical",
  );
});

it("does not claim successful remote logout on a network failure; retry can complete", async () => {
  const runtime = await authenticatedRuntime();
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
  const runtime = await authenticatedRuntime();
  expect(runtime.savedAccounts().map((a) => a.userId)).toEqual(["a"]);
  const count = fetcher.mock.calls.length;
  await runtime.forgetAccount(runtime.savedAccounts()[0]!.id);
  expect(runtime.savedAccounts()).toEqual([]);
  expect(fetcher.mock.calls.length).toBe(count);
  expect(runtime.account?.id).toBe("a");
});

it("native saved-account switch clears old requests and restores through verified IPC without passwords", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  metadata.set("orivane.atlas.server-origin", origin);
  const saved = ["a", "b"].map((id) => ({
    id: origin + "|" + id,
    serverUrl: origin,
    userId: id,
    displayName: id,
    credentialReference: "native:" + origin + "|" + id,
  }));
  let selected = "a";
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "saved_accounts") return saved as never;
    if (command === "configure_server" || command === "detach_account")
      return undefined as never;
    if (command === "select_account") {
      selected = (args as { reference: string }).reference.endsWith("|b")
        ? "b"
        : "a";
    }
    if (
      command === "server_request" &&
      (args as { path: string }).path === "/api/tokens"
    )
      return new Promise((resolve) => {
        finish = resolve;
      });
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(identity(selected)),
      encoding: "utf8",
    } as never;
  });
  const runtime = await authenticatedRuntime();
  const stale = runtime.tokens();
  const rejected = expect(stale).rejects.toThrow("SERVER_CHANGED");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await runtime.beginAccountSwitch();
  expect(runtime.remoteContext).toBeNull();
  await runtime.switchAccount(saved[1]!.id);
  expect(runtime.account?.id).toBe("b");
  finish({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ id: "private-a" }]),
    encoding: "utf8",
  });
  await rejected;
  await runtime.switchAccount(saved[0]!.id);
  expect(runtime.account?.id).toBe("a");
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(
        ([command, args]) =>
          command === "server_request" &&
          (args as { path: string }).path === "/api/logout",
      ),
  ).toBe(false);
  expect(JSON.stringify([...metadata.values()])).not.toContain("credential");
  expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toContain(
    "password",
  );
});

it("native forget deletes the vault reference and clears the selected runtime identity", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  metadata.set("orivane.atlas.server-origin", origin);
  let saved = [
    {
      id: origin + "|a",
      serverUrl: origin,
      userId: "a",
      displayName: "a",
      credentialReference: "native-ref",
    },
  ];
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "saved_accounts") return saved as never;
    if (command === "forget_account") {
      saved = [];
      return undefined as never;
    }
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(identity()),
      encoding: "utf8",
    } as never;
  });
  const runtime = await authenticatedRuntime();
  await runtime.forgetAccount(origin + "|a");
  expect(invoke).toHaveBeenCalledWith("forget_account", {
    reference: "native-ref",
  });
  expect(runtime.remoteContext).toBeNull();
  expect(runtime.savedAccounts()).toEqual([]);
});

it("web ignores saved cross-origin server and rejects switching its cookie boundary", async () => {
  metadata.set("orivane.atlas.server-origin", "https://untrusted.example");
  const runtime = await authenticatedRuntime();
  expect(runtime.serverOrigin).toBe(origin);
  await expect(
    runtime.setServerOrigin("https://untrusted.example"),
  ).rejects.toThrow("INVALID_SERVER");
  expect(runtime.remoteContext?.principalId).toBe("a");
});
