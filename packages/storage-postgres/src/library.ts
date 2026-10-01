import { randomUUID } from "node:crypto";
import type { LibraryEntry, LibraryStore } from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";
import { indexDocument, normalizeWikiTitle } from "@arclattice/wiki-core";
import type { PoolClient } from "pg";

/** Actor-bound ports. The owner holds the workspace lock and transaction. */
export function libraryStore(
  client: PoolClient,
  context: ActorContext,
  guard: () => void,
): LibraryStore {
  const list = async (): Promise<LibraryEntry[]> => {
    guard();
    const entries = (
      await client.query(
        "SELECT payload FROM arclattice.library_entry WHERE workspace_id=$1 ORDER BY id",
        [context.workspaceId],
      )
    ).rows.map((row) => JSON.parse(String(row.payload)) as LibraryEntry);
    const aliases = (
      await client.query(
        "SELECT document_id,alias FROM arclattice.document_alias WHERE workspace_id=$1 ORDER BY normalized_alias",
        [context.workspaceId],
      )
    ).rows;
    return entries.map((entry) => ({
      ...entry,
      aliases: [
        ...new Set([
          ...(entry.aliases ?? []),
          ...aliases
            .filter((alias) => alias.document_id === entry.id)
            .map((alias) => String(alias.alias)),
        ]),
      ],
    }));
  };
  const get = async (id: string): Promise<LibraryEntry> => {
    guard();
    const row = (
      await client.query(
        "SELECT payload FROM arclattice.library_entry WHERE workspace_id=$1 AND id=$2",
        [context.workspaceId, id],
      )
    ).rows[0];
    if (!row) throw new DomainError("NOT_FOUND");
    const entry = JSON.parse(String(row.payload)) as LibraryEntry;
    const aliases = (
      await client.query(
        "SELECT alias FROM arclattice.document_alias WHERE workspace_id=$1 AND document_id=$2 ORDER BY normalized_alias",
        [context.workspaceId, id],
      )
    ).rows;
    return {
      ...entry,
      aliases: [
        ...new Set([
          ...(entry.aliases ?? []),
          ...aliases.map((alias) => String(alias.alias)),
        ]),
      ],
    };
  };
  const event = async (id: string, version: number, type: string) => {
    const activityId = randomUUID();
    await client.query(
      "INSERT INTO arclattice.knowledge_activity VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        context.workspaceId,
        activityId,
        id,
        context.principalId,
        type,
        version,
        new Date().toISOString(),
      ],
    );
    await client.query(
      "INSERT INTO arclattice.knowledge_outbox VALUES ($1,$2,$3)",
      [context.workspaceId, activityId, type],
    );
  };
  return {
    list,
    get,
    async rebuildWikiIndex() {
      guard();
      const before = await list();
      for (const link of await this.wikiLinks!()) {
        const target = before.find(
          (entry) => entry.id === link.targetDocumentId && !entry.deletedAt,
        );
        if (
          target &&
          normalizeWikiTitle(target.title) !==
            normalizeWikiTitle(link.targetText)
        )
          await client.query(
            "INSERT INTO arclattice.document_alias VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,normalized_alias) DO NOTHING",
            [
              context.workspaceId,
              target.id,
              link.targetText,
              normalizeWikiTitle(link.targetText),
              target.createdAt,
              target.createdBy,
            ],
          );
      }
      const entries = await list();
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
      await client.query(
        "DELETE FROM arclattice.document_wiki_link WHERE workspace_id=$1",
        [context.workspaceId],
      );
      for (const document of documents)
        for (const link of indexDocument(
          document.id,
          document.bodyMd,
          documents.filter(
            (candidate) => candidate.spaceId === document.spaceId,
          ),
        ))
          await client.query(
            "INSERT INTO arclattice.document_wiki_link VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              context.workspaceId,
              randomUUID(),
              document.id,
              link.targetDocumentId,
              link.targetText,
              link.alias,
              link.heading,
              document.version,
              document.updatedAt,
            ],
          );
      await event("wiki-index", 1, "WIKI_INDEX_REBUILT");
    },
    async wikiLinks() {
      guard();
      return (
        await client.query(
          "SELECT source_document_id, target_document_id, target_text, alias, heading FROM arclattice.document_wiki_link WHERE workspace_id=$1 ORDER BY source_document_id,id",
          [context.workspaceId],
        )
      ).rows.map((row) => ({
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
        if ((await list()).length >= 2000) throw new DomainError("FORBIDDEN");
        await client.query(
          "INSERT INTO arclattice.library_entry VALUES ($1,$2,$3,$4)",
          [context.workspaceId, entry.id, entry.version, JSON.stringify(entry)],
        );
      } else {
        const result = await client.query(
          "UPDATE arclattice.library_entry SET version=$1,payload=$2 WHERE workspace_id=$3 AND id=$4 AND version=$5",
          [
            entry.version,
            JSON.stringify(entry),
            context.workspaceId,
            entry.id,
            expected,
          ],
        );
        if (result.rowCount !== 1) throw new DomainError("VERSION_CONFLICT");
      }
      await client.query(
        "INSERT INTO arclattice.library_revision VALUES ($1,$2,$3,$4)",
        [context.workspaceId, entry.id, entry.version, JSON.stringify(entry)],
      );
      if (entry.kind === "DOCUMENT") {
        await client.query(
          "DELETE FROM arclattice.document_alias WHERE workspace_id=$1 AND document_id=$2",
          [context.workspaceId, entry.id],
        );
        for (const alias of entry.aliases ?? [])
          await client.query(
            "INSERT INTO arclattice.document_alias VALUES ($1,$2,$3,$4,$5,$6)",
            [
              context.workspaceId,
              entry.id,
              alias,
              normalizeWikiTitle(alias),
              entry.createdAt,
              entry.createdBy,
            ],
          );
        await client.query(
          "INSERT INTO arclattice.document_hierarchy VALUES ($1,$2,$3) ON CONFLICT(workspace_id,document_id) DO UPDATE SET parent_document_id=excluded.parent_document_id",
          [context.workspaceId, entry.id, entry.parentDocumentId ?? null],
        );
        const documents = (await list()).filter(
          (document) => document.kind === "DOCUMENT" && !document.deletedAt,
        );
        await client.query(
          "DELETE FROM arclattice.document_wiki_link WHERE workspace_id=$1 AND source_document_id=$2",
          [context.workspaceId, entry.id],
        );
        if (!entry.deletedAt) {
          for (const link of indexDocument(
            entry.id,
            entry.bodyMd,
            documents.filter((document) => document.spaceId === entry.spaceId),
          ))
            await client.query(
              "INSERT INTO arclattice.document_wiki_link VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
              [
                context.workspaceId,
                randomUUID(),
                entry.id,
                link.targetDocumentId,
                link.targetText,
                link.alias,
                link.heading,
                entry.version,
                entry.updatedAt,
              ],
            );
          const unresolved = (
            await client.query(
              "SELECT id, source_document_id, target_text FROM arclattice.document_wiki_link WHERE workspace_id=$1 AND target_document_id IS NULL",
              [context.workspaceId],
            )
          ).rows;
          for (const link of unresolved)
            if (
              documents.find(
                (document) => document.id === link.source_document_id,
              )?.spaceId === entry.spaceId &&
              [entry.title, ...(entry.aliases ?? [])].some(
                (title) =>
                  normalizeWikiTitle(String(link.target_text)) ===
                  normalizeWikiTitle(title),
              )
            )
              await client.query(
                "UPDATE arclattice.document_wiki_link SET target_document_id=$1 WHERE workspace_id=$2 AND id=$3",
                [entry.id, context.workspaceId, link.id],
              );
        } else
          await client.query(
            "UPDATE arclattice.document_wiki_link SET target_document_id=NULL WHERE workspace_id=$1 AND target_document_id=$2",
            [context.workspaceId, entry.id],
          );
      }
      await event(entry.id, entry.version, "LIBRARY_CHANGED");
    },
    async revisions(id) {
      await get(id);
      return (
        await client.query(
          "SELECT payload FROM arclattice.library_revision WHERE workspace_id=$1 AND id=$2 ORDER BY version DESC",
          [context.workspaceId, id],
        )
      ).rows.map((row) => JSON.parse(String(row.payload)) as LibraryEntry);
    },
    async putAsset(asset) {
      guard();
      if (asset.spaceId) {
        const space = await get(asset.spaceId);
        if (space.kind !== "SPACE" || space.deletedAt)
          throw new DomainError("NOT_FOUND");
      }
      await client.query(
        "INSERT INTO arclattice.library_asset VALUES ($1,$2,$3,$4,$5,$6)",
        [
          context.workspaceId,
          asset.id,
          asset.spaceId,
          asset.name,
          asset.mime,
          asset.base64,
        ],
      );
      await event(asset.id, 1, "ASSET_UPLOADED");
    },
    async asset(id) {
      guard();
      const row = (
        await client.query(
          "SELECT id,space_id,name,mime,base64 FROM arclattice.library_asset WHERE workspace_id=$1 AND id=$2",
          [context.workspaceId, id],
        )
      ).rows[0];
      if (!row) throw new DomainError("NOT_FOUND");
      if (row.space_id && (await get(String(row.space_id))).deletedAt)
        throw new DomainError("NOT_FOUND");
      return {
        id: String(row.id),
        spaceId: row.space_id === null ? null : String(row.space_id),
        name: String(row.name),
        mime: String(row.mime),
        base64: String(row.base64),
        ...((
          await client.query(
            "SELECT next_index FROM arclattice.library_asset_upload WHERE workspace_id=$1 AND id=$2 AND complete",
            [context.workspaceId, id],
          )
        ).rows[0]
          ? {
              chunkCount: Number(
                (
                  await client.query(
                    "SELECT next_index FROM arclattice.library_asset_upload WHERE workspace_id=$1 AND id=$2 AND complete",
                    [context.workspaceId, id],
                  )
                ).rows[0].next_index,
              ),
            }
          : {}),
      };
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
      if (
        index === 0 &&
        !(
          bytes.length >= 12 &&
          (asset.mime === "image/png"
            ? bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : asset.mime === "image/jpeg"
              ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
              : bytes.toString("ascii", 0, 4) === "RIFF" &&
                bytes.toString("ascii", 8, 12) === "WEBP")
        )
      )
        throw new DomainError("VALIDATION_ERROR");
      if (asset.spaceId !== null) {
        const space = await get(asset.spaceId);
        if (space.kind !== "SPACE" || space.deletedAt)
          throw new DomainError("NOT_FOUND");
      }
      const expired = (
        await client.query(
          "DELETE FROM arclattice.library_asset_upload WHERE workspace_id=$1 AND NOT complete AND updated_at<$2 RETURNING id,next_index",
          [context.workspaceId, Date.now() - 86400000],
        )
      ).rows;
      for (const row of expired)
        await event(
          String(row.id),
          Number(row.next_index) + 1,
          "ASSET_UPLOAD_EXPIRED",
        );
      const upload = (
        await client.query(
          "SELECT * FROM arclattice.library_asset_upload WHERE workspace_id=$1 AND id=$2",
          [context.workspaceId, asset.id],
        )
      ).rows[0];
      if (!upload) {
        if (
          index !== 0 ||
          (
            await client.query(
              "SELECT 1 FROM arclattice.library_asset WHERE workspace_id=$1 AND id=$2",
              [context.workspaceId, asset.id],
            )
          ).rowCount
        )
          throw new DomainError("VERSION_CONFLICT");
        await client.query(
          "INSERT INTO arclattice.library_asset_upload VALUES ($1,$2,$3,$4,$5,$6,0,FALSE,$7)",
          [
            context.workspaceId,
            asset.id,
            context.principalId,
            asset.spaceId,
            asset.name,
            asset.mime,
            Date.now(),
          ],
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
      await client.query(
        "INSERT INTO arclattice.library_asset_chunk VALUES ($1,$2,$3,$4)",
        [context.workspaceId, asset.id, index, asset.base64],
      );
      await client.query(
        "UPDATE arclattice.library_asset_upload SET next_index=$1,complete=$2,updated_at=$3 WHERE workspace_id=$4 AND id=$5",
        [index + 1, final, Date.now(), context.workspaceId, asset.id],
      );
      if (final)
        await client.query(
          "INSERT INTO arclattice.library_asset VALUES ($1,$2,$3,$4,$5,$6)",
          [
            context.workspaceId,
            asset.id,
            asset.spaceId,
            asset.name,
            asset.mime,
            "",
          ],
        );
      await event(
        asset.id,
        index + 1,
        final ? "ASSET_UPLOADED" : "ASSET_CHUNK_UPLOADED",
      );
    },
    async assetChunk(id, index) {
      await this.asset(id);
      const row = (
        await client.query(
          "SELECT base64 FROM arclattice.library_asset_chunk WHERE workspace_id=$1 AND upload_id=$2 AND chunk_index=$3",
          [context.workspaceId, id, index],
        )
      ).rows[0];
      if (!row) throw new DomainError("NOT_FOUND");
      return String(row.base64);
    },
  };
}
