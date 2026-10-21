import { randomUUID } from "node:crypto";
import { DomainError } from "@arclattice/domain";
import { expect, it, vi } from "vitest";
import { ConnectedService, type ConnectedStore } from "./connected";
import { LibraryService, type LibraryStore } from "./library";
import { NotebookService, type NotebookStore } from "./notebook";
import { stableEntityIds } from "./stable-entity-ids";

it("stable primary allocation never passes purpose/options into legacy randomUUID or replaces revision/audit IDs", () => {
  const next = vi.fn(randomUUID),
    stable = randomUUID();
  const ids = stableEntityIds({ next }, "NOTE", stable);
  expect(ids.nextFor?.("NOTE")).toBe(stable);
  const revision = ids.next(),
    activity = ids.nextFor?.("ACTIVITY"),
    later = ids.nextFor?.("NOTE");
  expect(new Set([stable, revision, activity, later]).size).toBe(4);
  expect(next.mock.calls).toEqual([[], [], []]);
});
it("stable Note/Library creation checks authorization before UUID validation or content lookup", async () => {
  const missing = async (): Promise<never> => {
    throw new DomainError("NOT_FOUND");
  };
  const notes: NotebookStore = {
    list: vi.fn(async () => []),
    get: vi.fn(missing),
    save: vi.fn(async () => {}),
    revisions: vi.fn(async () => []),
    purge: vi.fn(async () => {}),
  };
  const library: LibraryStore = {
    list: vi.fn(async () => []),
    get: vi.fn(missing),
    save: vi.fn(async () => {}),
    revisions: vi.fn(async () => []),
    purge: vi.fn(async () => {}),
    putAsset: vi.fn(async () => {}),
    putAssetChunk: vi.fn(async () => {}),
    assetChunk: vi.fn(missing),
    asset: vi.fn(missing),
  };
  const actor = { workspaceId: "workspace", principalId: "owner" };
  const auth = {
      require: async () => {
        throw new DomainError("FORBIDDEN");
      },
    },
    clock = { now: () => "2026-10-13T00:00:00Z" },
    ids = { next: randomUUID };
  await expect(
    new NotebookService(notes, auth, clock, ids).createWithStableId(
      actor,
      "invalid",
      { kind: "NOTE", day: null, title: "Private", bodyMd: "Private" },
    ),
  ).rejects.toThrow("FORBIDDEN");
  await expect(
    new LibraryService(library, auth, clock, ids).createWithStableId(
      actor,
      "invalid",
      { kind: "SPACE", spaceId: null, title: "Private", bodyMd: "Private" },
    ),
  ).rejects.toThrow("FORBIDDEN");
  expect(notes.get).not.toHaveBeenCalled();
  expect(notes.save).not.toHaveBeenCalled();
  expect(library.get).not.toHaveBeenCalled();
  expect(library.save).not.toHaveBeenCalled();
});
it("stable KnowledgeLink creation authorizes before identity validation or private graph lookup", async () => {
  const links = vi.fn(async () => []),
    store: ConnectedStore = {
      links,
      saveLink: vi.fn(async () => {}),
      exists: vi.fn(async () => false),
      runs: vi.fn(async () => []),
      getRun: vi.fn(async () => {
        throw new DomainError("NOT_FOUND");
      }),
      saveRun: vi.fn(async () => {}),
    };
  await expect(
    new ConnectedService(
      store,
      {
        require: async () => {
          throw new DomainError("FORBIDDEN");
        },
      },
      { now: () => "2026-10-14T00:00:00Z" },
      { next: randomUUID },
    ).linkWithStableId(
      { workspaceId: "local", principalId: "owner" },
      "invalid",
      { kind: "WORK", id: "a" },
      { kind: "WORK", id: "b" },
      "RELATED",
    ),
  ).rejects.toThrow("FORBIDDEN");
  expect(links).not.toHaveBeenCalled();
  expect(store.exists).not.toHaveBeenCalled();
  expect(store.saveLink).not.toHaveBeenCalled();
});
