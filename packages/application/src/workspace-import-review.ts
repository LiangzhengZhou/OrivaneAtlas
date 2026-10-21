import {
  DomainError,
  manualOrderScopeKey,
  requireManualOrderScope,
} from "@arclattice/domain";
import { localObject } from "./local-dto";
import type { LocalEntity } from "./local-persistence";
import {
  requireWorkspaceImportJournal,
  type WorkspaceImportJournal,
} from "./workspace-import";

/** Version review only; changed entities require explicit resolution, never a forced update. */
export function reviewWorkspaceImportSuffix(
  journal: WorkspaceImportJournal,
  records: readonly LocalEntity[],
) {
  requireWorkspaceImportJournal(journal);
  const key = (collection: string, id: string) =>
    JSON.stringify([collection, id]);
  const versions = new Map<string, { version: number; deleted: boolean }>();
  for (const row of records) {
    if (row.workspaceId !== journal.targetWorkspaceId)
      throw new DomainError("FORBIDDEN");
    if (
      !row.collection ||
      !row.id ||
      !Number.isSafeInteger(row.version) ||
      row.version < 1
    )
      throw new DomainError("VALIDATION_ERROR");
    const identity = key(row.collection, row.id);
    if (versions.has(identity)) throw new DomainError("VALIDATION_ERROR");
    versions.set(identity, {
      version: row.version,
      deleted: !!localObject(row.value).deletedAt,
    });
  }
  const conflicts: {
    stepId: string;
    collection: string;
    entityId: string;
    expectedVersion: number;
    actualVersion: number | null;
  }[] = [];
  const expect = (
    stepId: string,
    collection: string,
    id: string,
    version: number,
    next: number,
  ) => {
    const identity = key(collection, id),
      actual = versions.get(identity);
    if ((actual?.version ?? 0) !== version || actual?.deleted)
      conflicts.push({
        stepId,
        collection,
        entityId: id,
        expectedVersion: version,
        actualVersion: actual?.version ?? null,
      });
    versions.set(identity, { version: next, deleted: false });
  };
  for (const step of journal.steps.slice(journal.accepted.length)) {
    const value = localObject(step.payload);
    if (step.path === "/api/memo/save") {
      const sync = localObject(value.syncCommand!),
        effects = sync.effects;
      if (
        typeof value.version !== "number" ||
        !Array.isArray(effects) ||
        effects.length !== 1
      )
        throw new DomainError("VALIDATION_ERROR");
      const effect = localObject(effects[0]!);
      if (
        effect.collection !== "entityMemos" ||
        typeof effect.id !== "string" ||
        effect.baseVersion !== value.version ||
        effect.op !== "UPSERT"
      )
        throw new DomainError("VALIDATION_ERROR");
      expect(
        step.id,
        "entityMemos",
        effect.id,
        value.version,
        value.version + 1,
      );
      continue;
    }
    if (
      step.path === "/api/projects/space/create" ||
      step.path === "/api/projects/document/create"
    ) {
      if (
        typeof value.stableMaterialId !== "string" ||
        typeof value.stableTargetId !== "string"
      )
        throw new DomainError("VALIDATION_ERROR");
      expect(step.id, "projectMaterials", value.stableMaterialId, 0, 1);
      expect(step.id, "library", value.stableTargetId, 0, 1);
      continue;
    }
    if (
      step.path === "/api/library/save" &&
      value.id !== null &&
      value.id !== undefined
    ) {
      if (typeof value.id !== "string" || typeof value.version !== "number")
        throw new DomainError("VALIDATION_ERROR");
      expect(step.id, "library", value.id, value.version, value.version + 1);
      continue;
    }
    const createCollection: Record<string, string> = {
      "/api/work/create": "items",
      "/api/edge/create": "edges",
      "/api/note/save": "notes",
      "/api/library/save": "library",
      "/api/reminders/save": "reminders",
      "/api/categories/save": "categories",
      "/api/files/register": "files",
      "/api/link/create": "links",
      "/api/projects/space/link": "projectMaterials",
      "/api/projects/link": "projectMaterials",
    };
    const collection = createCollection[step.path];
    if (collection) {
      const id = value.stableId ?? value.stableMaterialId;
      if (typeof id !== "string") throw new DomainError("VALIDATION_ERROR");
      expect(step.id, collection, id, 0, 1);
    } else if (
      step.path === "/api/work/update" ||
      step.path === "/api/files/rename"
    ) {
      if (typeof value.id !== "string" || typeof value.version !== "number")
        throw new DomainError("VALIDATION_ERROR");
      expect(
        step.id,
        step.path === "/api/work/update" ? "items" : "files",
        value.id,
        value.version,
        value.version + 1,
      );
    } else if (step.path === "/api/organize") {
      if (!Array.isArray(value.entries))
        throw new DomainError("VALIDATION_ERROR");
      for (const entry of value.entries) {
        const member = localObject(entry);
        if (
          typeof member.id !== "string" ||
          typeof member.version !== "number" ||
          typeof member.organizationVersion !== "number"
        )
          throw new DomainError("VALIDATION_ERROR");
        expect(
          step.id,
          value.kind === "WORK" ? "items" : "notes",
          member.id,
          member.version,
          member.version,
        );
        expect(
          step.id,
          "organization",
          String(value.kind) + ":" + member.id,
          member.organizationVersion,
          member.organizationVersion + 1,
        );
      }
    } else if (step.path === "/api/manual-orders/sequence") {
      const id = manualOrderScopeKey(requireManualOrderScope(value.scope));
      if (typeof value.version !== "number")
        throw new DomainError("VALIDATION_ERROR");
      expect(step.id, "manualOrders", id, value.version, value.version + 1);
    } else throw new DomainError("VALIDATION_ERROR");
  }
  return conflicts;
}
