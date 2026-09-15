import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Organization, OrganizationStore } from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";

export function organizationStore(
  db: DatabaseSync,
  context: ActorContext,
  guard: () => void,
): OrganizationStore {
  return {
    async list() {
      guard();
      return db
        .prepare(
          "SELECT payload FROM organization WHERE workspace_id=? ORDER BY kind,id",
        )
        .all(context.workspaceId)
        .map((row) => JSON.parse(String(row.payload)) as Organization);
    },
    async save(value, expectedVersion) {
      guard();
      if (
        value.workspaceId !== context.workspaceId ||
        value.updatedBy !== context.principalId
      )
        throw new DomainError("FORBIDDEN");
      if (
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 0 ||
        value.version !== expectedVersion + 1
      )
        throw new DomainError("VERSION_CONFLICT");
      const payload = JSON.stringify(value);
      if (expectedVersion === 0) {
        if (
          db
            .prepare("INSERT OR IGNORE INTO organization VALUES (?,?,?,?,?)")
            .run(
              context.workspaceId,
              value.kind,
              value.id,
              value.version,
              payload,
            ).changes !== 1
        )
          throw new DomainError("VERSION_CONFLICT");
      } else if (
        db
          .prepare(
            "UPDATE organization SET version=?,payload=? WHERE workspace_id=? AND kind=? AND id=? AND version=?",
          )
          .run(
            value.version,
            payload,
            context.workspaceId,
            value.kind,
            value.id,
            expectedVersion,
          ).changes !== 1
      )
        throw new DomainError("VERSION_CONFLICT");
      const eventId = randomUUID();
      db.prepare("INSERT INTO organization_activity VALUES (?,?,?)").run(
        context.workspaceId,
        eventId,
        payload,
      );
      db.prepare(
        "INSERT INTO organization_outbox VALUES (?,?,'ORGANIZATION_CHANGED')",
      ).run(context.workspaceId, eventId);
    },
  };
}
