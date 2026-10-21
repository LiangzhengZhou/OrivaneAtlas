import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type LibraryFileStore,
  requireOriginalFileIdentity,
} from "@arclattice/application";
import {
  type ActorContext,
  DomainError,
  type LibraryFile,
} from "@arclattice/domain";
import { extractionStore } from "./file-extractions";

export function fileStore(
  db: DatabaseSync,
  actor: ActorContext,
  guard: () => void,
): LibraryFileStore {
  const get = async (id: string): Promise<LibraryFile> => {
    guard();
    const row = db
      .prepare("SELECT payload FROM library_file WHERE workspace_id=? AND id=?")
      .get(actor.workspaceId, id);
    if (!row) throw new DomainError("NOT_FOUND");
    return JSON.parse(String(row.payload)) as LibraryFile;
  };
  return {
    extractions: extractionStore(db, actor, guard, get),
    get,
    list: async () => {
      guard();
      return db
        .prepare(
          "SELECT payload FROM library_file WHERE workspace_id=? ORDER BY id",
        )
        .all(actor.workspaceId)
        .map((row) => JSON.parse(String(row.payload)) as LibraryFile);
    },
    save: async (file, expected) => {
      guard();
      if (
        file.workspaceId !== actor.workspaceId ||
        file.updatedBy !== actor.principalId
      )
        throw new DomainError("FORBIDDEN");
      if (
        !Number.isSafeInteger(expected) ||
        expected < 0 ||
        file.version !== expected + 1
      )
        throw new DomainError("VERSION_CONFLICT");
      if (expected === 0) {
        const result = db
          .prepare(
            "INSERT INTO library_file VALUES (?,?,?,?) ON CONFLICT(workspace_id,id) DO NOTHING",
          )
          .run(actor.workspaceId, file.id, file.version, JSON.stringify(file));
        if (!result.changes) throw new DomainError("VERSION_CONFLICT");
      } else {
        const old = await get(file.id);
        if (old.version !== expected) throw new DomainError("VERSION_CONFLICT");
        requireOriginalFileIdentity(old, file);
        const result = db
          .prepare(
            "UPDATE library_file SET version=?,payload=? WHERE workspace_id=? AND id=? AND version=?",
          )
          .run(
            file.version,
            JSON.stringify(file),
            actor.workspaceId,
            file.id,
            expected,
          );
        if (!result.changes) throw new DomainError("VERSION_CONFLICT");
      }
      const eventId = randomUUID();
      db.prepare("INSERT INTO file_activity VALUES (?,?,?)").run(
        actor.workspaceId,
        eventId,
        JSON.stringify({
          id: eventId,
          entityId: file.id,
          workspaceId: actor.workspaceId,
          principalId: actor.principalId,
          version: file.version,
          type: "FILE_CHANGED",
          occurredAt: file.updatedAt,
        }),
      );
      db.prepare("INSERT INTO file_outbox VALUES (?,?,?)").run(
        actor.workspaceId,
        eventId,
        "FILE_CHANGED",
      );
    },
  };
}
