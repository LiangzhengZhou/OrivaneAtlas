import {
  defaultWorkspaceDatabase,
  type WorkspaceCatalogEntry,
} from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, test } from "vitest";
import { IndexedDbWorkspaceCatalog } from "./workspace-catalog";

const entry = (
  id = "11111111-1111-4111-8111-111111111111",
): WorkspaceCatalogEntry => ({
  id,
  databaseName: `${defaultWorkspaceDatabase}.${id}`,
  title: "Account workspace",
  remote: {
    serverOrigin: "https://example.test",
    workspaceId: "workspace",
    principalId: "owner",
  },
});

test("catalog selection persists, preserves default and CAS prevents cross-tab replacement", async () => {
  const factory = new IDBFactory();
  let catalog = await IndexedDbWorkspaceCatalog.open("catalog", factory);
  expect((await catalog.active()).databaseName).toBe(defaultWorkspaceDatabase);
  const reserved = await catalog.reserveRemote(entry());
  expect((await catalog.active()).id).toBe("default");
  await catalog.select(reserved.id, defaultWorkspaceDatabase);
  await expect(
    catalog.select("default", defaultWorkspaceDatabase),
  ).rejects.toThrow("VERSION_CONFLICT");
  catalog.close();
  catalog = await IndexedDbWorkspaceCatalog.open("catalog", factory);
  expect(await catalog.active()).toEqual(reserved);
  expect(await catalog.list()).toHaveLength(2);
  await catalog.select("default", reserved.databaseName);
  expect((await catalog.active()).id).toBe("default");
  catalog.close();
});

test("concurrent reservation chooses one account database without switching active workspace", async () => {
  const factory = new IDBFactory();
  const [a, b] = await Promise.all([
    IndexedDbWorkspaceCatalog.open("catalog", factory),
    IndexedDbWorkspaceCatalog.open("catalog", factory),
  ]);
  const records = await Promise.all([
    a.reserveRemote(entry()),
    b.reserveRemote(entry("22222222-2222-4222-8222-222222222222")),
  ]);
  expect(records[0]).toEqual(records[1]);
  expect((await a.active()).id).toBe("default");
  expect(await a.list()).toHaveLength(2);
  a.close();
  b.close();
});

test("caller mutation cannot redirect a queued reservation and credentials never enter catalog", async () => {
  const factory = new IDBFactory(),
    catalog = await IndexedDbWorkspaceCatalog.open("catalog", factory);
  const input = { ...entry(), remote: { ...entry().remote! } };
  const pending = catalog.reserveRemote(input);
  input.remote.principalId = "other";
  expect((await pending).remote!.principalId).toBe("owner");
  expect(() =>
    catalog.reserveRemote({
      ...entry(),
      password: "must-not-persist",
    } as WorkspaceCatalogEntry),
  ).toThrow("MALFORMED_WORKSPACE_CATALOG");
  expect(() =>
    catalog.reserveRemote({
      ...entry(),
      remote: {
        ...entry().remote!,
        serverOrigin: "https://user:secret@example.test",
      },
    }),
  ).toThrow("MALFORMED_WORKSPACE_CATALOG");
  expect(JSON.stringify(await catalog.list())).not.toContain(
    "must-not-persist",
  );
  catalog.close();
});

test("corrupt catalog state fails closed without resetting selection or discarding entries", async () => {
  const factory = new IDBFactory();
  const catalog = await IndexedDbWorkspaceCatalog.open("corrupt", factory);
  await catalog.reserveRemote(entry());
  catalog.close();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("corrupt", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    tx.objectStore("state").put("missing-workspace", "active");
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  const reopened = await IndexedDbWorkspaceCatalog.open("corrupt", factory);
  await expect(reopened.active()).rejects.toThrow(
    "MALFORMED_WORKSPACE_CATALOG",
  );
  await expect(
    reopened.select("default", defaultWorkspaceDatabase),
  ).rejects.toThrow("MALFORMED_WORKSPACE_CATALOG");
  expect(await reopened.list()).toHaveLength(2);
  await expect(reopened.active()).rejects.toThrow(
    "MALFORMED_WORKSPACE_CATALOG",
  );
  reopened.close();
});
