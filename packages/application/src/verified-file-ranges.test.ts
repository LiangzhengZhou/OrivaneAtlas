import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { VerifiedFileRanges } from "./verified-file-ranges";

const sha = () => createHash("sha256");
const digest = (bytes: Uint8Array) => sha().update(bytes).digest("hex");
function fixture() {
  const source = Buffer.from("abcdefg");
  const rows = [0, 2, 4, 6].map((start, index) => {
    const bytes = source.subarray(start, start + 2);
    return { index, bytes, hash: digest(bytes) };
  });
  const file = {
    workspaceId: "personal",
    size: source.length,
    sha256: digest(source),
    chunkSize: 2,
    complete: true,
    mime: "application/pdf",
  };
  const reads: number[][] = [];
  const repo = {
    chunkCount: async () => rows.length,
    chunks: async (_hash: string, bounds?: { first: number; last: number }) => {
      if (!bounds) throw new Error("Missing query bounds");
      reads.push([bounds.first, bounds.last]);
      return rows.slice(bounds.first, bounds.last + 1);
    },
  };
  const proofs = new VerifiedFileRanges(sha);
  return {
    rows,
    reads,
    read: (begin: number, end: number) => proofs.read(repo, file, begin, end),
  };
}
test("a cold range verifies the original including bytes beyond the requested interval", async () => {
  const f = fixture(),
    old = f.rows[3]!;
  const bytes = Buffer.from("x");
  f.rows[3] = { ...old, bytes, hash: digest(bytes) };
  await expect(f.read(0, 2)).rejects.toThrow("FILE_HASH_MISMATCH");
  f.rows[3] = old;
  expect(await (await f.read(0, 2)).text()).toBe("ab");
  expect(f.reads).toEqual([
    [0, 3],
    [0, 3],
  ]);
});
test("subsequent ranges verify the selected bytes against the original even if the stored chunk digest changes", async () => {
  const f = fixture();
  expect(await (await f.read(1, 4)).text()).toBe("bcd");
  const bytes = Buffer.from("xy");
  f.rows[2] = { index: 2, bytes, hash: digest(bytes) };
  expect(await (await f.read(6, 7)).text()).toBe("g");
  await expect(f.read(4, 5)).rejects.toThrow("FILE_HASH_MISMATCH");
  expect(f.reads).toEqual([
    [0, 3],
    [3, 3],
    [2, 2],
  ]);
});
