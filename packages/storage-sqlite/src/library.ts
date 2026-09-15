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
    async putAssetChunk(asset, index, final) {
      guard();
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= Number.MAX_SAFE_INTEGER ||
        typeof final !== "boolean" ||
        !/^[a-zA-Z0-9-]{16,80}$/.test(asset.id) ||
        !asset.name ||
        asset.name.length > 120 ||
        !["image/png", "image/jpeg", "image/webp"].includes(asset.mime) ||
        asset.base64.length > 349528
      )
        throw new DomainError("VALIDATION_ERROR");
      const bytes = Buffer.from(asset.base64, "base64");
      if (
        !bytes.length ||
        bytes.length > 262144 ||
        bytes.toString("base64") !== asset.base64
      )
        throw new DomainError("VALIDATION_ERROR");
      if (index === 0) {
        const valid =
          bytes.length >= 12 &&
          (asset.mime === "image/png"
            ? bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : asset.mime === "image/jpeg"
              ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
              : bytes.toString("ascii", 0, 4) === "RIFF" &&
                bytes.toString("ascii", 8, 12) === "WEBP");
        if (!valid) throw new DomainError("VALIDATION_ERROR");
      }
      if (asset.spaceId !== null) {
        const space = await get(asset.spaceId);
        if (space.kind !== "SPACE" || space.deletedAt)
          throw new DomainError("NOT_FOUND");
      }
      const expired = db
        .prepare(
          "SELECT id,next_index FROM library_asset_upload WHERE workspace_id=? AND complete=0 AND updated_at<?",
        )
        .all(context.workspaceId, Date.now() - 86400000);
      for (const row of expired) {
        db.prepare(
          "DELETE FROM library_asset_upload WHERE workspace_id=? AND id=?",
        ).run(context.workspaceId, String(row.id));
        event(
          String(row.id),
          Number(row.next_index) + 1,
          "ASSET_UPLOAD_EXPIRED",
        );
      }
      const upload = db
        .prepare(
          "SELECT * FROM library_asset_upload WHERE workspace_id=? AND id=?",
        )
        .get(context.workspaceId, asset.id);
      if (!upload) {
        if (
          index !== 0 ||
          db
            .prepare(
              "SELECT id FROM library_asset WHERE workspace_id=? AND id=?",
            )
            .get(context.workspaceId, asset.id)
        )
          throw new DomainError("VERSION_CONFLICT");
        db.prepare(
          "INSERT INTO library_asset_upload VALUES (?,?,?,?,?,?,0,0,?)",
        ).run(
          context.workspaceId,
          asset.id,
          context.principalId,
          asset.spaceId,
          asset.name,
          asset.mime,
          Date.now(),
        );
      } else {
        if (upload.principal_id !== context.principalId)
          throw new DomainError("FORBIDDEN");
        if (
          upload.complete ||
          upload.next_index !== index ||
          upload.space_id !== asset.spaceId ||
          upload.name !== asset.name ||
          upload.mime !== asset.mime
        )
          throw new DomainError("VERSION_CONFLICT");
      }
      db.prepare("INSERT INTO library_asset_chunk VALUES (?,?,?,?)").run(
        context.workspaceId,
        asset.id,
        index,
        asset.base64,
      );
      db.prepare(
        "UPDATE library_asset_upload SET next_index=?,complete=?,updated_at=? WHERE workspace_id=? AND id=?",
      ).run(
        index + 1,
        final ? 1 : 0,
        Date.now(),
        context.workspaceId,
        asset.id,
      );
      if (final) {
        db.prepare("INSERT INTO library_asset VALUES (?,?,?,?,?,?)").run(
          context.workspaceId,
          asset.id,
          asset.spaceId,
          asset.name,
          asset.mime,
          "",
        );
      }
      event(
        asset.id,
        index + 1,
        final ? "ASSET_UPLOADED" : "ASSET_CHUNK_UPLOADED",
      );
    },
    async assetChunk(id, index) {
      await this.asset(id);
      const row = db
        .prepare(
          "SELECT base64 FROM library_asset_chunk WHERE workspace_id=? AND upload_id=? AND chunk_index=?",
        )
        .get(context.workspaceId, id, index);
      if (!row) throw new DomainError("NOT_FOUND");
      return String(row.base64);
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
      const upload = db
        .prepare(
          "SELECT next_index FROM library_asset_upload WHERE workspace_id=? AND id=? AND complete=1",
        )
        .get(context.workspaceId, id);
      return {
        ...row,
        ...(upload ? { chunkCount: Number(upload.next_index) } : {}),
      } as unknown as Awaited<ReturnType<LibraryStore["asset"]>>;
    },
  };
}
