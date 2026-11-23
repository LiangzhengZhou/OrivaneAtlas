import { expect, it } from "vitest";
import { readFilePageResponse } from "./file-page-response";

const hash = "a".repeat(64);
const headers = {
  "Content-Type": "application/octet-stream",
  "Content-Length": "3",
  "Content-Range": "bytes 4-6/12",
  ETag: '"' + hash + '"',
};
const read = (r: Response, signal = new AbortController().signal) =>
  readFilePageResponse(r, 12, hash, 4, 7, signal);

it("delivers only the exact partial representation", async () => {
  expect(
    await read(
      new Response(new Uint8Array([3, 4, 5]), { status: 206, headers }),
    ),
  ).toEqual(new Uint8Array([3, 4, 5]));
  for (const invalid of [
    { status: 200, headers },
    { status: 206, headers: { ...headers, ETag: '"other"' } },
    { status: 206, headers: { ...headers, "Content-Range": "bytes 4-6/13" } },
    { status: 206, headers: { ...headers, "Content-Length": "4" } },
  ])
    await expect(
      read(new Response(new Uint8Array([3, 4, 5]), invalid)),
    ).rejects.toThrow("INVALID_FILE_RANGE_RESPONSE");
  await expect(
    read(new Response(new Uint8Array([3, 4]), { status: 206, headers })),
  ).rejects.toThrow("INCOMPLETE_FILE_RANGE");
  await expect(
    read(new Response(new Uint8Array([3, 4, 5, 6]), { status: 206, headers })),
  ).rejects.toThrow("INVALID_FILE_RANGE_RESPONSE");
});
it("cancels an unfinished body when the viewer closes", async () => {
  const controller = new AbortController();
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(reader) {
      reader.enqueue(new Uint8Array([1]));
    },
    cancel() {
      canceled = true;
    },
  });
  const pending = read(
    new Response(stream, { status: 206, headers }),
    controller.signal,
  );
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(canceled).toBe(true);
});
