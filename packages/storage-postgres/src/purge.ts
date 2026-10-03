import type { EntityRef } from "@arclattice/application";
import type { PoolClient } from "pg";

export async function purgeRelations(
  client: PoolClient,
  workspaceId: string,
  ref: EntityRef,
) {
  await client.query(
    "DELETE FROM arclattice.knowledge_link WHERE workspace_id=$1 AND ((payload::jsonb->'from'->>'kind'=$2 AND payload::jsonb->'from'->>'id'=$3) OR (payload::jsonb->'to'->>'kind'=$2 AND payload::jsonb->'to'->>'id'=$3))",
    [workspaceId, ref.kind, ref.id],
  );
  await client.query(
    "DELETE FROM arclattice.organization WHERE workspace_id=$1 AND kind=$2 AND id=$3",
    [
      workspaceId,
      ref.kind === "DOCUMENT" || ref.kind === "SPACE" ? "LIBRARY" : ref.kind,
      ref.id,
    ],
  );
  const materials = (
    await client.query(
      "SELECT id FROM arclattice.project_material WHERE workspace_id=$1 AND (project_id=$2 OR payload::jsonb->>'targetId'=$3)",
      [
        workspaceId,
        ref.kind === "WORK" ? ref.id : "",
        ref.kind === "WORK" ? "" : ref.id,
      ],
    )
  ).rows;
  for (const material of materials) {
    await client.query(
      "DELETE FROM arclattice.project_material_outbox WHERE workspace_id=$1 AND activity_id IN (SELECT id FROM arclattice.project_material_activity WHERE workspace_id=$1 AND material_id=$2)",
      [workspaceId, material.id],
    );
    await client.query(
      "DELETE FROM arclattice.project_material_activity WHERE workspace_id=$1 AND material_id=$2",
      [workspaceId, material.id],
    );
    await client.query(
      "DELETE FROM arclattice.project_knowledge_binding WHERE workspace_id=$1 AND id=$2",
      [workspaceId, material.id],
    );
    await client.query(
      "DELETE FROM arclattice.project_material WHERE workspace_id=$1 AND id=$2",
      [workspaceId, material.id],
    );
  }
}
