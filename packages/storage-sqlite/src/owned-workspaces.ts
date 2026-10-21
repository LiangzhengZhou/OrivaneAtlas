import type { DatabaseSync } from "node:sqlite";
import {
  type OwnedWorkspace,
  type OwnedWorkspaceCreate,
  requireOwnedWorkspaceCreate,
} from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";

/** Caller holds one guarded SQLite transaction, including account reauthorization. */
export function ownedWorkspaceDirectory(
  db: DatabaseSync,
  actorInput: ActorContext,
  guard: () => void,
) {
  const actor = { ...actorInput };
  const requireOwner = () => {
    guard();
    if (
      !db
        .prepare(
          "SELECT 1 FROM workspace_principal wp JOIN principal p ON p.id=wp.principal_id WHERE wp.workspace_id=? AND wp.principal_id=? AND p.kind='USER'",
        )
        .get(actor.workspaceId, actor.principalId)
    )
      throw new DomainError("FORBIDDEN");
  };
  const list = (): OwnedWorkspace[] => {
    requireOwner();
    return db
      .prepare(
        "SELECT w.id,w.name,o.principal_id AS ownerPrincipalId,o.version,o.created_at AS createdAt FROM workspace_owner o JOIN workspace w ON w.id=o.workspace_id WHERE o.principal_id=? ORDER BY o.created_at,w.id",
      )
      .all(actor.principalId) as unknown as OwnedWorkspace[];
  };
  return {
    list,
    create(source: OwnedWorkspaceCreate): OwnedWorkspace {
      requireOwner();
      const input = requireOwnedWorkspaceCreate(source);
      if (db.prepare("SELECT 1 FROM workspace WHERE id=?").get(input.id))
        throw new DomainError("VERSION_CONFLICT");
      db.prepare("INSERT INTO workspace(id,name) VALUES (?,?)").run(
        input.id,
        input.name,
      );
      db.prepare(
        "INSERT INTO workspace_principal(workspace_id,principal_id) VALUES (?,?)",
      ).run(input.id, actor.principalId);
      db.prepare(
        "INSERT INTO workspace_owner(workspace_id,principal_id,version,created_at) VALUES (?,?,1,?)",
      ).run(input.id, actor.principalId, input.createdAt);
      db.prepare(
        "INSERT INTO connected_activity(workspace_id,id,entity_id,principal_id,type,version,occurred_at) VALUES (?,?,?,?,'WORKSPACE_CREATED',1,?)",
      ).run(
        input.id,
        input.activityId,
        input.id,
        actor.principalId,
        input.createdAt,
      );
      db.prepare(
        "INSERT INTO connected_outbox(workspace_id,activity_id,type) VALUES (?,?,'WORKSPACE_CREATED')",
      ).run(input.id, input.activityId);
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
