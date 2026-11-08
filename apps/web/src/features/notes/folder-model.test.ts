import type { Organization, WorkspaceNote } from "@arclattice/application";
import { describe, expect, it } from "vitest";
import { noteFolderKey, noteFolderLabel } from "./folder-model";

const note = (primaryFolderId?: string): WorkspaceNote =>
  ({
    id: "note",
    workspaceId: "workspace",
    kind: "NOTE",
    title: "Note",
    bodyMd: "",
    version: 1,
    primaryFolderId,
  }) as WorkspaceNote;

const organization = (
  id: string,
  folder?: string,
  folderId?: string,
): [string, Organization] => [
  "NOTE:" + id,
  {
    id,
    workspaceId: "workspace",
    kind: "NOTE",
    name: "Note",
    folder: folder ?? "",
    ...(folderId ? { folderId } : {}),
  } as Organization,
];

describe("note folder authority", () => {
  it("uses the primary folder identity", () => {
    const folders = new Map([organization("note", "", "folder-a")]);
    expect(noteFolderKey(note("folder-b"), folders)).toBe("folder:folder-b");
  });

  it("uses legacy folderId only as a compatibility fallback", () => {
    const folders = new Map([organization("note", "", "folder-a")]);
    expect(noteFolderKey(note(), folders)).toBe("folder:folder-a");
    expect(noteFolderLabel(note(), folders, [], "Unfiled", "Legacy")).toBe(
      "Unfiled",
    );
  });

  it("keeps legacy free text as a read-only legacy group", () => {
    const folders = new Map([organization("note", "Old group")]);
    expect(noteFolderKey(note(), folders)).toBe("legacy:Old group");
    expect(noteFolderLabel(note(), folders, [], "Unfiled", "Legacy")).toBe(
      "Legacy: Old group",
    );
  });

  it("does not let legacy folderId override a present primary field", () => {
    const folders = new Map([organization("note", "Old group", "folder-a")]);
    expect(noteFolderKey(note("folder-b"), folders)).toBe("folder:folder-b");
  });
});
