import type { ProjectCategory, WorkTransaction } from "@arclattice/application";
import { DomainError } from "@arclattice/domain";
import type { PoolClient } from "pg";
export function categoryPort(
  client: PoolClient,
  workspaceId: string,
  schedule: <T>(operation: () => Promise<T>) => Promise<T>,
): Pick<
  WorkTransaction,
  "categories" | "saveCategory" | "appendCategoryChange"
> {
  return {
    categories: () =>
      schedule(async () => {
        const rows = (
          await client.query(
            'SELECT id, workspace_id AS "workspaceId", name, icon, color, position, version, created_by AS "createdBy", updated_by AS "updatedBy", created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt" FROM arclattice.project_category WHERE workspace_id=$1 ORDER BY position,created_at,id',
            [workspaceId],
          )
        ).rows;
        const members = (
          await client.query(
            "SELECT category_id,project_id FROM arclattice.project_category_member WHERE workspace_id=$1 ORDER BY position",
            [workspaceId],
          )
        ).rows;
        return rows.map(
          (row) =>
            ({
              ...row,
              projectIds: members
                .filter((m) => m.category_id === row.id)
                .map((m) => m.project_id),
            }) as ProjectCategory,
        );
      }),
    saveCategory: (category, expected) => {
      const c = structuredClone(category);
      return schedule(async () => {
        if (c.workspaceId !== workspaceId) throw new DomainError("FORBIDDEN");
        if (c.version !== expected + 1)
          throw new DomainError("VERSION_CONFLICT");
        if (expected === 0) {
          const result = await client.query(
            "INSERT INTO arclattice.project_category (workspace_id,id,name,version,created_by,updated_by,created_at,updated_at,deleted_at,icon,color,position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING",
            [
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
            ],
          );
          if (result.rowCount !== 1) throw new DomainError("VERSION_CONFLICT");
        } else if (
          (
            await client.query(
              "UPDATE arclattice.project_category SET name=$1,version=$2,updated_by=$3,updated_at=$4,deleted_at=$5,icon=$9,color=$10,position=$11 WHERE workspace_id=$6 AND id=$7 AND version=$8",
              [
                c.name,
                c.version,
                c.updatedBy,
                c.updatedAt,
                c.deletedAt,
                workspaceId,
                c.id,
                expected,
                c.icon ?? "",
                c.color ?? "#7863c5",
                c.position ?? 0,
              ],
            )
          ).rowCount !== 1
        )
          throw new DomainError("VERSION_CONFLICT");
        await client.query(
          "DELETE FROM arclattice.project_category_member WHERE workspace_id=$1 AND category_id=$2",
          [workspaceId, c.id],
        );
        for (const [position, id] of c.projectIds.entries())
          await client.query(
            "INSERT INTO arclattice.project_category_member VALUES ($1,$2,$3,$4)",
            [workspaceId, c.id, id, position],
          );
      });
    },
    appendCategoryChange: (event) => {
      const e = structuredClone(event);
      return schedule(async () => {
        if (e.workspaceId !== workspaceId) throw new DomainError("FORBIDDEN");
        await client.query(
          "INSERT INTO arclattice.category_activity VALUES ($1,$2,$3,$4,$5,$6)",
          [
            workspaceId,
            e.id,
            e.principalId,
            e.categoryId,
            e.version,
            e.occurredAt,
          ],
        );
        await client.query(
          "INSERT INTO arclattice.category_outbox VALUES ($1,$2)",
          [workspaceId, e.id],
        );
      });
    },
  };
}
