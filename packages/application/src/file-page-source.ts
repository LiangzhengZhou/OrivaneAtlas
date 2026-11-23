/** Half-open byte intervals for a single original with an immutable identity. */
export interface FilePageSource {
  readonly size: number;
  close(): void;
  read(begin: number, end: number, signal: AbortSignal): Promise<Uint8Array>;
}

export const filePageChunkBytes = 256 * 1024;

export function requireFilePageRange(size: number, begin: number, end: number) {
  if (
    !Number.isSafeInteger(begin) ||
    !Number.isSafeInteger(end) ||
    begin < 0 ||
    end <= begin ||
    end > size ||
    end - begin > filePageChunkBytes
  )
    throw new Error("INVALID_FILE_RANGE");
}
