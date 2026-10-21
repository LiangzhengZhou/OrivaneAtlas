import type { FileExtractionDocument } from "@arclattice/domain";
import { expect, it } from "vitest";
import { fileSearchRows } from "./file-search-index";

const header = {
  workspaceId: "local",
  fileId: "file",
  fileVersion: 1,
  contentHash: "a".repeat(64),
  indexVersion: 2,
};
it("normalizes derived search while preserving original chunk text and source identity", () => {
  const document: FileExtractionDocument = {
    ...header,
    chunks: [
      { ...header, kind: "TEXT", locator: "text:1", text: "ＡＢＣ\n第一行" },
    ],
  };
  const before = structuredClone(document);
  expect(fileSearchRows(document)).toEqual([
    {
      locator: "text:1",
      text: " abc 第一行",
      grams: expect.arrayContaining(["abc", "第一行"]),
    },
  ]);
  expect(document).toEqual(before);
});
it("rejects malformed identity and stale chunks before computing an index", () => {
  expect(() => fileSearchRows({ ...header, fileId: "", chunks: [] })).toThrow(
    "MALFORMED",
  );
  expect(() =>
    fileSearchRows({
      ...header,
      chunks: [
        {
          ...header,
          fileVersion: 2,
          kind: "TEXT",
          locator: "text:1",
          text: "stale",
        },
      ],
    }),
  ).toThrow("MALFORMED");
});
