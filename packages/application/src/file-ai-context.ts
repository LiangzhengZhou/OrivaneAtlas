import {
  type ActorContext,
  DomainError,
  type FileExtractionDocument,
  type LibraryFile,
} from "@arclattice/domain";
import type { ContentPolicy } from "./content-policy";
import {
  fileExtractionIndexVersion,
  fileExtractionSearchInput,
  fileExtractionSearchText,
  requireFileExtractionDocument,
} from "./file-extraction";
import type { LibraryFileStore } from "./files";
import type { LibraryStore } from "./library";

export interface FileContextIdentity {
  contentHash: string;
  indexVersion: number;
  locators: string[];
}
export const fileContextLimits = Object.freeze({
  chunks: 3,
  characters: 12000,
});

/** Canonical, bounded citations. Never accepts client-supplied extracted text. */
export function fileContextText(
  document: FileExtractionDocument,
  locators: readonly string[],
): string {
  if (
    !Array.isArray(locators) ||
    !locators.length ||
    locators.length > fileContextLimits.chunks ||
    new Set(locators).size !== locators.length
  )
    throw new DomainError("VALIDATION_ERROR");
  const byLocator = new Map(
    document.chunks.map((chunk) => [chunk.locator, chunk]),
  );
  let characters = 0;
  return locators
    .map((locator) => {
      const chunk = byLocator.get(locator);
      if (!chunk) throw new DomainError("VERSION_CONFLICT");
      characters += chunk.text.length;
      if (characters > fileContextLimits.characters)
        throw new DomainError("VALIDATION_ERROR");
      return `[${chunk.locator}]\n${chunk.text}`;
    })
    .join("\n\n");
}

export async function readFileContextFile(
  actor: ActorContext,
  files: Pick<LibraryFileStore, "get" | "extractions">,
  library: Pick<LibraryStore, "get">,
  id: string,
  version: number,
  scope: string,
  validatePolicy: (entity: {
    id: string;
    workspaceId: string;
    version: number;
    deletedAt: string | null;
    aiPolicy?: ContentPolicy;
  }) => void,
): Promise<LibraryFile> {
  const file = await files.get(id);
  if (file.workspaceId !== actor.workspaceId || file.deletedAt)
    throw new DomainError("NOT_FOUND");
  if (file.version !== version) throw new DomainError("VERSION_CONFLICT");
  if (scope.startsWith("SPACE:") && file.spaceId !== scope.slice(6))
    throw new DomainError("FORBIDDEN");
  validatePolicy(file);
  for (const [parentId, kind] of [
    [file.spaceId, "SPACE"],
    [file.parentDocumentId, "DOCUMENT"],
  ] as const) {
    if (!parentId) continue;
    const parent = await library.get(parentId);
    if (
      parent.workspaceId !== actor.workspaceId ||
      parent.deletedAt ||
      parent.kind !== kind ||
      (kind === "DOCUMENT" && parent.spaceId !== file.spaceId)
    )
      throw new DomainError("NOT_FOUND");
    validatePolicy(parent);
  }
  return file;
}

export async function readFileContextSource(
  actor: ActorContext,
  files: Pick<LibraryFileStore, "get" | "extractions">,
  library: Pick<LibraryStore, "get">,
  id: string,
  version: number,
  scope: string,
  validatePolicy: Parameters<typeof readFileContextFile>[6],
): Promise<{ file: LibraryFile; document: FileExtractionDocument }> {
  const file = await readFileContextFile(
    actor,
    files,
    library,
    id,
    version,
    scope,
    validatePolicy,
  );
  const cached = await files.extractions?.get(actor, file.id);
  if (!cached) throw new DomainError("NOT_FOUND", { field: "fileExtraction" });
  return { file, document: requireFileExtractionDocument(cached, file) };
}

/** Search is performed over canonical derived chunks, not whole binary bodies. */
export async function selectFileContext(
  actorInput: ActorContext,
  files: Pick<LibraryFileStore, "get" | "extractions">,
  library: Pick<LibraryStore, "get">,
  inputValue: { id: string; version: number; query: string; scope: string },
  validatePolicy: Parameters<typeof readFileContextSource>[6],
) {
  const actor = Object.freeze({ ...actorInput });
  const input = Object.freeze({ ...inputValue });
  const { terms } = fileExtractionSearchInput(
    input.query,
    [input.id],
    fileContextLimits.chunks,
  );
  const { file, document } = await readFileContextSource(
    actor,
    files,
    library,
    input.id,
    input.version,
    input.scope,
    validatePolicy,
  );
  const hits = input.query.trim()
    ? await files.extractions?.search?.(
        actor,
        input.query,
        [file.id],
        fileContextLimits.chunks,
      )
    : [];
  const canonical = new Map(
    document.chunks.map((chunk) => [chunk.locator, chunk]),
  );
  const locators = hits?.length
    ? hits.map((hit) => {
        const chunk = canonical.get(hit.locator);
        if (
          !chunk ||
          hit.fileId !== file.id ||
          hit.fileVersion !== file.version ||
          hit.contentHash !== file.contentHash ||
          hit.indexVersion !== fileExtractionIndexVersion ||
          hit.workspaceId !== actor.workspaceId ||
          hit.text !== chunk.text
        )
          throw new DomainError("VERSION_CONFLICT");
        return chunk.locator;
      })
    : document.chunks
        .map((chunk, index) => ({
          chunk,
          index,
          rank: terms.filter((term) =>
            fileExtractionSearchText(chunk.text).includes(term),
          ).length,
        }))
        .sort((a, b) => b.rank - a.rank || a.index - b.index)
        .slice(0, fileContextLimits.chunks)
        .map(({ chunk }) => chunk.locator);
  if (!locators.length)
    throw new DomainError("NOT_FOUND", { field: "fileText" });
  return {
    ref: { kind: "FILE" as const, id: file.id },
    version: file.version,
    title: file.name,
    bodyMd: fileContextText(document, locators),
    file: {
      contentHash: file.contentHash,
      indexVersion: document.indexVersion,
      locators,
    },
  };
}
