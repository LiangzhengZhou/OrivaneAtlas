import type { DatabaseSync } from "node:sqlite";
import type { ProjectCategory, WorkTransaction } from "@arclattice/application";
import { DomainError } from "@arclattice/domain";
export function categoryPort(
  db: DatabaseSync,
  workspaceId: string,
  guard: () => void,
): Pick<
  WorkTransaction,
  "categories" | "saveCategory" | "appendCategoryChange"
> {
  return {
    categories: async () => {
      guard();
      const rows = db
        .prepare(
          "SELECT id, workspace_id AS workspaceId, name, icon, color, position, version, created_by AS createdBy, updated_by AS updatedBy, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM project_category WHERE workspace_id=? ORDER BY position,created_at,id",
        )
        .all(workspaceId);
      return rows.map(
        (row) =>
          ({
            ...row,
            projectIds: db
              .prepare(
                "SELECT project_id FROM project_category_member WHERE workspace_id=? AND category_id=? ORDER BY position",
              )
              .all(workspaceId, String(row.id))
              .map((r) => String(r.project_id)),
          }) as unknown as ProjectCategory,
      );
    },
    saveCategory: async (c, expected) => {
      guard();
      if (c.workspaceId !== workspaceId) throw new DomainError("FORBIDDEN");
      if (c.version !== expected + 1) throw new DomainError("VERSION_CONFLICT");
      if (expected === 0) {
        if (
          db
            .prepare(
              "SELECT 1 FROM project_category WHERE workspace_id=? AND id=?",
            )
            .get(workspaceId, c.id)
        )
          throw new DomainError("VERSION_CONFLICT");
        db.prepare(
          "INSERT INTO project_category (workspace_id,id,name,version,created_by,updated_by,created_at,updated_at,deleted_at,icon,color,position) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          workspaceId,
          c.id,
          c.name,
          c.version,
          c.createdBy,
          c.updatedBy,
          c.createdAt,
          c.updatedAt,
          c.deletedAt,
          c.icon ?? "",
          c.color ?? "#7863c5",
          c.position ?? 0,
        );
      } else if (
        db
          .prepare(
            "UPDATE project_category SET name=?,version=?,updated_by=?,updated_at=?,deleted_at=?,icon=?,color=?,position=? WHERE workspace_id=? AND id=? AND version=?",
          )
          .run(
            c.name,
            c.version,
            c.updatedBy,
            c.updatedAt,
            c.deletedAt,
            c.icon ?? "",
            c.color ?? "#7863c5",
            c.position ?? 0,
            workspaceId,
            c.id,
            expected,
          ).changes !== 1
      )
        throw new DomainError("VERSION_CONFLICT");
      db.prepare(
        "DELETE FROM project_category_member WHERE workspace_id=? AND category_id=?",
      ).run(workspaceId, c.id);
      for (const [position, id] of c.projectIds.entries())
        db.prepare("INSERT INTO project_category_member VALUES (?,?,?,?)").run(
          workspaceId,
          c.id,
          id,
          position,
        );
    },
    appendCategoryChange: async (e) => {
      guard();
      if (e.workspaceId !== workspaceId) throw new DomainError("FORBIDDEN");
      db.prepare("INSERT INTO category_activity VALUES (?,?,?,?,?,?)").run(
        workspaceId,
        e.id,
        e.principalId,
        e.categoryId,
        e.version,
        e.occurredAt,
      );
      db.prepare("INSERT INTO category_outbox VALUES (?,?)").run(
        workspaceId,
        e.id,
      );
    },
  };
}
