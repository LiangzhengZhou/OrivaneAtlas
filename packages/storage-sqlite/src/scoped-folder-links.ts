import type { DatabaseSync } from "node:sqlite";
import type {
  ProjectFolderLink,
  ProjectFolderLinkStore,
  ScopedFolderTargetPort,
  SpaceFolderLink,
  SpaceFolderLinkStore,
} from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";

const decode = <T>(value: string): T => JSON.parse(value) as T;

export function spaceFolderLinkStore(
  db: DatabaseSync,
  context: ActorContext,
  guard: () => void,
): SpaceFolderLinkStore {
  return {
    async list() {
      guard();
      return db
        .prepare(
          "SELECT payload FROM space_folder_link WHERE workspace_id=? ORDER BY id",
        )
        .all(context.workspaceId)
        .map((row) => decode<SpaceFolderLink>(String(row.payload)));
    },
    async findActive(spaceId, folderId) {
      guard();
      const row = db
        .prepare(
          "SELECT payload FROM space_folder_link WHERE workspace_id=? AND space_id=? AND folder_id=? AND deleted_at IS NULL",
        )
        .get(context.workspaceId, spaceId, folderId);
      return row ? decode<SpaceFolderLink>(String(row.payload)) : null;
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
      try {
        if (expectedVersion === 0)
          db.prepare(
            "INSERT INTO space_folder_link(workspace_id,id,space_id,folder_id,version,deleted_at,payload) VALUES(?,?,?,?,?,?,?)",
          ).run(
            context.workspaceId,
            value.id,
            value.spaceId,
            value.folderId,
            value.version,
            value.deletedAt,
            JSON.stringify(value),
          );
        else if (
          db
            .prepare(
              "UPDATE space_folder_link SET version=?,deleted_at=?,payload=? WHERE workspace_id=? AND id=? AND version=?",
            )
            .run(
              value.version,
              value.deletedAt,
              JSON.stringify(value),
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

export function projectFolderLinkStore(
  db: DatabaseSync,
  context: ActorContext,
  guard: () => void,
): ProjectFolderLinkStore {
  return {
    async list() {
      guard();
      return db
        .prepare(
          "SELECT payload FROM project_folder_link WHERE workspace_id=? ORDER BY id",
        )
        .all(context.workspaceId)
        .map((row) => decode<ProjectFolderLink>(String(row.payload)));
    },
    async findActive(projectId, folderId) {
      guard();
      const row = db
        .prepare(
          "SELECT payload FROM project_folder_link WHERE workspace_id=? AND project_id=? AND folder_id=? AND deleted_at IS NULL",
        )
        .get(context.workspaceId, projectId, folderId);
      return row ? decode<ProjectFolderLink>(String(row.payload)) : null;
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
      try {
        if (expectedVersion === 0)
          db.prepare(
            "INSERT INTO project_folder_link(workspace_id,id,project_id,folder_id,version,deleted_at,payload) VALUES(?,?,?,?,?,?,?)",
          ).run(
            context.workspaceId,
            value.id,
            value.projectId,
            value.folderId,
            value.version,
            value.deletedAt,
            JSON.stringify(value),
          );
        else if (
          db
            .prepare(
              "UPDATE project_folder_link SET version=?,deleted_at=?,payload=? WHERE workspace_id=? AND id=? AND version=?",
            )
            .run(
              value.version,
              value.deletedAt,
              JSON.stringify(value),
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

export function scopedFolderTargets(
  db: DatabaseSync,
  context: ActorContext,
  guard: () => void,
): ScopedFolderTargetPort {
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
    async space(spaceId) {
      return exists(
        "SELECT 1 FROM library_entry WHERE workspace_id=? AND id=? AND json_extract(payload,'$.kind')='SPACE' AND json_extract(payload,'$.deletedAt') IS NULL",
        spaceId,
      );
    },
    async project(projectId) {
      return exists(
        "SELECT 1 FROM work_item WHERE workspace_id=? AND id=? AND type='PROJECT' AND deleted_at IS NULL",
        projectId,
      );
    },
  };
}
