import { expect, test } from "vitest";
import type { LibraryEntry } from "./library";
import { workspaceManifest } from "./workspace-bootstrap";

test("manifest bytes do not grow with Markdown bodies and retain version identity", () => {
  const document: LibraryEntry = {
    id: "document",
    workspaceId: "workspace",
    kind: "DOCUMENT",
    spaceId: "space",
    title: "Title",
    bodyMd: "",
    version: 4,
    createdAt: "2026-10-05",
    updatedAt: "2026-10-05",
    createdBy: "principal",
    updatedBy: "principal",
    deletedAt: null,
    provenance: "HUMAN",
  };
  const build = (size: number) =>
    workspaceManifest(
      42,
      "epoch",
      [],
      Array.from({ length: 500 }, (_, index) => ({
        ...document,
        id: String(index),
        bodyMd: "x".repeat(size),
      })),
    );
  const small = build(1024);
  const large = build(50 * 1024);
  expect(
    Buffer.byteLength(JSON.stringify(large)) /
      Buffer.byteLength(JSON.stringify(small)),
  ).toBeLessThan(1.01);
  expect(large.library[0]?.bodyCharacterCount).toBe(50 * 1024);
  expect(
    large.library.map(({ bodyCharacterCount: _count, ...entry }) => entry),
  ).toEqual(
    small.library.map(({ bodyCharacterCount: _count, ...entry }) => entry),
  );
  expect(large.library[0]).toMatchObject({ version: 4, bodyState: "UNLOADED" });
  expect(large.library[0]).not.toHaveProperty("bodyMd");
  expect(large.cursor).toBe(42);
});
