import { randomUUID } from "node:crypto";
import type {
  BodyManifest,
  Note,
  NotebookStore,
} from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";
import type { PoolClient } from "pg";
import { purgeRelations } from "./purge";

export function notebookStore(
  client: PoolClient,
  context: ActorContext,
  guard: () => void,
): NotebookStore {
  const decode = (row: {
    payload: string;
    primary_folder_id?: string | null;
  }): Note => {
    const note = JSON.parse(row.payload) as Note;
    if (typeof row.primary_folder_id === "string" && row.primary_folder_id)
      note.primaryFolderId = row.primary_folder_id;
    else delete note.primaryFolderId;
    return note;
  };
  const get = async (id: string): Promise<Note> => {
    guard();
    const row = (
      await client.query(
        "SELECT payload,primary_folder_id FROM arclattice.notebook WHERE workspace_id=$1 AND id=$2",
        [context.workspaceId, id],
      )
    ).rows[0];
    if (!row) throw new DomainError("NOT_FOUND");
    return decode(row);
  };
  const event = async (id: string, version: number, now: string) => {
    const eventId = randomUUID();
    await client.query(
      "INSERT INTO arclattice.notebook_activity VALUES ($1,$2,$3,$4,$5,$6)",
      [context.workspaceId, eventId, id, context.principalId, version, now],
    );
    await client.query(
      "INSERT INTO arclattice.notebook_outbox VALUES ($1,$2,'NOTE_CHANGED')",
      [context.workspaceId, eventId],
    );
  };
  return {
    async searchIds(query) {
      guard();
      const pattern = "%" + query.replace(/[\\%_]/g, "\\$&") + "%";
      return (
        await client.query(
          "SELECT id FROM arclattice.notebook WHERE workspace_id=$1 AND payload::jsonb->>'deletedAt' IS NULL AND ((payload::jsonb->>'title') || ' ' || (payload::jsonb->>'bodyMd')) ILIKE $2 ESCAPE '\\' ORDER BY payload::jsonb->>'updatedAt' DESC",
          [context.workspaceId, pattern],
        )
      ).rows.map((row) => String(row.id));
    },
    async listMetadata() {
      guard();
      return (
        await client.query(
          "SELECT payload::jsonb - 'bodyMd' metadata, length(payload::jsonb->>'bodyMd') characters, primary_folder_id FROM arclattice.notebook WHERE workspace_id=$1 ORDER BY payload::jsonb->>'updatedAt' DESC",
          [context.workspaceId],
        )
      ).rows.map((row) => {
        const metadata = row.metadata as Omit<Note, "bodyMd">;
        if (typeof row.primary_folder_id === "string" && row.primary_folder_id)
          metadata.primaryFolderId = row.primary_folder_id;
        else delete metadata.primaryFolderId;
        return {
          ...metadata,
          bodyState: "UNLOADED",
          bodyCharacterCount: Number(row.characters),
        } satisfies BodyManifest<Note>;
      });
    },
    get,
    async list() {
      guard();
      return (
        await client.query(
          "SELECT payload,primary_folder_id FROM arclattice.notebook WHERE workspace_id=$1 ORDER BY payload::jsonb->>'updatedAt' DESC",
          [context.workspaceId],
        )
      ).rows.map(decode);
    },
    async revisions(id) {
      guard();
      return (
        await client.query(
          "SELECT payload FROM arclattice.notebook_revision WHERE workspace_id=$1 AND id=$2 ORDER BY version DESC",
          [context.workspaceId, id],
        )
      ).rows.map((row) => JSON.parse(row.payload) as Note);
    },
    async save(note, expected) {
      guard();
      if (
        note.workspaceId !== context.workspaceId ||
        note.updatedBy !== context.principalId
      )
        throw new DomainError("FORBIDDEN");
      if (
        !Number.isSafeInteger(expected) ||
        expected < 0 ||
        note.version !== expected + 1
      )
        throw new DomainError("VERSION_CONFLICT");
      const payload = JSON.stringify(note);
      const result =
        expected === 0
          ? await client.query(
              "INSERT INTO arclattice.notebook(workspace_id,id,version,kind,day,deleted_at,payload,primary_folder_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
              [
                context.workspaceId,
                note.id,
                note.version,
                note.kind,
                note.day,
                note.deletedAt,
                payload,
                note.primaryFolderId ?? null,
              ],
            )
          : await client.query(
              "UPDATE arclattice.notebook SET version=$1,deleted_at=$2,payload=$3,primary_folder_id=$4 WHERE workspace_id=$5 AND id=$6 AND version=$7",
              [
                note.version,
                note.deletedAt,
                payload,
                note.primaryFolderId ?? null,
                context.workspaceId,
                note.id,
                expected,
              ],
            );
      if (result.rowCount !== 1) throw new DomainError("VERSION_CONFLICT");
      await client.query(
        "INSERT INTO arclattice.notebook_revision VALUES ($1,$2,$3,$4)",
        [context.workspaceId, note.id, note.version, payload],
      );
      await event(note.id, note.version, note.updatedAt);
    },
    async purge(id, expected) {
      const old = await get(id);
      if (old.version !== expected) throw new DomainError("VERSION_CONFLICT");
      if (!old.deletedAt) throw new DomainError("VALIDATION_ERROR");
      await purgeRelations(client, context.workspaceId, { kind: "NOTE", id });
      await client.query(
        "DELETE FROM arclattice.notebook_revision WHERE workspace_id=$1 AND id=$2",
        [context.workspaceId, id],
      );
      if (
        (
          await client.query(
            "DELETE FROM arclattice.notebook WHERE workspace_id=$1 AND id=$2 AND version=$3",
            [context.workspaceId, id, expected],
          )
        ).rowCount !== 1
      )
        throw new DomainError("VERSION_CONFLICT");
      await event(id, expected + 1, new Date().toISOString());
    },
  };
}
