// Only bounded metadata may escape this boundary. Never include response text,
// asset URLs, credentials, or raw native errors in image diagnostics.
export class ImageLoadError extends Error {
  constructor(
    readonly code: "access" | "missing" | "response" | "empty",
    readonly status: number,
  ) {
    super(`IMAGE_${code.toUpperCase()}`);
  }
}

/** File hydration and native IPC expose codes, never private response bodies. */
export function imageLoadFailure(error: unknown): unknown {
  if (error instanceof ImageLoadError) return error;
  const code = error instanceof Error ? error.message : error;
  if (["UNAUTHORIZED", "FILE_DOWNLOAD_401"].includes(String(code)))
    return new ImageLoadError("access", 401);
  if (["FORBIDDEN", "FILE_DOWNLOAD_403"].includes(String(code)))
    return new ImageLoadError("access", 403);
  if (["NOT_FOUND", "FILE_DOWNLOAD_404"].includes(String(code)))
    return new ImageLoadError("missing", 404);
  return error;
}

/** Allowlisted diagnostic codes only; never log arbitrary exception messages. */
export function imageFailureReason(error: unknown): string {
  const code = error instanceof Error ? error.message : error;
  return typeof code === "string" &&
    [
      "VERSION_CONFLICT",
      "VALIDATION_ERROR",
      "LOCAL_DATA_CORRUPT",
      "FILE_BYTES_UNAVAILABLE",
      "SERVER_CHANGED",
      "NETWORK_ERROR",
      "FORBIDDEN",
      "NOT_FOUND",
    ].includes(code)
    ? code
    : "UNCLASSIFIED";
}

export function rasterMime(bytes: Uint8Array): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return "application/octet-stream";
}

export async function imageResponseBlob(response: Response): Promise<Blob> {
  const status = response.status;
  if (status === 401 || status === 403)
    throw new ImageLoadError("access", status);
  if (status === 404) throw new ImageLoadError("missing", status);
  const mime = response.headers
    .get("Content-Type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (
    !response.ok ||
    !mime ||
    !["image/png", "image/jpeg", "image/webp"].includes(mime)
  )
    throw new ImageLoadError("response", status);
  const blob = await response.blob();
  if (!blob.size) throw new ImageLoadError("empty", status);
  return blob;
}
