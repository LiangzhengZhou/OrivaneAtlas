import { type ActorContext, DomainError } from "@arclattice/domain";
import type { LibraryFileStore } from "./files";
import type { LibraryStore } from "./library";
import type { ProjectStore } from "./project-materials";

export interface ProjectArchiveStores {
  library: Pick<LibraryStore, "list" | "listMetadata" | "get" | "save">;
  files: LibraryFileStore;
  projectMaterials: ProjectStore;
}
export type ProjectArchiveCollection = keyof ProjectArchiveStores;
export interface ProjectArchiveBatch {
  id: string;
  entries: {
    collection: ProjectArchiveCollection;
    id: string;
    version: number;
  }[];
}
export function parseProjectArchiveBatch(value: string): ProjectArchiveBatch {
  let batch: ProjectArchiveBatch;
  try {
    batch = JSON.parse(value);
  } catch {
    throw new DomainError("VALIDATION_ERROR");
  }
  if (
    !batch ||
    typeof batch.id !== "string" ||
    !Array.isArray(batch.entries) ||
    batch.entries.length > 1999 ||
    batch.entries.some(
      (entry) =>
        !entry ||
        !["library", "files", "projectMaterials"].includes(entry.collection) ||
        typeof entry.id !== "string" ||
        !Number.isSafeInteger(entry.version) ||
        entry.version < 1,
    )
  )
    throw new DomainError("VALIDATION_ERROR");
  if (
    new Set(batch.entries.map((entry) => `${entry.collection}:${entry.id}`))
      .size !== batch.entries.length
  )
    throw new DomainError("VALIDATION_ERROR");
  return batch;
}

/** All stores are bound to the enclosing Work transaction. */
export async function changeProjectArchiveResources(
  context: ActorContext,
  stores: ProjectArchiveStores,
  projectId: string,
  batchId: string,
  previousBatch: string | null | undefined,
  archived: boolean,
  now: string,
): Promise<string | null> {
  const scope = <T extends { workspaceId: string }>(entry: T): T => {
    if (entry.workspaceId !== context.workspaceId)
      throw new DomainError("FORBIDDEN");
    return entry;
  };
  if (!archived) {
    if (!previousBatch) return null;
    for (const entry of parseProjectArchiveBatch(previousBatch).entries) {
      const store = stores[entry.collection];
      let current: Awaited<ReturnType<typeof store.get>>;
      try {
        current = scope(await store.get(entry.id));
      } catch (error) {
        if (error instanceof DomainError && error.code === "NOT_FOUND")
          continue;
        throw error;
      }
      // Never undo an independent edit, restore/delete, or purge after this batch.
      if (current.version !== entry.version || !current.deletedAt) continue;
      if (entry.collection === "library") {
        const document = await stores.library.get(entry.id);
        for (const parentId of [document.spaceId, document.parentDocumentId]) {
          if (parentId && scope(await stores.library.get(parentId)).deletedAt)
            throw new DomainError("VERSION_CONFLICT");
        }
      }
      if (entry.collection === "files") {
        const file = await stores.files.get(entry.id);
        for (const parentId of [file.spaceId, file.parentDocumentId]) {
          if (parentId && scope(await stores.library.get(parentId)).deletedAt)
            throw new DomainError("VERSION_CONFLICT");
        }
      }
      const next = {
        ...current,
        deletedAt: null,
        version: current.version + 1,
        updatedAt: now,
        updatedBy: context.principalId,
      };
      await (
        store.save as (value: typeof next, version: number) => Promise<void>
      )(next, current.version);
    }
    return null;
  }
  const materials = (await stores.projectMaterials.list()).filter(
    (entry) => entry.workspaceId === context.workspaceId && !entry.deletedAt,
  );
  const owned = materials.filter(
    (entry) => entry.projectId === projectId && entry.ownership === "OWNED",
  );
  const spaces = new Set(
    owned
      .filter((entry) => entry.kind === "SPACE" && entry.targetId)
      .map((entry) => entry.targetId!),
  );
  const documents = new Set(
    owned
      .filter((entry) => entry.kind === "DOCUMENT")
      .map((entry) => entry.targetId),
  );
  const library = await (stores.library.listMetadata?.() ??
    stores.library.list());
  const selected = library.filter(
    (entry) =>
      entry.workspaceId === context.workspaceId &&
      !entry.deletedAt &&
      (spaces.has(entry.id) ||
        spaces.has(entry.spaceId ?? "") ||
        documents.has(entry.id)),
  );
  const selectedIds = new Set(selected.map((entry) => entry.id));
  if (
    materials.some(
      (entry) =>
        entry.projectId !== projectId &&
        entry.ownership === "OWNED" &&
        entry.targetId &&
        selectedIds.has(entry.targetId),
    ) ||
    library.some(
      (entry) =>
        !entry.deletedAt &&
        entry.parentDocumentId &&
        selectedIds.has(entry.parentDocumentId) &&
        !selectedIds.has(entry.id),
    )
  )
    throw new DomainError("VALIDATION_ERROR");
  const directFiles = new Set(
    owned
      .filter((entry) => entry.kind === "FILE")
      .map((entry) => entry.targetId),
  );
  const files = (await stores.files.list()).filter(
    (entry) =>
      entry.workspaceId === context.workspaceId &&
      !entry.deletedAt &&
      (directFiles.has(entry.id) ||
        spaces.has(entry.spaceId ?? "") ||
        selectedIds.has(entry.parentDocumentId ?? "")),
  );
  if (
    materials.some(
      (entry) =>
        entry.projectId !== projectId &&
        entry.ownership === "OWNED" &&
        entry.kind === "FILE" &&
        files.some((file) => file.id === entry.targetId),
    )
  )
    throw new DomainError("VALIDATION_ERROR");
  const ordered = [] as typeof selected;
  const pending = new Map(selected.map((entry) => [entry.id, entry]));
  while (pending.size) {
    const ready = [...pending.values()].filter(
      (entry) =>
        !pending.has(entry.spaceId ?? "") &&
        !pending.has(entry.parentDocumentId ?? ""),
    );
    if (!ready.length) throw new DomainError("VALIDATION_ERROR");
    for (const entry of ready) {
      ordered.push(entry);
      pending.delete(entry.id);
    }
  }
  const batch: ProjectArchiveBatch = { id: batchId, entries: [] };
  if (ordered.length + files.length + owned.length > 1999)
    throw new DomainError("VALIDATION_ERROR");
  for (const entry of ordered) {
    const current = scope(await stores.library.get(entry.id));
    await stores.library.save(
      {
        ...current,
        deletedAt: now,
        updatedAt: now,
        updatedBy: context.principalId,
        version: current.version + 1,
      },
      current.version,
    );
    batch.entries.push({
      collection: "library",
      id: current.id,
      version: current.version + 1,
    });
  }
  for (const entry of files) {
    await stores.files.save(
      {
        ...entry,
        deletedAt: now,
        updatedAt: now,
        updatedBy: context.principalId,
        version: entry.version + 1,
      },
      entry.version,
    );
    batch.entries.push({
      collection: "files",
      id: entry.id,
      version: entry.version + 1,
    });
  }
  for (const entry of owned) {
    await stores.projectMaterials.save(
      {
        ...entry,
        deletedAt: now,
        updatedAt: now,
        updatedBy: context.principalId,
        version: entry.version + 1,
      },
      entry.version,
    );
    batch.entries.push({
      collection: "projectMaterials",
      id: entry.id,
      version: entry.version + 1,
    });
  }
  return JSON.stringify(batch);
}
