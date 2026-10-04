import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  AgentSession,
  AgentSessionStore,
  AgentSessionSummary,
} from "@arclattice/application";
import { agentSessionSummary } from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";
export function agentSessionStore(
  db: DatabaseSync,
  actor: ActorContext,
  guard: () => void,
): AgentSessionStore {
  return {
    async summaries() {
      guard();
      return db
        .prepare(
          `SELECT summary FROM agent_session_metadata WHERE workspace_id=? AND principal_id=? AND deleted_at IS NULL ORDER BY updated_at DESC,id DESC`,
        )
        .all(actor.workspaceId, actor.principalId)
        .map((row) => JSON.parse(String(row.summary)) as AgentSessionSummary);
    },
    async page(id, before, limit) {
      guard();
      const row = db
        .prepare(
          `SELECT metadata,message_count AS count FROM agent_session_metadata WHERE workspace_id=? AND principal_id=? AND id=?`,
        )
        .get(actor.workspaceId, actor.principalId, id);
      if (!row) throw new DomainError("NOT_FOUND");
      const end = Math.min(before ?? Number(row.count), Number(row.count)),
        start = Math.max(0, end - limit);
      const messages = db
        .prepare(
          `SELECT payload AS value FROM agent_session_message WHERE workspace_id=? AND session_id=? AND ordinal>=? AND ordinal<? ORDER BY ordinal`,
        )
        .all(actor.workspaceId, id, start, end)
        .map((message) => JSON.parse(String(message.value)));
      return {
        session: { ...JSON.parse(String(row.metadata)), messages },
        before: start,
        hasMore: start > 0,
      };
    },

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
      const { messages, ...metadata } = session;
      const existingCount = Number(
        db
          .prepare(
            "SELECT message_count FROM agent_session_metadata WHERE workspace_id=? AND id=?",
          )
          .get(actor.workspaceId, session.id)?.message_count ?? 0,
      );
      if (messages.length < existingCount)
        throw new DomainError("VALIDATION_ERROR");
      db.prepare(
        "INSERT INTO agent_session_metadata VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,message_count=excluded.message_count,metadata=excluded.metadata,summary=excluded.summary",
      ).run(
        actor.workspaceId,
        session.id,
        actor.principalId,
        session.updatedAt,
        session.deletedAt,
        messages.length,
        JSON.stringify(metadata),
        JSON.stringify(agentSessionSummary(session)),
      );
      const append = db.prepare(
        "INSERT INTO agent_session_message VALUES (?,?,?,?)",
      );
      for (let index = existingCount; index < messages.length; index++)
        append.run(
          actor.workspaceId,
          session.id,
          index,
          JSON.stringify(messages[index]),
        );
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
