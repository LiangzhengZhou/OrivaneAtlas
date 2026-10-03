import { randomUUID } from "node:crypto";
import type { Note, NotebookStore } from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";
import type { PoolClient } from "pg";
import { purgeRelations } from "./purge";

export function notebookStore(
  client: PoolClient,
  context: ActorContext,
  guard: () => void,
): NotebookStore {
  const get = async (id: string): Promise<Note> => {
    guard();
    const row = (
      await client.query(
        "SELECT payload FROM arclattice.notebook WHERE workspace_id=$1 AND id=$2",
        [context.workspaceId, id],
      )
    ).rows[0];
    if (!row) throw new DomainError("NOT_FOUND");
    return JSON.parse(row.payload) as Note;
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
    get,
    async list() {
      guard();
      return (
        await client.query(
          "SELECT payload FROM arclattice.notebook WHERE workspace_id=$1 ORDER BY payload::jsonb->>'updatedAt' DESC",
          [context.workspaceId],
        )
      ).rows.map((row) => JSON.parse(row.payload) as Note);
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
              "INSERT INTO arclattice.notebook VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
              [
                context.workspaceId,
                note.id,
                note.version,
                note.kind,
                note.day,
                note.deletedAt,
                payload,
              ],
            )
          : await client.query(
              "UPDATE arclattice.notebook SET version=$1,deleted_at=$2,payload=$3 WHERE workspace_id=$4 AND id=$5 AND version=$6",
              [
                note.version,
                note.deletedAt,
                payload,
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
