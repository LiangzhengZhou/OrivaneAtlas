import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ProjectMaterial, ProjectStore } from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";

export function projectStore(
  db: DatabaseSync,
  context: ActorContext,
  guard: () => void,
): ProjectStore {
  const get = async (id: string): Promise<ProjectMaterial> => {
    guard();
    const row = db
      .prepare(
        "SELECT payload FROM project_material WHERE workspace_id=? AND id=?",
      )
      .get(context.workspaceId, id);
    if (!row) throw new DomainError("NOT_FOUND");
    return JSON.parse(String(row.payload));
  };
  return {
    get,
    async list() {
      guard();
      return db
        .prepare(
          "SELECT payload FROM project_material WHERE workspace_id=? ORDER BY id",
        )
        .all(context.workspaceId)
        .map((row) => JSON.parse(String(row.payload)));
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
        db.prepare("INSERT INTO project_material VALUES (?,?,?,?,?,?)").run(
          context.workspaceId,
          material.id,
          material.projectId,
          material.version,
          JSON.stringify(material),
          base64 ?? null,
        );
      else if (
        db
          .prepare(
            "UPDATE project_material SET version=?,payload=? WHERE workspace_id=? AND id=? AND version=?",
          )
          .run(
            material.version,
            JSON.stringify(material),
            context.workspaceId,
            material.id,
            expected,
          ).changes !== 1
      )
        throw new DomainError("VERSION_CONFLICT");
      const eventId = randomUUID();
      db.prepare(
        "INSERT INTO project_material_activity VALUES (?,?,?,?,?,?,?)",
      ).run(
        context.workspaceId,
        eventId,
        material.projectId,
        material.id,
        context.principalId,
        material.deletedAt ? "MATERIAL_DELETED" : "MATERIAL_SAVED",
        material.updatedAt,
      );
      db.prepare("INSERT INTO project_material_outbox VALUES (?,?)").run(
        context.workspaceId,
        eventId,
      );
    },
    async file(id) {
      const material = await get(id);
      if (material.deletedAt || material.kind !== "FILE")
        throw new DomainError("NOT_FOUND");
      return String(
        db
          .prepare(
            "SELECT content FROM project_material WHERE workspace_id=? AND id=?",
          )
          .get(context.workspaceId, id)?.content,
      );
    },
    async activity(projectId) {
      guard();
      return db
        .prepare(
          "SELECT id,project_id projectId,material_id materialId,principal_id principalId,type,occurred_at occurredAt FROM project_material_activity WHERE workspace_id=? AND project_id=? ORDER BY occurred_at DESC,id LIMIT 200",
        )
        .all(context.workspaceId, projectId) as unknown as Awaited<
        ReturnType<ProjectStore["activity"]>
      >;
    },
  };
}
