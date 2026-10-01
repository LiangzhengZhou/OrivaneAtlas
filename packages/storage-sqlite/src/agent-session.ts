import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AgentSession, AgentSessionStore } from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";
export function agentSessionStore(
  db: DatabaseSync,
  actor: ActorContext,
  guard: () => void,
): AgentSessionStore {
  return {
    async list() {
      guard();
      return db
        .prepare(
          "SELECT payload FROM agent_session WHERE workspace_id=? AND principal_id=? ORDER BY id DESC",
        )
        .all(actor.workspaceId, actor.principalId)
        .map((row) => JSON.parse(String(row.payload)) as AgentSession);
    },
    async get(id) {
      guard();
      const row = db
        .prepare(
          "SELECT payload FROM agent_session WHERE workspace_id=? AND principal_id=? AND id=?",
        )
        .get(actor.workspaceId, actor.principalId, id);
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
        db.prepare("INSERT INTO agent_session VALUES (?,?,?,?,?)").run(
          actor.workspaceId,
          session.id,
          actor.principalId,
          session.version,
          JSON.stringify(session),
        );
      else if (
        db
          .prepare(
            "UPDATE agent_session SET version=?,payload=? WHERE workspace_id=? AND principal_id=? AND id=? AND version=?",
          )
          .run(
            session.version,
            JSON.stringify(session),
            actor.workspaceId,
            actor.principalId,
            session.id,
            expected,
          ).changes !== 1
      )
        throw new DomainError("VERSION_CONFLICT");
      const eventId = randomUUID();
      db.prepare("INSERT INTO connected_activity VALUES (?,?,?,?,?,?,?)").run(
        actor.workspaceId,
        eventId,
        session.id,
        actor.principalId,
        "AGENT_SESSION_CHANGED",
        session.version,
        session.updatedAt,
      );
      db.prepare("INSERT INTO connected_outbox VALUES (?,?,?)").run(
        actor.workspaceId,
        eventId,
        "AGENT_SESSION_CHANGED",
      );
    },
  };
}
