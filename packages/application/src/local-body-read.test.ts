import { expect, it, vi } from "vitest";
import { LocalMarkdownStore } from "./local-markdown-store";
import { LocalMutationTransaction } from "./local-mutation-transaction";
import type { LocalEntity, LocalMetadataStore } from "./local-persistence";
import type { Note } from "./notebook";

it("reads hydrated Markdown without canonical body access but rejects a missing body with mismatched remote identity", async () => {
  const actor = { workspaceId: "local", principalId: "owner" };
  const manifest: LocalEntity = {
    workspaceId: "local",
    collection: "notes",
    id: "note",
    version: 1,
    value: {
      workspaceId: "local",
      id: "note",
      version: 1,
      title: "Note",
      kind: "NOTE",
      bodyState: "UNLOADED",
      bodyCharacterCount: 9,
    },
  };
  let missing = false;
  const get = vi.fn(async (_workspace: string, collection: string) => {
    if (collection === "notes") return manifest;
    if (collection === "$local.noteBody")
      return {
        ...manifest,
        collection,
        value: { noteVersion: 1, bodyMd: "正文\r\nexact" },
      };
    if (collection === "$local.noteBodyAvailability")
      return {
        ...manifest,
        collection,
        value: {
          state: missing ? "MISSING" : "AVAILABLE",
          entityVersion: 1,
          collection: "notes",
          id: "note",
          serverOrigin: "https://a.example",
          remoteWorkspaceId: "remote",
          remotePrincipalId: "remote-owner",
          epoch: "epoch",
        },
      };
    if (collection === "$local.remoteBase")
      return {
        ...manifest,
        collection,
        id: '["notes","note"]',
        value: {
          collection: "notes",
          id: "note",
          version: 1,
          serverOrigin: "https://other.example",
        },
      };
    return null;
  });
  const metadata: LocalMetadataStore = {
    get,
    list: async () => [],
    commit: async () => {},
  };
  const clock = { now: () => "2026-10-20T00:00:00Z" };
  const ids = { next: () => "unused" };
  const read = async () => {
    const stage = await LocalMutationTransaction.begin(
      metadata,
      actor,
      "device",
      clock,
      ids,
    );
    return new LocalMarkdownStore<Note>(
      stage,
      actor,
      clock,
      ids,
      () => {},
      "notes",
      "note",
    ).get("note");
  };
  expect((await read()).bodyMd).toBe("正文\r\nexact");
  expect(
    get.mock.calls.some(([, collection]) => collection === "$local.remoteBase"),
  ).toBe(false);
  missing = true;
  await expect(read()).rejects.toThrow("LOCAL_DATA_CORRUPT");
});
