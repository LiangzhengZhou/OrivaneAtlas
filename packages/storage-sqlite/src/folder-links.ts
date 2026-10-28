import type { DatabaseSync } from "node:sqlite";
import type {
  FolderLink,
  FolderLinkStore,
  FolderLinkTargetKind,
  FolderLinkTargetPort,
} from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";

const decode = (value: string): FolderLink => JSON.parse(value) as FolderLink;

export function folderLinkStore(
  db: DatabaseSync,
  context: ActorContext,
  guard: () => void,
): FolderLinkStore {
  return {
    async list() {
      guard();
      return db
        .prepare(
          "SELECT payload FROM folder_link WHERE workspace_id=? ORDER BY id",
        )
        .all(context.workspaceId)
        .map((row) => decode(String(row.payload)));
    },
    async findActive(folderId, targetKind, targetId) {
      guard();
      const row = db
        .prepare(
          "SELECT payload FROM folder_link WHERE workspace_id=? AND folder_id=? AND target_kind=? AND target_id=? AND deleted_at IS NULL",
        )
        .get(context.workspaceId, folderId, targetKind, targetId);
      return row ? decode(String(row.payload)) : null;
    },
    async save(value, expectedVersion) {
      guard();
      if (
        value.workspaceId !== context.workspaceId ||
        value.updatedBy !== context.principalId
      )
        throw new DomainError("FORBIDDEN");
      if (
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 0 ||
        value.version !== expectedVersion + 1
      )
        throw new DomainError("VERSION_CONFLICT");
      const payload = JSON.stringify(value);
      try {
        if (expectedVersion === 0) {
          db.prepare(
            "INSERT INTO folder_link(workspace_id,id,folder_id,target_kind,target_id,version,deleted_at,payload) VALUES(?,?,?,?,?,?,?,?)",
          ).run(
            context.workspaceId,
            value.id,
            value.folderId,
            value.targetKind,
            value.targetId,
            value.version,
            value.deletedAt,
            payload,
          );
        } else if (
          db
            .prepare(
              "UPDATE folder_link SET version=?,deleted_at=?,payload=? WHERE workspace_id=? AND id=? AND version=?",
            )
            .run(
              value.version,
              value.deletedAt,
              payload,
              context.workspaceId,
              value.id,
              expectedVersion,
            ).changes !== 1
        )
          throw new DomainError("VERSION_CONFLICT");
      } catch (error) {
        if (error instanceof DomainError) throw error;
        if (
          error instanceof Error &&
          /UNIQUE constraint failed/i.test(error.message)
        )
          throw new DomainError("VERSION_CONFLICT");
        throw error;
      }
    },
  };
}

export function folderLinkTargets(
  db: DatabaseSync,
  context: ActorContext,
  guard: () => void,
): FolderLinkTargetPort {
  const exists = (sql: string, ...params: string[]) => {
    guard();
    return !!db.prepare(sql).get(context.workspaceId, ...params);
  };
  return {
    async folder(folderId) {
      guard();
      const row = db
        .prepare(
          "SELECT payload,scope FROM organization WHERE workspace_id=? AND kind='FOLDER' AND id=?",
        )
        .get(context.workspaceId, folderId);
      if (!row) return null;
      const payload = JSON.parse(String(row.payload)) as { archived?: boolean };
      return {
        archived: payload.archived === true,
        scope: row.scope === "GENERAL" ? "GENERAL" : "NOTE",
      };
    },
    async target(kind: FolderLinkTargetKind, id: string) {
      switch (kind) {
        case "NOTE":
          return exists(
            "SELECT 1 FROM notebook WHERE workspace_id=? AND id=? AND deleted_at IS NULL",
            id,
          );
        case "DOCUMENT":
        case "SPACE":
          return exists(
            "SELECT 1 FROM library_entry WHERE workspace_id=? AND id=? AND json_extract(payload,'$.kind')=? AND json_extract(payload,'$.deletedAt') IS NULL",
            id,
            kind,
          );
        case "FILE":
          return exists(
            "SELECT 1 FROM library_file WHERE workspace_id=? AND id=? AND json_extract(payload,'$.deletedAt') IS NULL",
            id,
          );
        case "PROJECT":
          return exists(
            "SELECT 1 FROM work_item WHERE workspace_id=? AND id=? AND type='PROJECT' AND deleted_at IS NULL",
            id,
          );
      }
    },
  };
}
