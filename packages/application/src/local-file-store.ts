import type { LibraryFile } from "@arclattice/domain";
import type { FileExtractionStore } from "./file-extraction";
import { type LibraryFileStore, requireOriginalFileIdentity } from "./files";
import type { LocalRecordRepository } from "./local-record-repository";

export class LocalFileStore implements LibraryFileStore {
  readonly extractions?: FileExtractionStore;
  constructor(
    private readonly records: LocalRecordRepository,
    extractions?: FileExtractionStore,
  ) {
    if (extractions) this.extractions = extractions;
  }
  list() {
    return this.records.list<LibraryFile>("files");
  }
  get(id: string) {
    return this.records.get<LibraryFile>("files", id);
  }
  async save(file: LibraryFile, expectedVersion: number) {
    if (expectedVersion > 0) {
      const old = await this.get(file.id);
      requireOriginalFileIdentity(old, file);
    }
    return this.records.save(
      "files",
      file.id,
      file,
      expectedVersion,
      "FILE_CHANGED",
    );
  }
}
