import { DomainError } from "@arclattice/domain";
import type {
  FolderLink,
  FolderLinkStore,
  FolderLinkTargetKind,
  FolderLinkTargetPort,
} from "./folder-links";
import type { WorkTransaction } from "./index";
import type { LocalRecordRepository } from "./local-record-repository";
import type {
  ProjectFolderLink,
  ProjectFolderLinkStore,
  ScopedFolderTargetPort,
  SpaceFolderLink,
  SpaceFolderLinkStore,
} from "./scoped-folder-links";

const active = <T extends { deletedAt: string | null }>(rows: T[]) =>
  rows.filter((row) => row.deletedAt === null);

/** Local replicas store link collections with the same versioned record port. */
export function localFolderLinkStore(
  records: LocalRecordRepository,
): FolderLinkStore {
  return {
    list: () => records.list<FolderLink>("folderLinks"),
    async findActive(folderId, targetKind, targetId) {
      return (
        active(await records.list<FolderLink>("folderLinks")).find(
          (link) =>
            link.folderId === folderId &&
            link.targetKind === targetKind &&
            link.targetId === targetId,
        ) ?? null
      );
    },
    save: (value, expected) =>
      records.save("folderLinks", value.id, value, expected, "FOLDER_LINK"),
  };
}

export function localSpaceFolderLinkStore(
  records: LocalRecordRepository,
): SpaceFolderLinkStore {
  return {
    list: () => records.list<SpaceFolderLink>("spaceFolderLinks"),
    async findActive(spaceId, folderId) {
      return (
        active(await records.list<SpaceFolderLink>("spaceFolderLinks")).find(
          (link) => link.spaceId === spaceId && link.folderId === folderId,
        ) ?? null
      );
    },
    save: (value, expected) =>
      records.save(
        "spaceFolderLinks",
        value.id,
        value,
        expected,
        "SPACE_FOLDER_LINK",
      ),
  };
}

export function localProjectFolderLinkStore(
  records: LocalRecordRepository,
): ProjectFolderLinkStore {
  return {
    list: () => records.list<ProjectFolderLink>("projectFolderLinks"),
    async findActive(projectId, folderId) {
      return (
        active(
          await records.list<ProjectFolderLink>("projectFolderLinks"),
        ).find(
          (link) => link.projectId === projectId && link.folderId === folderId,
        ) ?? null
      );
    },
    save: (value, expected) =>
      records.save(
        "projectFolderLinks",
        value.id,
        value,
        expected,
        "PROJECT_FOLDER_LINK",
      ),
  };
}

export function localFolderLinkTargets(
  tx: Pick<WorkTransaction, "organizations" | "workspaceEntity">,
  records: Pick<LocalRecordRepository, "get">,
): FolderLinkTargetPort & ScopedFolderTargetPort {
  const folder = async (folderId: string) => {
    const value = (await tx.organizations()).find(
      (entry) => entry.kind === "FOLDER" && entry.id === folderId,
    );
    if (!value) return null;
    return {
      archived: value.archived,
      scope: value.scope === "GENERAL" ? "GENERAL" : "NOTE",
    };
  };
  const recordAlive = async (
    collection: string,
    id: string,
    kind?: "DOCUMENT" | "SPACE",
  ) => {
    try {
      const value = await records.get<{
        kind?: string;
        deletedAt?: string | null;
      }>(collection, id);
      return !value.deletedAt && (!kind || value.kind === kind);
    } catch (cause) {
      if (cause instanceof DomainError && cause.code === "NOT_FOUND")
        return false;
      throw cause;
    }
  };
  return {
    folder,
    async target(kind: FolderLinkTargetKind, id: string) {
      if (kind === "NOTE") return recordAlive("notes", id);
      if (kind === "FILE") return recordAlive("files", id);
      if (kind === "DOCUMENT") return recordAlive("library", id, "DOCUMENT");
      const value = (await tx.workspaceEntity("items", id)) as {
        type?: string;
        deletedAt?: string | null;
      } | null;
      return value?.type === "PROJECT" && !value.deletedAt;
    },
    space: (id) => recordAlive("library", id, "SPACE"),
    async project(id) {
      const value = (await tx.workspaceEntity("items", id)) as {
        type?: string;
        deletedAt?: string | null;
      } | null;
      return value?.type === "PROJECT" && !value.deletedAt;
    },
  };
}
