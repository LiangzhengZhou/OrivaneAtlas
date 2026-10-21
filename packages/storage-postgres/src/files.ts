import { randomUUID } from "node:crypto";
import {
  type LibraryFileStore,
  requireOriginalFileIdentity,
} from "@arclattice/application";
import {
  type ActorContext,
  DomainError,
  type LibraryFile,
} from "@arclattice/domain";
import type { PoolClient } from "pg";
import { extractionStore } from "./file-extractions";

export function fileStore(
  client: PoolClient,
  actor: ActorContext,
  guard: () => void,
): LibraryFileStore {
  const decode = (value: unknown) =>
    (typeof value === "string" ? JSON.parse(value) : value) as LibraryFile;
  const get = async (id: string): Promise<LibraryFile> => {
    guard();
    const result = await client.query(
      "SELECT payload FROM arclattice.library_file WHERE workspace_id=$1 AND id=$2",
      [actor.workspaceId, id],
    );
    if (!result.rows.length) throw new DomainError("NOT_FOUND");
    return decode(result.rows[0].payload);
  };
  return {
    extractions: extractionStore(client, actor, guard, get),
    get,
    list: async () => {
      guard();
      return (
        await client.query(
          "SELECT payload FROM arclattice.library_file WHERE workspace_id=$1 ORDER BY id",
          [actor.workspaceId],
        )
      ).rows.map((row) => decode(row.payload));
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
        const result = await client.query(
          "INSERT INTO arclattice.library_file VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT(workspace_id,id) DO NOTHING",
          [actor.workspaceId, file.id, file.version, JSON.stringify(file)],
        );
        if (!result.rowCount) throw new DomainError("VERSION_CONFLICT");
      } else {
        const old = await get(file.id);
        if (old.version !== expected) throw new DomainError("VERSION_CONFLICT");
        requireOriginalFileIdentity(old, file);
        const result = await client.query(
          "UPDATE arclattice.library_file SET version=$1,payload=$2::jsonb WHERE workspace_id=$3 AND id=$4 AND version=$5",
          [
            file.version,
            JSON.stringify(file),
            actor.workspaceId,
            file.id,
            expected,
          ],
        );
        if (!result.rowCount) throw new DomainError("VERSION_CONFLICT");
      }
      const eventId = randomUUID();
      await client.query(
        "INSERT INTO arclattice.file_activity VALUES ($1,$2,$3::jsonb)",
        [
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
        ],
      );
      await client.query(
        "INSERT INTO arclattice.file_outbox VALUES ($1,$2,$3)",
        [actor.workspaceId, eventId, "FILE_CHANGED"],
      );
    },
  };
}
