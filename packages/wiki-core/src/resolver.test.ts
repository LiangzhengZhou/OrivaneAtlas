import { expect, it } from "vitest";
import { resolveOwnedWikiLinks, resolveWikiLinks } from "./resolver";

it("resolves only query-owned targets in place while retaining every relation field and refreshing aliases", () => {
  const link = {
    sourceDocumentId: "source",
    targetDocumentId: "old" as string | null,
    targetText: "别名",
    alias: "原始\r\n😀",
    heading: "Section",
    extra: [1, 2],
  };
  const links = [
    link,
    { ...link, targetText: "missing", targetDocumentId: null },
  ];
  const fields = structuredClone(links);
  expect(
    resolveOwnedWikiLinks(links, [
      { id: "target", title: "标题", aliases: ["别名"] },
    ]),
  ).toBe(links);
  expect(links[0]).toBe(link);
  expect(links).toEqual([
    { ...fields[0], targetDocumentId: "target" },
    fields[1],
  ]);
  resolveOwnedWikiLinks(links, [
    { id: "target", title: "Renamed", aliases: [] },
  ]);
  expect(links).toEqual(
    fields.map((value) => ({ ...value, targetDocumentId: null })),
  );
});

it("retains the general resolver's independent copying contract", () => {
  const links = [
    {
      targetText: "Title",
      alias: null,
      heading: null,
      start: 0,
      end: 9,
      embed: false,
    },
  ];
  const result = resolveWikiLinks(links, [{ id: "target", title: "Title" }]);
  expect(result[0]).toEqual({ ...links[0], targetDocumentId: "target" });
  expect(result[0]).not.toBe(links[0]);
  expect(links[0]).not.toHaveProperty("targetDocumentId");
});
