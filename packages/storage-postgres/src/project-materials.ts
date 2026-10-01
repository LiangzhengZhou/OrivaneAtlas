import { randomUUID } from "node:crypto";
import type { ProjectMaterial, ProjectStore } from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";
import type { PoolClient } from "pg";

export function projectStore(
  client: PoolClient,
  context: ActorContext,
  guard: () => void,
): ProjectStore {
  const get = async (id: string): Promise<ProjectMaterial> => {
    guard();
    const row = (
      await client.query(
        "SELECT payload FROM arclattice.project_material WHERE workspace_id=$1 AND id=$2",
        [context.workspaceId, id],
      )
    ).rows[0];
    if (!row) throw new DomainError("NOT_FOUND");
    return JSON.parse(String(row.payload));
  };
  return {
    get,
    async list() {
      guard();
      return (
        await client.query(
          "SELECT payload FROM arclattice.project_material WHERE workspace_id=$1 ORDER BY id",
          [context.workspaceId],
        )
      ).rows.map((row) => JSON.parse(String(row.payload)) as ProjectMaterial);
    },
    async save(material, expected, base64) {
      guard();
      if (
        material.workspaceId !== context.workspaceId ||
        material.updatedBy !== context.principalId
      )
        throw new DomainError("FORBIDDEN");
      if (
        !Number.isSafeInteger(expected) ||
        expected < 0 ||
        material.version !== expected + 1
      )
        throw new DomainError("VERSION_CONFLICT");
      if (
        base64 !== undefined &&
        Buffer.from(base64, "base64").toString("base64") !== base64
      )
        throw new DomainError("VALIDATION_ERROR");
      if (expected === 0)
        await client.query(
          "INSERT INTO arclattice.project_material VALUES ($1,$2,$3,$4,$5,$6)",
          [
            context.workspaceId,
            material.id,
            material.projectId,
            material.version,
            JSON.stringify(material),
            base64 ?? null,
          ],
        );
      else if (
        (
          await client.query(
            "UPDATE arclattice.project_material SET version=$1,payload=$2 WHERE workspace_id=$3 AND id=$4 AND version=$5",
            [
              material.version,
              JSON.stringify(material),
              context.workspaceId,
              material.id,
              expected,
            ],
          )
        ).rowCount !== 1
      )
        throw new DomainError("VERSION_CONFLICT");
      await client.query(
        "DELETE FROM arclattice.project_knowledge_binding WHERE workspace_id=$1 AND id=$2",
        [context.workspaceId, material.id],
      );
      if (material.kind === "SPACE" && material.targetId && !material.deletedAt)
        await client.query(
          "INSERT INTO arclattice.project_knowledge_binding VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            context.workspaceId,
            material.id,
            material.projectId,
            material.targetId,
            material.ownership,
            material.role ??
              (material.ownership === "OWNED" ? "PRIMARY" : "REFERENCE"),
            material.inheritToChildren ?? false,
            material.version,
            material.updatedBy,
            material.updatedAt,
          ],
        );
      const eventId = randomUUID();
      await client.query(
        "INSERT INTO arclattice.project_material_activity VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [
          context.workspaceId,
          eventId,
          material.projectId,
          material.id,
          context.principalId,
          material.deletedAt ? "MATERIAL_DELETED" : "MATERIAL_SAVED",
          material.updatedAt,
        ],
      );
      await client.query(
        "INSERT INTO arclattice.project_material_outbox VALUES ($1,$2)",
        [context.workspaceId, eventId],
      );
    },
    async file(id) {
      const material = await get(id);
      if (material.deletedAt || material.kind !== "FILE")
        throw new DomainError("NOT_FOUND");
      return String(
        (
          await client.query(
            "SELECT content FROM arclattice.project_material WHERE workspace_id=$1 AND id=$2",
            [context.workspaceId, id],
          )
        ).rows[0]?.content,
      );
    },
    async activity(projectId) {
      guard();
      return (
        await client.query(
          'SELECT id,project_id "projectId",material_id "materialId",principal_id "principalId",type,occurred_at "occurredAt" FROM arclattice.project_material_activity WHERE workspace_id=$1 AND project_id=$2 ORDER BY occurred_at DESC,id LIMIT 200',
          [context.workspaceId, projectId],
        )
      ).rows.map((row) => ({
        id: String(row.id),
        projectId: String(row.projectId),
        materialId: String(row.materialId),
        principalId: String(row.principalId),
        type: String(row.type),
        occurredAt: new Date(String(row.occurredAt)).toISOString(),
      }));
    },
  };
}
