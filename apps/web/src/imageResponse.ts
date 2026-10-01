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
