import { expect, it } from "vitest";
import { fileHash, fileMarkdownLink, parseFileHash } from "./fileRoute";

const id = "33333333-3333-4333-8333-333333333333";
it("File links restore a bounded canonical identity without local/server paths", () => {
  expect(parseFileHash(fileHash(id))).toBe(id);
  const hostId = "0198c853-d3d0-7d21-aee3-5b179f38fa45";
  expect(parseFileHash(fileHash(hostId))).toBe(hostId);
  expect(fileMarkdownLink({ id, name: "Notes [original]\\.txt" })).toBe(
    `[Notes \\[original\\]\\\\.txt](#library?file=${id})`,
  );
  for (const hash of [
    "#tasks?file=" + id,
    "#library?file=../private",
    "#library?file=" + id + "&file=" + id,
    "#library?file=",
    "#library?file=" + id + "%00",
  ])
    expect(parseFileHash(hash)).toBeNull();
  expect(() => fileHash("../private")).toThrow("INVALID_FILE_LINK");
});
