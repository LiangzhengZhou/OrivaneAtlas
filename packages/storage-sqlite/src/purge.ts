import type { DatabaseSync } from "node:sqlite";
import type { EntityRef } from "@arclattice/application";

export function purgeRelations(
  db: DatabaseSync,
  workspaceId: string,
  ref: EntityRef,
) {
  db.prepare(
    "DELETE FROM knowledge_link WHERE workspace_id=? AND ((json_extract(payload,'$.from.kind')=? AND json_extract(payload,'$.from.id')=?) OR (json_extract(payload,'$.to.kind')=? AND json_extract(payload,'$.to.id')=?))",
  ).run(workspaceId, ref.kind, ref.id, ref.kind, ref.id);
  db.prepare(
    "DELETE FROM organization WHERE workspace_id=? AND kind=? AND id=?",
  ).run(
    workspaceId,
    ref.kind === "DOCUMENT" || ref.kind === "SPACE" ? "LIBRARY" : ref.kind,
    ref.id,
  );
  const materials = db
    .prepare(
      "SELECT id FROM project_material WHERE workspace_id=? AND (project_id=? OR json_extract(payload,'$.targetId')=?)",
    )
    .all(
      workspaceId,
      ref.kind === "WORK" ? ref.id : "",
      ref.kind === "WORK" ? "" : ref.id,
    );
  for (const material of materials) {
    const id = String(material.id);
    db.prepare(
      "DELETE FROM project_material_outbox WHERE workspace_id=? AND event_id IN (SELECT id FROM project_material_activity WHERE workspace_id=? AND material_id=?)",
    ).run(workspaceId, workspaceId, id);
    db.prepare(
      "DELETE FROM project_material_activity WHERE workspace_id=? AND material_id=?",
    ).run(workspaceId, id);
    db.prepare(
      "DELETE FROM project_knowledge_binding WHERE workspace_id=? AND id=?",
    ).run(workspaceId, id);
    db.prepare(
      "DELETE FROM project_material WHERE workspace_id=? AND id=?",
    ).run(workspaceId, id);
  }
}
