import type { FileExtractionDocument } from "@arclattice/domain";
import {
  FileExtractionError,
  fileExtractionLimits,
  fileExtractionSearchText,
  requireFileExtractionDocument,
} from "./file-extraction";
import { localSearchGrams } from "./local-search";

export interface FileSearchRow {
  readonly locator: string;
  readonly text: string;
  readonly grams: readonly string[];
}
export interface FileSearchIndexBuilder {
  build(document: FileExtractionDocument): Promise<readonly FileSearchRow[]>;
}
/** Pure index preparation can run in a worker; publication stays inside the source-guarded transaction. */
export function fileSearchRows(
  document: FileExtractionDocument,
): FileSearchRow[] {
  requireFileExtractionDocument(document, {
    id: document.fileId,
    workspaceId: document.workspaceId,
    version: document.fileVersion,
    contentHash: document.contentHash,
  });
  let characters = 0;
  return document.chunks.map((chunk) => {
    const text = fileExtractionSearchText(
      (chunk.title ?? "") + " " + chunk.text,
    );
    characters += text.length;
    if (characters > fileExtractionLimits.characters * 4)
      throw new FileExtractionError("RESOURCE_LIMIT");
    return { locator: chunk.locator, text, grams: localSearchGrams(text) };
  });
}
