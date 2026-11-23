import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { VerifiedFileRanges } from "./verified-file-ranges";

const sha = () => createHash("sha256");
const digest = (bytes: Uint8Array) => sha().update(bytes).digest("hex");
function fixture(
  source = Buffer.from("abcdefg"),
  chunkSize = 2,
  proofs = new VerifiedFileRanges(sha),
  workspaceId = "personal",
) {
  const rows = Array.from(
    { length: Math.ceil(source.length / chunkSize) },
    (_, index) => {
      const bytes = source.subarray(index * chunkSize, (index + 1) * chunkSize);
      return { index, bytes, hash: digest(bytes) };
    },
  );
  const file = {
    workspaceId,
    size: source.length,
    sha256: digest(source),
    chunkSize,
    complete: true,
    mime: "application/pdf",
  };
  const reads: [number, number][] = [];
  const repo = {
    chunkCount: async () => rows.length,
    chunks: async (_hash: string, bounds?: { first: number; last: number }) => {
      if (!bounds) throw new Error("Missing query bounds");
      reads.push([bounds.first, bounds.last]);
      return rows.slice(bounds.first, bounds.last + 1);
    },
  };
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

test("historical one-byte chunks above the manifest budget are scanned in bounded batches on each read", async () => {
  const f = fixture(Buffer.alloc(1025, 65), 1);
  expect(await (await f.read(1024, 1025)).text()).toBe("A");
  expect(f.reads).toHaveLength(9);
  expect(f.reads.every(([first, last]) => last - first + 1 <= 128)).toBe(true);
  const bytes = Buffer.from("X");
  f.rows[0] = { index: 0, bytes, hash: digest(bytes) };
  await expect(f.read(1024, 1025)).rejects.toThrow("FILE_HASH_MISMATCH");
});
test("identical originals in distinct workspaces establish their own proofs and evicted originals are reverified", async () => {
  const proofs = new VerifiedFileRanges(sha);
  const workspaces = Array.from({ length: 17 }, (_, index) =>
    fixture(Buffer.from("abcd"), 2, proofs, "workspace-" + index),
  );
  for (const f of workspaces) {
    expect(await (await f.read(0, 1)).text()).toBe("a");
    expect(f.reads).toEqual([[0, 1]]);
  }
  const first = workspaces[0]!,
    last = workspaces[16]!;
  await last.read(0, 1);
  await first.read(0, 1);
  expect(last.reads.at(-1)).toEqual([0, 0]);
  expect(first.reads.at(-1)).toEqual([0, 1]);
});
