import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { LibraryEntry, LibraryStore } from "@arclattice/application";
import { referencedLibraryAssetIds } from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";
import { indexDocument, normalizeWikiTitle } from "@arclattice/wiki-core";
import { purgeRelations } from "./purge";

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
    const entry = JSON.parse(String(row.payload)) as LibraryEntry;
    return {
      ...entry,
      aliases: [
        ...new Set([
          ...(entry.aliases ?? []),
          ...db
            .prepare(
              "SELECT alias FROM document_alias WHERE workspace_id=? AND document_id=? ORDER BY normalized_alias",
            )
            .all(context.workspaceId, id)
            .map((row) => String(row.alias)),
        ]),
      ],
    };
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
    async purge(id, expected) {
      guard();
      const entry = await get(id);
      if (entry.version !== expected) throw new DomainError("VERSION_CONFLICT");
      if (!entry.deletedAt) throw new DomainError("VALIDATION_ERROR");
      purgeRelations(db, context.workspaceId, { kind: entry.kind, id });
      const revisionRows = db
        .prepare("SELECT id,payload FROM library_revision WHERE workspace_id=?")
        .all(context.workspaceId);
      const owned = new Set<string>(),
        retained = new Set<string>();
      for (const revision of revisionRows)
        for (const assetId of referencedLibraryAssetIds(
          (JSON.parse(String(revision.payload)) as LibraryEntry).bodyMd,
        ))
          (revision.id === id ? owned : retained).add(assetId);
      for (const assetId of owned)
        if (!retained.has(assetId)) {
          db.prepare(
            "DELETE FROM library_asset_upload WHERE workspace_id=? AND id=?",
          ).run(context.workspaceId, assetId);
          db.prepare(
            "DELETE FROM library_asset WHERE workspace_id=? AND id=?",
          ).run(context.workspaceId, assetId);
        }

      for (const table of [
        "document_wiki_link",
        "document_alias",
        "document_hierarchy",
        "library_revision",
      ]) {
        const column =
          table === "document_wiki_link"
            ? "source_document_id"
            : table.startsWith("document_")
              ? "document_id"
              : "id";
        db.prepare(
          "DELETE FROM " + table + " WHERE workspace_id=? AND " + column + "=?",
        ).run(context.workspaceId, id);
      }
      db.prepare(
        "UPDATE document_wiki_link SET target_document_id=NULL WHERE workspace_id=? AND target_document_id=?",
      ).run(context.workspaceId, id);
      for (const assetId of retained)
        for (const table of ["library_asset", "library_asset_upload"])
          db.prepare(
            "UPDATE " +
              table +
              " SET space_id=NULL WHERE workspace_id=? AND space_id=? AND id=?",
          ).run(context.workspaceId, id, assetId);
      db.prepare(
        "DELETE FROM library_asset_upload WHERE workspace_id=? AND space_id=?",
      ).run(context.workspaceId, id);
      db.prepare(
        "DELETE FROM library_asset WHERE workspace_id=? AND space_id=?",
      ).run(context.workspaceId, id);
      if (
        db
          .prepare(
            "DELETE FROM library_entry WHERE workspace_id=? AND id=? AND version=?",
          )
          .run(context.workspaceId, id, expected).changes !== 1
      )
        throw new DomainError("VERSION_CONFLICT");
      event(id, expected + 1, "LIBRARY_PURGED");
    },

    async wikiLinks() {
      guard();
      return db
        .prepare(
          "SELECT source_document_id, target_document_id, target_text, alias, heading FROM document_wiki_link WHERE workspace_id=? ORDER BY source_document_id,id",
        )
        .all(context.workspaceId)
        .map((row) => ({
          sourceDocumentId: String(row.source_document_id),
          targetDocumentId:
            row.target_document_id === null
              ? null
              : String(row.target_document_id),
          targetText: String(row.target_text),
          alias: row.alias === null ? null : String(row.alias),
          heading: row.heading === null ? null : String(row.heading),
        }));
    },
    async list() {
      guard();
      return db
        .prepare(
          "SELECT payload FROM library_entry WHERE workspace_id=? ORDER BY id",
        )
        .all(context.workspaceId)
        .map((r) => {
          const entry = JSON.parse(String(r.payload)) as LibraryEntry;
          return {
            ...entry,
            aliases: [
              ...new Set([
                ...(entry.aliases ?? []),
                ...db
                  .prepare(
                    "SELECT alias FROM document_alias WHERE workspace_id=? AND document_id=? ORDER BY normalized_alias",
                  )
                  .all(context.workspaceId, entry.id)
                  .map((row) => String(row.alias)),
              ]),
            ],
          };
        });
    },
    async rebuildWikiIndex() {
      guard();
      const before = await this.list();
      for (const link of await this.wikiLinks!()) {
        const target = before.find(
          (entry) => entry.id === link.targetDocumentId && !entry.deletedAt,
        );
        if (
          target &&
          normalizeWikiTitle(target.title) !==
            normalizeWikiTitle(link.targetText)
        )
          db.prepare(
            "INSERT INTO document_alias VALUES (?,?,?,?,?,?) ON CONFLICT(workspace_id,normalized_alias) DO NOTHING",
          ).run(
            context.workspaceId,
            target.id,
            link.targetText,
            normalizeWikiTitle(link.targetText),
            target.createdAt,
            target.createdBy,
          );
      }
      const entries = await this.list();
      const documents = entries.filter(
        (entry) =>
          entry.kind === "DOCUMENT" &&
          !entry.deletedAt &&
          entries.some(
            (space) =>
              space.id === entry.spaceId &&
              space.kind === "SPACE" &&
              !space.deletedAt,
          ),
      );
      db.prepare("DELETE FROM document_wiki_link WHERE workspace_id=?").run(
        context.workspaceId,
      );
      for (const document of documents)
        for (const link of indexDocument(
          document.id,
          document.bodyMd,
          documents.filter(
            (candidate) => candidate.spaceId === document.spaceId,
          ),
        ))
          db.prepare(
            "INSERT INTO document_wiki_link VALUES (?,?,?,?,?,?,?,?,?)",
          ).run(
            context.workspaceId,
            randomUUID(),
            document.id,
            link.targetDocumentId,
            link.targetText,
            link.alias,
            link.heading,
            document.version,
            document.updatedAt,
          );
      event("wiki-index", 1, "WIKI_INDEX_REBUILT");
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
      if (entry.kind === "DOCUMENT") {
        db.prepare(
          "DELETE FROM document_alias WHERE workspace_id=? AND document_id=?",
        ).run(context.workspaceId, entry.id);
        for (const alias of entry.aliases ?? [])
          db.prepare("INSERT INTO document_alias VALUES (?,?,?,?,?,?)").run(
            context.workspaceId,
            entry.id,
            alias,
            normalizeWikiTitle(alias),
            entry.createdAt,
            entry.createdBy,
          );
        db.prepare(
          "INSERT INTO document_hierarchy VALUES (?,?,?) ON CONFLICT(workspace_id,document_id) DO UPDATE SET parent_document_id=excluded.parent_document_id",
        ).run(context.workspaceId, entry.id, entry.parentDocumentId ?? null);
        const previousLinks = db
          .prepare(
            "SELECT target_text, target_document_id FROM document_wiki_link WHERE workspace_id=? AND source_document_id=? AND target_document_id IS NOT NULL",
          )
          .all(context.workspaceId, entry.id);
        const documents = db
          .prepare("SELECT payload FROM library_entry WHERE workspace_id=?")
          .all(context.workspaceId)
          .map((row) => JSON.parse(String(row.payload)) as LibraryEntry)
          .filter(
            (document) => document.kind === "DOCUMENT" && !document.deletedAt,
          );
        db.prepare(
          "DELETE FROM document_wiki_link WHERE workspace_id=? AND source_document_id=?",
        ).run(context.workspaceId, entry.id);
        if (!entry.deletedAt) {
          const candidates = documents.filter(
            (document) => document.spaceId === entry.spaceId,
          );
          for (const link of indexDocument(
            entry.id,
            entry.bodyMd,
            candidates,
          )) {
            const previous = previousLinks.find(
              (old) => String(old.target_text) === link.targetText,
            );
            const stableTarget =
              previous &&
              candidates.some(
                (candidate) => candidate.id === previous.target_document_id,
              )
                ? String(previous.target_document_id)
                : link.targetDocumentId;
            db.prepare(
              "INSERT INTO document_wiki_link VALUES (?,?,?,?,?,?,?,?,?)",
            ).run(
              context.workspaceId,
              randomUUID(),
              entry.id,
              stableTarget,
              link.targetText,
              link.alias,
              link.heading,
              entry.version,
              entry.updatedAt,
            );
          }
          for (const link of db
            .prepare(
              "SELECT id, source_document_id, target_text FROM document_wiki_link WHERE workspace_id=? AND target_document_id IS NULL",
            )
            .all(context.workspaceId)) {
            const source = documents.find(
              (document) => document.id === link.source_document_id,
            );
            if (
              source?.spaceId === entry.spaceId &&
              [entry.title, ...(entry.aliases ?? [])].some(
                (title) =>
                  normalizeWikiTitle(String(link.target_text)) ===
                  normalizeWikiTitle(title),
              )
            )
              db.prepare(
                "UPDATE document_wiki_link SET target_document_id=? WHERE workspace_id=? AND id=?",
              ).run(entry.id, context.workspaceId, String(link.id));
          }
        }
        if (entry.deletedAt)
          db.prepare(
            "UPDATE document_wiki_link SET target_document_id=NULL WHERE workspace_id=? AND target_document_id=?",
          ).run(context.workspaceId, entry.id);
      }
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
