import { randomUUID } from "node:crypto";
import type { AgentSession, AgentSessionStore } from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";
import type { PoolClient } from "pg";
export function agentSessionStore(
  client: PoolClient,
  actor: ActorContext,
  guard: () => void,
): AgentSessionStore {
  return {
    async list() {
      guard();
      return (
        await client.query(
          "SELECT payload FROM arclattice.agent_session WHERE workspace_id=$1 AND principal_id=$2 ORDER BY id DESC",
          [actor.workspaceId, actor.principalId],
        )
      ).rows.map((row) => JSON.parse(String(row.payload)) as AgentSession);
    },
    async get(id) {
      guard();
      const row = (
        await client.query(
          "SELECT payload FROM arclattice.agent_session WHERE workspace_id=$1 AND principal_id=$2 AND id=$3",
          [actor.workspaceId, actor.principalId, id],
        )
      ).rows[0];
      if (!row) throw new DomainError("NOT_FOUND");
      return JSON.parse(String(row.payload));
    },
    async save(session, expected) {
      guard();
      if (
        session.workspaceId !== actor.workspaceId ||
        session.createdBy !== actor.principalId
      )
        throw new DomainError("FORBIDDEN");
      if (
        !Number.isSafeInteger(expected) ||
        expected < 0 ||
        session.version !== expected + 1
      )
        throw new DomainError("VERSION_CONFLICT");
      if (expected === 0)
        await client.query(
          "INSERT INTO arclattice.agent_session VALUES ($1,$2,$3,$4,$5)",
          [
            actor.workspaceId,
            session.id,
            actor.principalId,
            session.version,
            JSON.stringify(session),
          ],
        );
      else if (
        (
          await client.query(
            "UPDATE arclattice.agent_session SET version=$1,payload=$2 WHERE workspace_id=$3 AND principal_id=$4 AND id=$5 AND version=$6",
            [
              session.version,
              JSON.stringify(session),
              actor.workspaceId,
              actor.principalId,
              session.id,
              expected,
            ],
          )
        ).rowCount !== 1
      )
        throw new DomainError("VERSION_CONFLICT");
      const eventId = randomUUID();
      await client.query(
        "INSERT INTO arclattice.knowledge_activity VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [
          actor.workspaceId,
          eventId,
          session.id,
          actor.principalId,
          "AGENT_SESSION_CHANGED",
          session.version,
          session.updatedAt,
        ],
      );
      await client.query(
        "INSERT INTO arclattice.knowledge_outbox VALUES ($1,$2,$3)",
        [actor.workspaceId, eventId, "AGENT_SESSION_CHANGED"],
      );
    },
  };
}
