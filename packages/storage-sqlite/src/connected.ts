import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  AgentRun,
  ConnectedEntity,
  ConnectedStore,
  KnowledgeLink,
} from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";

export function connectedStore(
  db: DatabaseSync,
  context: ActorContext,
  guard: () => void,
): ConnectedStore {
  const list = <T>(table: "knowledge_link" | "agent_run"): T[] => {
    guard();
    return db
      .prepare(
        "SELECT payload FROM " + table + " WHERE workspace_id=? ORDER BY id",
      )
      .all(context.workspaceId)
      .map((row) => JSON.parse(String(row.payload)) as T);
  };
  const save = (
    table: "knowledge_link" | "agent_run",
    entity: ConnectedEntity,
    expected: number,
  ) => {
    guard();
    if (
      entity.workspaceId !== context.workspaceId ||
      entity.updatedBy !== context.principalId
    )
      throw new DomainError("FORBIDDEN");
    if (
      !Number.isSafeInteger(expected) ||
      expected < 0 ||
      entity.version !== expected + 1
    )
      throw new DomainError("VERSION_CONFLICT");
    if (expected === 0)
      db.prepare("INSERT INTO " + table + " VALUES (?,?,?,?)").run(
        context.workspaceId,
        entity.id,
        entity.version,
        JSON.stringify(entity),
      );
    else if (
      db
        .prepare(
          "UPDATE " +
            table +
            " SET version=?,payload=? WHERE workspace_id=? AND id=? AND version=?",
        )
        .run(
          entity.version,
          JSON.stringify(entity),
          context.workspaceId,
          entity.id,
          expected,
        ).changes !== 1
    )
      throw new DomainError("VERSION_CONFLICT");
    const event = randomUUID();
    db.prepare("INSERT INTO connected_activity VALUES (?,?,?,?,?,?,?)").run(
      context.workspaceId,
      event,
      entity.id,
      context.principalId,
      table.toUpperCase() + "_CHANGED",
      entity.version,
      entity.updatedAt,
    );
    db.prepare("INSERT INTO connected_outbox VALUES (?,?,?)").run(
      context.workspaceId,
      event,
      table.toUpperCase() + "_CHANGED",
    );
  };
  return {
    async links() {
      return list<KnowledgeLink>("knowledge_link");
    },
    async runs() {
      return list<AgentRun>("agent_run");
    },
    async saveLink(link, version) {
      save("knowledge_link", link, version);
    },
    async saveRun(run, version) {
      save("agent_run", run, version);
    },
    async exists(ref) {
      guard();
      if (ref.kind === "SPACE" || ref.kind === "DOCUMENT") {
        const row = db
          .prepare(
            "SELECT payload FROM library_entry WHERE workspace_id=? AND id=?",
          )
          .get(context.workspaceId, ref.id);
        if (!row) return false;
        const entry = JSON.parse(String(row.payload));
        if (entry.deletedAt || entry.kind !== ref.kind) return false;
        if (entry.kind === "DOCUMENT") {
          const parent = db
            .prepare(
              "SELECT payload FROM library_entry WHERE workspace_id=? AND id=?",
            )
            .get(context.workspaceId, entry.spaceId);
          if (!parent || JSON.parse(String(parent.payload)).deletedAt)
            return false;
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
      return !!db
        .prepare(
          "SELECT 1 FROM " +
            table +
            " WHERE workspace_id=? AND id=? AND deleted_at IS NULL",
        )
        .get(context.workspaceId, ref.id);
    },
    async getRun(id) {
      guard();
      const row = db
        .prepare("SELECT payload FROM agent_run WHERE workspace_id=? AND id=?")
        .get(context.workspaceId, id);
      if (!row) throw new DomainError("NOT_FOUND");
      return JSON.parse(String(row.payload)) as AgentRun;
    },
  };
}
