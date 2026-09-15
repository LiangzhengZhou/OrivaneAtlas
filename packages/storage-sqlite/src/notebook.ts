import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Note, NotebookStore } from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";

export function notebookStore(
  db: DatabaseSync,
  context: ActorContext,
  guard: () => void,
): NotebookStore {
  const decode = (row: Record<string, unknown> | undefined): Note => {
    if (!row) throw new DomainError("NOT_FOUND");
    return JSON.parse(String(row.payload)) as Note;
  };
  return {
    async list() {
      guard();
      return db
        .prepare(
          "SELECT payload FROM notebook WHERE workspace_id=? ORDER BY json_extract(payload,'$.updatedAt') DESC",
        )
        .all(context.workspaceId)
        .map(decode);
    },
    async get(id) {
      guard();
      return decode(
        db
          .prepare("SELECT payload FROM notebook WHERE workspace_id=? AND id=?")
          .get(context.workspaceId, id),
      );
    },
    async revisions(id) {
      guard();
      return db
        .prepare(
          "SELECT payload FROM notebook_revision WHERE workspace_id=? AND id=? ORDER BY version DESC",
        )
        .all(context.workspaceId, id)
        .map(decode);
    },
    async save(note, expectedVersion) {
      guard();
      if (
        note.workspaceId !== context.workspaceId ||
        note.updatedBy !== context.principalId
      )
        throw new DomainError("FORBIDDEN");
      if (
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 0 ||
        note.version !== expectedVersion + 1
      )
        throw new DomainError("VERSION_CONFLICT");
      const payload = JSON.stringify(note);
      if (expectedVersion === 0)
        db.prepare("INSERT INTO notebook VALUES (?,?,?,?,?,?,?)").run(
          context.workspaceId,
          note.id,
          1,
          note.kind,
          note.day,
          note.deletedAt,
          payload,
        );
      else if (
        db
          .prepare(
            "UPDATE notebook SET version=?,deleted_at=?,payload=? WHERE workspace_id=? AND id=? AND version=?",
          )
          .run(
            note.version,
            note.deletedAt,
            payload,
            context.workspaceId,
            note.id,
            expectedVersion,
          ).changes !== 1
      )
        throw new DomainError("VERSION_CONFLICT");
      db.prepare("INSERT INTO notebook_revision VALUES (?,?,?,?)").run(
        context.workspaceId,
        note.id,
        note.version,
        payload,
      );
      const id = randomUUID();
      db.prepare("INSERT INTO notebook_activity VALUES (?,?,?,?,?,?)").run(
        context.workspaceId,
        id,
        note.id,
        context.principalId,
        note.version,
        note.updatedAt,
      );
      db.prepare("INSERT INTO notebook_outbox VALUES (?,?,'NOTE_CHANGED')").run(
        context.workspaceId,
        id,
      );
    },
  };
}
