import { requireFilePageRange } from "@arclattice/application";

/** Reject a full/changed response before allocating its body. */
export async function readFilePageResponse(
  response: Response,
  size: number,
  hash: string,
  begin: number,
  end: number,
  signal: AbortSignal,
) {
  requireFilePageRange(size, begin, end);
  if (
    response.status !== 206 ||
    response.headers.get("etag") !== '"' + hash + '"' ||
    response.headers.get("content-range") !==
      `bytes ${begin}-${end - 1}/${size}` ||
    response.headers.get("content-length") !== String(end - begin) ||
    response.headers.get("content-type") !== "application/octet-stream"
  ) {
    await response.body?.cancel();
    throw new Error("INVALID_FILE_RANGE_RESPONSE");
  }
  signal.throwIfAborted();
  if (!response.body) throw new Error("INCOMPLETE_FILE_RANGE");
  const bytes = new Uint8Array(end - begin);
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  let offset = 0;
  try {
    for (;;) {
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      if (next.value.length > bytes.length - offset) {
        await reader.cancel();
        throw new Error("INVALID_FILE_RANGE_RESPONSE");
      }
      bytes.set(next.value, offset);
      offset += next.value.length;
    }
    if (offset !== bytes.length) throw new Error("INCOMPLETE_FILE_RANGE");
    return bytes;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
