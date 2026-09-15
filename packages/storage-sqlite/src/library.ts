import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { LibraryEntry, LibraryStore } from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";

export function libraryStore(
  db: DatabaseSync,
  context: ActorContext,
  guard: () => void,
): LibraryStore {
  const get = async (id: string): Promise<LibraryEntry> => {
    guard();
    const row = db
      .prepare(
        "SELECT payload FROM library_entry WHERE workspace_id=? AND id=?",
      )
      .get(context.workspaceId, id);
    if (!row) throw new DomainError("NOT_FOUND");
    return JSON.parse(String(row.payload));
  };
  function event(id: string, version: number, type: string) {
    const eventId = randomUUID();
    db.prepare("INSERT INTO connected_activity VALUES (?,?,?,?,?,?,?)").run(
      context.workspaceId,
      eventId,
      id,
      context.principalId,
      type,
      version,
      new Date().toISOString(),
    );
    db.prepare("INSERT INTO connected_outbox VALUES (?,?,?)").run(
      context.workspaceId,
      eventId,
      type,
    );
  }
  return {
    get,
    async list() {
      guard();
      return db
        .prepare(
          "SELECT payload FROM library_entry WHERE workspace_id=? ORDER BY id",
        )
        .all(context.workspaceId)
        .map((r) => JSON.parse(String(r.payload)) as LibraryEntry);
    },
    async save(entry, expected) {
      guard();
      if (
        entry.workspaceId !== context.workspaceId ||
        entry.updatedBy !== context.principalId
      )
        throw new DomainError("FORBIDDEN");
      if (
        !Number.isSafeInteger(expected) ||
        expected < 0 ||
        entry.version !== expected + 1
      )
        throw new DomainError("VERSION_CONFLICT");
      if (expected === 0) {
        if (
          Number(
            db
              .prepare(
                "SELECT count(*) n FROM library_entry WHERE workspace_id=?",
              )
              .get(context.workspaceId)?.n,
          ) >= 2000
        )
          throw new DomainError("FORBIDDEN");
        db.prepare("INSERT INTO library_entry VALUES (?,?,?,?)").run(
          context.workspaceId,
          entry.id,
          entry.version,
          JSON.stringify(entry),
        );
      } else if (
        db
          .prepare(
            "UPDATE library_entry SET version=?,payload=? WHERE workspace_id=? AND id=? AND version=?",
          )
          .run(
            entry.version,
            JSON.stringify(entry),
            context.workspaceId,
            entry.id,
            expected,
          ).changes !== 1
      )
        throw new DomainError("VERSION_CONFLICT");
      db.prepare("INSERT INTO library_revision VALUES (?,?,?,?)").run(
        context.workspaceId,
        entry.id,
        entry.version,
        JSON.stringify(entry),
      );
      event(entry.id, entry.version, "LIBRARY_CHANGED");
    },
    async revisions(id) {
      await get(id);
      return db
        .prepare(
          "SELECT payload FROM library_revision WHERE workspace_id=? AND id=? ORDER BY version DESC",
        )
        .all(context.workspaceId, id)
        .map((r) => JSON.parse(String(r.payload)) as LibraryEntry);
    },
    async putAsset(asset) {
      guard();
      if (asset.spaceId !== null) {
        const space = await get(asset.spaceId);
        if (space.kind !== "SPACE" || space.deletedAt)
          throw new DomainError("NOT_FOUND");
      }
      const size = Number(
        db
          .prepare(
            "SELECT coalesce(sum(length(base64)),0) n FROM library_asset WHERE workspace_id=?",
          )
          .get(context.workspaceId)?.n,
      );
      if (size + asset.base64.length > 26_666_664)
        throw new DomainError("FORBIDDEN");
      db.prepare("INSERT INTO library_asset VALUES (?,?,?,?,?,?)").run(
        context.workspaceId,
        asset.id,
        asset.spaceId,
        asset.name,
        asset.mime,
        asset.base64,
      );
      event(asset.id, 1, "ASSET_UPLOADED");
    },
    async asset(id) {
      guard();
      const row = db
        .prepare(
          "SELECT id,space_id AS spaceId,name,mime,base64 FROM library_asset WHERE workspace_id=? AND id=?",
        )
        .get(context.workspaceId, id);
      if (!row) throw new DomainError("NOT_FOUND");
      if (row.spaceId !== null) {
        const space = await get(String(row.spaceId));
        if (space.deletedAt) throw new DomainError("NOT_FOUND");
      }
      return row as unknown as Awaited<ReturnType<LibraryStore["asset"]>>;
    },
  };
}
