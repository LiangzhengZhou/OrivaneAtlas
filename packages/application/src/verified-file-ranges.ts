import type { FileBinaryDescriptor, FileBinaryRepository } from "./file-binary";

interface Sha256 {
  update(bytes: Uint8Array): unknown;
  digest(encoding: "hex"): string;
}

/** One SQL store owns these proofs. Entries contain digests only, never original bytes. */
export class VerifiedFileRanges {
  private readonly proofs = new Map<string, readonly string[]>();

  constructor(private readonly sha256: () => Sha256) {}

  async read(
    repo: Pick<FileBinaryRepository, "chunks" | "chunkCount">,
    file: FileBinaryDescriptor,
    begin: number,
    end: number,
  ) {
    if (
      !Number.isSafeInteger(begin) ||
      !Number.isSafeInteger(end) ||
      begin < 0 ||
      begin >= end ||
      !Number.isSafeInteger(file.size) ||
      end > file.size ||
      !Number.isSafeInteger(file.chunkSize) ||
      file.chunkSize < 1 ||
      file.chunkSize > 262144
    )
      throw new Error("INVALID_FILE_RANGE");
    const key = JSON.stringify([
      file.workspaceId,
      file.sha256,
      file.size,
      file.chunkSize,
    ]);
    const known = this.proofs.get(key);
    const count = Math.ceil(file.size / file.chunkSize);
    const first = known ? Math.floor(begin / file.chunkSize) : 0;
    const last = known ? Math.floor((end - 1) / file.chunkSize) : count - 1;
    const whole = known ? undefined : this.sha256();
    const manifest: string[] | undefined =
      !known && count <= 1024 ? [] : undefined;
    const parts: BlobPart[] = [];
    // Old uploads can have smaller chunks. Bound both SQL rows and binary bytes.
    const perQuery = Math.min(128, Math.floor(1048576 / file.chunkSize));
    if (!known && (await repo.chunkCount(file.sha256)) !== count)
      throw new Error("FILE_UPLOAD_INCOMPLETE");
    for (let start = first; start <= last; start += perQuery) {
      const stop = Math.min(start + perQuery - 1, last);
      const rows = await repo.chunks(file.sha256, { first: start, last: stop });
      if (rows.length !== stop - start + 1)
        throw new Error("FILE_UPLOAD_INCOMPLETE");
      for (const [offset, row] of rows.entries()) {
        const index = start + offset;
        const position = index * file.chunkSize;
        if (
          row.index !== index ||
          row.bytes.length !== Math.min(file.chunkSize, file.size - position)
        )
          throw new Error("FILE_UPLOAD_INCOMPLETE");
        const hash = this.sha256();
        hash.update(row.bytes);
        const actual = hash.digest("hex");
        if (actual !== row.hash || (known && known[index] !== actual))
          throw new Error("FILE_HASH_MISMATCH");
        whole?.update(row.bytes);
        manifest?.push(actual);
        if (begin < position + row.bytes.length && end > position)
          parts.push(
            new Uint8Array(
              row.bytes.subarray(Math.max(0, begin - position), end - position),
            ),
          );
      }
    }
    if (whole && whole.digest("hex") !== file.sha256)
      throw new Error("FILE_HASH_MISMATCH");
    const proof = known ?? manifest;
    if (proof) {
      this.proofs.delete(key);
      this.proofs.set(key, proof);
      if (this.proofs.size > 16)
        this.proofs.delete(this.proofs.keys().next().value!);
    }
    return new Blob(parts, { type: file.mime });
  }
}
