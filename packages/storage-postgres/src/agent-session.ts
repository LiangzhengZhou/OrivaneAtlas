import { randomUUID } from "node:crypto";
import type {
  AgentSession,
  AgentSessionStore,
  AgentSessionSummary,
} from "@arclattice/application";
import { agentSessionSummary } from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";
import type { PoolClient } from "pg";
export function agentSessionStore(
  client: PoolClient,
  actor: ActorContext,
  guard: () => void,
): AgentSessionStore {
  return {
    async summaries() {
      guard();
      return (
        await client.query(
          `SELECT summary FROM arclattice.agent_session_metadata WHERE workspace_id=$1 AND principal_id=$2 AND deleted_at IS NULL ORDER BY updated_at DESC,id DESC`,
          [actor.workspaceId, actor.principalId],
        )
      ).rows.map((row) => row.summary as AgentSessionSummary);
    },
    async page(id, before, limit) {
      guard();
      const row = (
        await client.query(
          `SELECT metadata,message_count AS count FROM arclattice.agent_session_metadata WHERE workspace_id=$1 AND principal_id=$2 AND id=$3`,
          [actor.workspaceId, actor.principalId, id],
        )
      ).rows[0];
      if (!row) throw new DomainError("NOT_FOUND");
      const end = Math.min(before ?? Number(row.count), Number(row.count)),
        start = Math.max(0, end - limit);
      const messages = (
        await client.query(
          `SELECT payload AS message FROM arclattice.agent_session_message WHERE workspace_id=$1 AND session_id=$2 AND ordinal>=$3 AND ordinal<$4 ORDER BY ordinal`,
          [actor.workspaceId, id, start, end],
        )
      ).rows.map((entry) => entry.message);
      return {
        session: { ...row.metadata, messages },
        before: start,
        hasMore: start > 0,
      };
    },

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
      const { messages, ...metadata } = session;
      const existingCount = Number(
        (
          await client.query(
            "SELECT message_count FROM arclattice.agent_session_metadata WHERE workspace_id=$1 AND id=$2",
            [actor.workspaceId, session.id],
          )
        ).rows[0]?.message_count ?? 0,
      );
      if (messages.length < existingCount)
        throw new DomainError("VALIDATION_ERROR");
      await client.query(
        "INSERT INTO arclattice.agent_session_metadata VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,id) DO UPDATE SET updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,message_count=excluded.message_count,metadata=excluded.metadata,summary=excluded.summary",
        [
          actor.workspaceId,
          session.id,
          actor.principalId,
          session.updatedAt,
          session.deletedAt,
          messages.length,
          JSON.stringify(metadata),
          JSON.stringify(agentSessionSummary(session)),
        ],
      );
      if (messages.length > existingCount)
        await client.query(
          "INSERT INTO arclattice.agent_session_message SELECT $1,$2,$3+ordinality-1,message FROM jsonb_array_elements($4::jsonb) WITH ORDINALITY AS entries(message,ordinality)",
          [
            actor.workspaceId,
            session.id,
            existingCount,
            JSON.stringify(messages.slice(existingCount)),
          ],
        );
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
