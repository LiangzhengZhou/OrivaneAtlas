import {
  type OwnedWorkspace,
  type OwnedWorkspaceCreate,
  type OwnedWorkspaceDirectory,
  requireOwnedWorkspaceCreate,
} from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";
import type { PoolClient } from "pg";
/** Caller owns one transaction and an authenticated actor; no independent commit. */
export function ownedWorkspaceDirectory(
  client: PoolClient,
  actorInput: ActorContext,
  guard: () => void,
): OwnedWorkspaceDirectory {
  const actor = { ...actorInput };
  const requireOwner = async () => {
    guard();
    const row = await client.query(
      "SELECT 1 FROM arclattice.workspace_principal wp JOIN arclattice.principal p ON p.id=wp.principal_id WHERE wp.workspace_id=$1 AND wp.principal_id=$2 AND p.kind='USER'",
      [actor.workspaceId, actor.principalId],
    );
    guard();
    if (!row.rowCount) throw new DomainError("FORBIDDEN");
  };
  return {
    async list() {
      await requireOwner();
      const result = await client.query(
        'SELECT w.id,w.name,o.principal_id AS "ownerPrincipalId",o.version,o.created_at AS "createdAt" FROM arclattice.workspace_owner o JOIN arclattice.workspace w ON w.id=o.workspace_id WHERE o.principal_id=$1 ORDER BY o.created_at,w.id',
        [actor.principalId],
      );
      guard();
      return result.rows.map((row) => ({
        ...row,
        version: Number(row.version),
      })) as OwnedWorkspace[];
    },
    async create(source: OwnedWorkspaceCreate) {
      await requireOwner();
      const input = requireOwnedWorkspaceCreate(source);
      if (
        (
          await client.query("SELECT 1 FROM arclattice.workspace WHERE id=$1", [
            input.id,
          ])
        ).rowCount
      )
        throw new DomainError("VERSION_CONFLICT");
      await client.query(
        "INSERT INTO arclattice.workspace(id,name) VALUES ($1,$2)",
        [input.id, input.name],
      );
      await client.query(
        "INSERT INTO arclattice.workspace_principal(workspace_id,principal_id) VALUES ($1,$2)",
        [input.id, actor.principalId],
      );
      await client.query(
        "INSERT INTO arclattice.workspace_owner(workspace_id,principal_id,version,created_at) VALUES ($1,$2,1,$3)",
        [input.id, actor.principalId, input.createdAt],
      );
      await client.query(
        "INSERT INTO arclattice.connected_activity(workspace_id,id,entity_id,principal_id,type,version,occurred_at) VALUES ($1,$2,$3,$4,'WORKSPACE_CREATED',1,$5)",
        [
          input.id,
          input.activityId,
          input.id,
          actor.principalId,
          input.createdAt,
        ],
      );
      await client.query(
        "INSERT INTO arclattice.connected_outbox(workspace_id,activity_id,type) VALUES ($1,$2,'WORKSPACE_CREATED')",
        [input.id, input.activityId],
      );
      guard();
      return {
        id: input.id,
        name: input.name,
        ownerPrincipalId: actor.principalId,
        version: 1,
        createdAt: input.createdAt,
      };
    },
  };
}
