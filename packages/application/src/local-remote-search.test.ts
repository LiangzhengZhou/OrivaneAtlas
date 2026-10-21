import { expect, test } from "vitest";
import { localObject } from "./local-dto";
import type { LocalEntity, LocalSyncState } from "./local-persistence";
import { remoteUnhydratedSearchIds } from "./local-search";

function fixture() {
  const actor = { workspaceId: "local", principalId: "owner" };
  const binding = {
    workspaceId: "local",
    remoteWorkspaceId: "remote",
    remotePrincipalId: "remote-owner",
    serverOrigin: "https://example.test",
    epoch: "epoch",
    cursor: 12,
    version: 2,
  } satisfies LocalSyncState;
  const scope = {
    remoteWorkspaceId: binding.remoteWorkspaceId,
    remotePrincipalId: binding.remotePrincipalId,
    serverOrigin: binding.serverOrigin,
    epoch: binding.epoch,
  };
  const manifest: LocalEntity = {
    workspaceId: "local",
    collection: "notes",
    id: "note",
    version: 1,
    value: {
      id: "note",
      workspaceId: "local",
      version: 1,
      kind: "NOTE",
      title: "Remote",
      deletedAt: null,
      bodyState: "UNLOADED",
    },
  };
  const availability: LocalEntity = {
    workspaceId: "local",
    collection: "$local.noteBodyAvailability",
    id: "note",
    version: 1,
    value: {
      ...scope,
      collection: "notes",
      id: "note",
      entityVersion: 1,
      state: "MISSING",
    },
  };
  const base: LocalEntity = {
    workspaceId: "local",
    collection: "$local.remoteBase",
    id: '["notes","note"]',
    version: 1,
    value: {
      ...scope,
      collection: "notes",
      id: "note",
      version: 1,
      value: { ...localObject(manifest.value), workspaceId: "remote" },
    },
  };
  const rows = new Map(
    [manifest, availability, base].map((row) => [
      JSON.stringify([row.collection, row.id]),
      row,
    ]),
  );
  const metadata = {
    get: async (workspaceId: string, collection: string, id: string) =>
      workspaceId === "local"
        ? (rows.get(JSON.stringify([collection, id])) ?? null)
        : null,
  };
  const search = (ids = ["note"]) =>
    remoteUnhydratedSearchIds(actor, binding, "notes", ids, metadata);
  return {
    actor,
    binding,
    manifest,
    availability,
    base,
    rows,
    metadata,
    search,
  };
}

test("FTS supplements only unchanged unhydrated metadata, without duplicate or unknown hits", async () => {
  const f = fixture();
  expect(await f.search(["note", "note", "unknown"])).toEqual(["note"]);
});
test("loaded, locally edited and deleted bodies override remote FTS", async () => {
  for (const patch of [
    { bodyState: "LOADED", bodyMd: "Local text" },
    { title: "Local edit" },
    { deletedAt: "2026-10-16T00:00:00Z" },
  ]) {
    const f = fixture();
    f.rows.set(JSON.stringify([f.manifest.collection, f.manifest.id]), {
      ...f.manifest,
      value: { ...localObject(f.manifest.value), ...patch },
    });
    if ("title" in patch)
      await expect(f.search()).rejects.toThrow("LOCAL_DATA_CORRUPT");
    else expect(await f.search()).toEqual([]);
  }
});
test("remote search cannot cross workspace, account, server or epoch", async () => {
  const f = fixture();
  await expect(
    remoteUnhydratedSearchIds(
      { ...f.actor, workspaceId: "other" },
      f.binding,
      "notes",
      ["note"],
      f.metadata,
    ),
  ).rejects.toThrow("FORBIDDEN");
  for (const field of [
    "remoteWorkspaceId",
    "remotePrincipalId",
    "serverOrigin",
    "epoch",
  ] as const) {
    const g = fixture();
    g.binding[field] = "other";
    expect(await g.search()).toEqual([]);
  }
});
test("missing canonical evidence and malformed hit identities are rejected", async () => {
  const f = fixture();
  f.rows.delete(JSON.stringify([f.base.collection, f.base.id]));
  await expect(f.search()).rejects.toThrow("LOCAL_DATA_CORRUPT");
  await expect(fixture().search([""])).rejects.toThrow("VALIDATION_ERROR");
});
