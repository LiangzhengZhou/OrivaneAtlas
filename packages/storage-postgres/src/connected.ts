import { randomUUID } from "node:crypto";
import type {
  AgentRun,
  ConnectedEntity,
  ConnectedStore,
  KnowledgeLink,
  LibraryEntry,
} from "@arclattice/application";
import { requireCanonicalFile } from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";
import type { PoolClient } from "pg";

/** Caller owns workspace lock and one transaction covering entity, events and receipt. */
export function connectedStore(
  client: PoolClient,
  context: ActorContext,
  guard: () => void,
): ConnectedStore {
  const list = async <T>(
    table: "knowledge_link" | "agent_run",
  ): Promise<T[]> => {
    guard();
    const result = await client.query(
      `SELECT payload FROM arclattice.${table} WHERE workspace_id=$1 ORDER BY id`,
      [context.workspaceId],
    );
    guard();
    return result.rows.map((row) => JSON.parse(String(row.payload)) as T);
  };
  const save = async (
    table: "knowledge_link" | "agent_run",
    entity: ConnectedEntity,
    expected: number,
  ) => {
    guard();
    if (
      entity.workspaceId !== context.workspaceId ||
      entity.updatedBy !== context.principalId ||
      (expected === 0 && entity.createdBy !== context.principalId)
    )
      throw new DomainError("FORBIDDEN");
    if (
      !Number.isSafeInteger(expected) ||
      expected < 0 ||
      entity.version !== expected + 1
    )
      throw new DomainError("VERSION_CONFLICT");
    const values = [
      context.workspaceId,
      entity.id,
      entity.version,
      JSON.stringify(entity),
    ];
    const result =
      expected === 0
        ? await client.query(
            `INSERT INTO arclattice.${table}(workspace_id,id,version,payload) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,id) DO NOTHING`,
            values,
          )
        : await client.query(
            `UPDATE arclattice.${table} SET version=$3,payload=$4 WHERE workspace_id=$1 AND id=$2 AND version=$5`,
            [...values, expected],
          );
    guard();
    if (result.rowCount !== 1) throw new DomainError("VERSION_CONFLICT");
    const eventId = randomUUID(),
      type = table.toUpperCase() + "_CHANGED";
    await client.query(
      "INSERT INTO arclattice.connected_activity(workspace_id,id,entity_id,principal_id,type,version,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        context.workspaceId,
        eventId,
        entity.id,
        context.principalId,
        type,
        entity.version,
        entity.updatedAt,
      ],
    );
    guard();
    await client.query(
      "INSERT INTO arclattice.connected_outbox(workspace_id,activity_id,type) VALUES($1,$2,$3)",
      [context.workspaceId, eventId, type],
    );
    guard();
  };
  return {
    links: () => list<KnowledgeLink>("knowledge_link"),
    runs: () => list<AgentRun>("agent_run"),
    async getRun(id) {
      guard();
      const result = await client.query(
        "SELECT payload FROM arclattice.agent_run WHERE workspace_id=$1 AND id=$2",
        [context.workspaceId, id],
      );
      guard();
      const row = result.rows[0];
      if (!row) throw new DomainError("NOT_FOUND");
      return JSON.parse(String(row.payload)) as AgentRun;
    },
    saveLink: (link, version) => save("knowledge_link", link, version),
    saveRun: (run, version) => save("agent_run", run, version),
    async exists(ref) {
      guard();
      if (ref.kind === "FILE") {
        const result = await client.query(
          "SELECT version,payload FROM arclattice.library_file WHERE workspace_id=$1 AND id=$2",
          [context.workspaceId, ref.id],
        );
        guard();
        const row = result.rows[0];
        if (!row) return false;
        const file = requireCanonicalFile(
          typeof row.payload === "string"
            ? JSON.parse(row.payload)
            : row.payload,
          ref.id,
          context.workspaceId,
          Number(row.version),
        );
        if (file.deletedAt) return false;
        if (
          file.spaceId &&
          !(await this.exists({ kind: "SPACE", id: file.spaceId }))
        )
          return false;
        if (
          file.parentDocumentId &&
          !(await this.exists({ kind: "DOCUMENT", id: file.parentDocumentId }))
        )
          return false;
        return true;
      }
      if (ref.kind === "SPACE" || ref.kind === "DOCUMENT") {
        const result = await client.query(
          "SELECT payload FROM arclattice.library_entry WHERE workspace_id=$1 AND id=$2",
          [context.workspaceId, ref.id],
        );
        guard();
        const row = result.rows[0];
        if (!row) return false;
        const entry = JSON.parse(String(row.payload)) as LibraryEntry;
        if (entry.deletedAt || entry.kind !== ref.kind) return false;
        if (entry.kind === "DOCUMENT") {
          const parent = await client.query(
            "SELECT payload FROM arclattice.library_entry WHERE workspace_id=$1 AND id=$2",
            [context.workspaceId, entry.spaceId],
          );
          guard();
          const parentRow = parent.rows[0];
          if (!parentRow) return false;
          const space = JSON.parse(String(parentRow.payload)) as LibraryEntry;
          if (space.kind !== "SPACE" || space.deletedAt) return false;
        }
        return true;
      }
      const table =
        ref.kind === "NOTE"
          ? "notebook"
          : ref.kind === "WORK"
            ? "work_item"
            : null;
      if (!table) return false;
      const result = await client.query(
        `SELECT 1 FROM arclattice.${table} WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL`,
        [context.workspaceId, ref.id],
      );
      guard();
      return result.rowCount === 1;
    },
  };
}
