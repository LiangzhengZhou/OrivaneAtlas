import {
  type ActorContext,
  DomainError,
  manualOrderScopeKey,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
  requireManualOrderScope,
} from "@arclattice/domain";
import { localObject } from "./local-dto";
import { requireStableUuid } from "./mutation-receipt";
import {
  type BindingPreviewSide,
  previewWorkspaceBinding,
} from "./workspace-binding-preview";

export type WorkspaceMergeChoice = {
  collection: string;
  sourceId: string;
} & ({ action: "COPY" | "SKIP" } | { action: "USE_REMOTE"; targetId: string });

/** Explicit identity decisions only. Applying requires backup, reference planning and CAS. */
export function planWorkspaceMergeSelection(
  actorInput: ActorContext,
  localInput: BindingPreviewSide,
  remoteInput: BindingPreviewSide,
  choicesInput: readonly WorkspaceMergeChoice[],
  ids: { next(): string },
) {
  const actor = Object.freeze({ ...actorInput }),
    local = structuredClone(localInput),
    remote = structuredClone(remoteInput),
    choices = structuredClone(choicesInput);
  const review = previewWorkspaceBinding(actor, local, remote);
  if (local.workspaceId === remote.workspaceId)
    throw new DomainError("VALIDATION_ERROR");
  const key = (collection: string, id: string) =>
    JSON.stringify([collection, id]);
  const source = new Map(
    local.records
      .filter((row) => !localObject(row.value).deletedAt)
      .map((row) => [key(row.collection, row.id), row]),
  );
  const duplicateTargets = new Map<string, ReadonlySet<string>>();
  for (const group of review.exactDuplicates) {
    const targets = new Set(group.remoteIds);
    for (const id of group.localIds)
      duplicateTargets.set(key(group.collection, id), targets);
  }
  const seen = new Set<string>();
  const allocated = new Set(
    [...local.records, ...remote.records].map((row) => row.id),
  );
  const mappings: {
    collection: string;
    sourceId: string;
    sourceVersion: number;
    targetId: string;
    action: "COPY" | "USE_REMOTE";
  }[] = [];
  const skipped: {
    collection: string;
    sourceId: string;
    sourceVersion: number;
  }[] = [];
  for (const choice of choices) {
    const ref = key(choice.collection, choice.sourceId),
      row = source.get(ref);
    if (!row || seen.has(ref)) throw new DomainError("VALIDATION_ERROR");
    seen.add(ref);
    const identity = {
      collection: row.collection,
      sourceId: row.id,
      sourceVersion: row.version,
    };
    if (choice.action === "SKIP") {
      skipped.push(identity);
    } else if (choice.action === "USE_REMOTE") {
      if (!duplicateTargets.get(ref)?.has(choice.targetId))
        throw new DomainError("VALIDATION_ERROR");
      mappings.push({
        ...identity,
        action: "USE_REMOTE",
        targetId: choice.targetId,
      });
    } else if (choice.action === "COPY") {
      const targetId = ids.next();
      requireStableUuid(targetId);
      if (allocated.has(targetId)) throw new DomainError("VALIDATION_ERROR");
      allocated.add(targetId);
      mappings.push({ ...identity, action: "COPY", targetId });
    } else throw new DomainError("VALIDATION_ERROR");
  }
  if (seen.size !== source.size) throw new DomainError("VALIDATION_ERROR");
  const selected = new Map(
    mappings.map((entry) => [key(entry.collection, entry.sourceId), entry]),
  );
  // Aggregate identities derive from remapped business entities, never a random UUID.
  for (const mapping of mappings) {
    if (mapping.action !== "COPY") continue;
    const value = localObject(
      source.get(key(mapping.collection, mapping.sourceId))!.value,
    );
    if (mapping.collection === "entityMemos")
      requireEntityMemoOwner(actor, requireEntityMemoRecord(value));
    if (mapping.collection === "organization") {
      const collection =
        value.kind === "WORK"
          ? "items"
          : value.kind === "NOTE"
            ? "notes"
            : null;
      const entity =
        collection && typeof value.id === "string"
          ? selected.get(key(collection, value.id))
          : null;
      if (!entity)
        throw new DomainError("VALIDATION_ERROR", { field: "mergeReference" });
      mapping.targetId = `${value.kind}:${entity.targetId}`;
    } else if (mapping.collection === "manualOrders") {
      const scope = requireManualOrderScope(value.scope);
      const remap = (id: string) => {
        const target = selected.get(key("items", id));
        if (!target)
          throw new DomainError("VALIDATION_ERROR", {
            field: "mergeReference",
          });
        return target.targetId;
      };
      mapping.targetId = manualOrderScopeKey(
        scope.kind === "PROJECT_TASKS"
          ? { ...scope, projectId: remap(scope.projectId) }
          : scope.kind === "PROJECT_CHILDREN" && scope.parentProjectId !== null
            ? { ...scope, parentProjectId: remap(scope.parentProjectId) }
            : scope,
      );
    }
  }
  const targets = new Map(
    remote.records.map((row) => [key(row.collection, row.id), row]),
  );
  const references: {
    collection: string;
    sourceId: string;
    path: readonly (string | number)[];
    targetId: string;
  }[] = [];
  // Reusing an existing task/document must also preserve its reviewed relationships.
  // An exact pre-remap match is insufficient when its parent is copied under a new ID.
  for (const mapping of mappings) {
    const value = localObject(
      source.get(key(mapping.collection, mapping.sourceId))!.value,
    );
    const target =
      mapping.action === "USE_REMOTE"
        ? localObject(
            targets.get(key(mapping.collection, mapping.targetId))!.value,
          )
        : null;
    const relations: [string, string, boolean][] =
      mapping.collection === "items"
        ? [
            ["parentProjectId", "items", false],
            ["projectIds", "items", true],
            ["categoryId", "categories", false],
          ]
        : ["library", "files"].includes(mapping.collection)
          ? [
              ["spaceId", "library", false],
              ["parentDocumentId", "library", false],
            ]
          : [];
    for (const [field, collection, multiple] of relations) {
      const raw = value[field];
      if (raw === undefined || raw === null) continue;
      const refs = multiple ? raw : [raw];
      if (!Array.isArray(refs) || refs.some((id) => typeof id !== "string"))
        throw new DomainError("VALIDATION_ERROR", { field: "mergeReference" });
      const rewritten = refs.map(
        (id) => selected.get(key(collection, String(id)))?.targetId,
      );
      if (rewritten.some((id) => id === undefined))
        throw new DomainError("VALIDATION_ERROR", { field: "mergeReference" });
      rewritten.forEach((id, index) =>
        references.push({
          collection: mapping.collection,
          sourceId: mapping.sourceId,
          path: multiple ? [field, index] : [field],
          targetId: id!,
        }),
      );
      if (target) {
        const actual = multiple ? target[field] : [target[field]];
        if (
          !Array.isArray(actual) ||
          actual.length !== rewritten.length ||
          rewritten.some((id, index) => id !== actual[index])
        )
          throw new DomainError("VALIDATION_ERROR", {
            field: "mergeReference",
          });
      }
    }
    const reference = (
      collection: string,
      id: unknown,
      path: readonly (string | number)[],
    ) => {
      if (id === undefined || id === null) return;
      if (typeof id !== "string")
        throw new DomainError("VALIDATION_ERROR", { field: "mergeReference" });
      const destination = selected.get(key(collection, id));
      if (!destination)
        throw new DomainError("VALIDATION_ERROR", { field: "mergeReference" });
      if (target) {
        let actual: unknown = target;
        for (const segment of path)
          actual =
            Array.isArray(actual) && typeof segment === "number"
              ? actual[segment]
              : localObject(actual as import("./local-persistence").LocalJson)[
                  String(segment)
                ];
        if (actual !== destination.targetId)
          throw new DomainError("VALIDATION_ERROR", {
            field: "mergeReference",
          });
      }
      references.push({
        collection: mapping.collection,
        sourceId: mapping.sourceId,
        path,
        targetId: destination.targetId,
      });
    };
    if (mapping.collection === "organization") {
      const collection =
        value.kind === "WORK"
          ? "items"
          : value.kind === "NOTE"
            ? "notes"
            : null;
      if (!collection)
        throw new DomainError("VALIDATION_ERROR", { field: "mergeReference" });
      reference(collection, value.id, ["id"]);
    } else if (mapping.collection === "manualOrders") {
      const scope = requireManualOrderScope(value.scope);
      if (scope.kind === "PROJECT_TASKS")
        reference("items", scope.projectId, ["scope", "projectId"]);
      else if (scope.kind === "PROJECT_CHILDREN")
        reference("items", scope.parentProjectId, ["scope", "parentProjectId"]);
      if (!Array.isArray(value.entries))
        throw new DomainError("VALIDATION_ERROR", { field: "mergeReference" });
      for (const [index, entry] of value.entries.entries()) {
        reference("items", localObject(entry).entityId, [
          "entries",
          index,
          "entityId",
        ]);
        references.push({
          collection: mapping.collection,
          sourceId: mapping.sourceId,
          path: ["entries", index, "scopeKey"],
          targetId: mapping.targetId,
        });
      }
    } else if (mapping.collection === "workflows") {
      const payload = localObject(value.payload!);
      const projects = (
        entry: ReturnType<typeof localObject>,
        path: readonly (string | number)[],
      ) => {
        if (entry.projectIds === undefined) return;
        if (!Array.isArray(entry.projectIds))
          throw new DomainError("VALIDATION_ERROR", {
            field: "mergeReference",
          });
        entry.projectIds.forEach((id, index) =>
          reference("items", id, [...path, "projectIds", index]),
        );
      };
      if (payload.kind === "RECURRENCE") projects(payload, ["payload"]);
      else if (payload.kind === "OCCURRENCE") {
        reference("workflows", payload.definitionId, [
          "payload",
          "definitionId",
        ]);
        reference("items", payload.taskId, ["payload", "taskId"]);
        if (payload.ruleSnapshot)
          projects(localObject(payload.ruleSnapshot), [
            "payload",
            "ruleSnapshot",
          ]);
      } else if (payload.kind === "PLAN") {
        reference("items", payload.projectId, ["payload", "projectId"]);
        for (const field of ["tasks", "recurrences"] as const) {
          if (!Array.isArray(payload[field])) continue;
          payload[field].forEach((entry, index) =>
            projects(localObject(entry), ["payload", field, index]),
          );
        }
        if (Array.isArray(payload.documents))
          payload.documents.forEach((entry, index) => {
            const document = localObject(entry);
            reference("items", document.projectId, [
              "payload",
              "documents",
              index,
              "projectId",
            ]);
            reference("library", document.spaceId, [
              "payload",
              "documents",
              index,
              "spaceId",
            ]);
          });
        if (Array.isArray(payload.provenance))
          payload.provenance.forEach((entry, index) =>
            reference("items", localObject(entry).taskId, [
              "payload",
              "provenance",
              index,
              "taskId",
            ]),
          );
        const result = localObject(payload.result!);
        for (const [temporaryId, id] of Object.entries(result)) {
          const candidates = mappings.filter((entry) => entry.sourceId === id);
          if (candidates.length !== 1)
            throw new DomainError("VALIDATION_ERROR", {
              field: "mergeReference",
            });
          reference(candidates[0]!.collection, id, [
            "payload",
            "result",
            temporaryId,
          ]);
        }
      } else
        throw new DomainError("VALIDATION_ERROR", { field: "mergeReference" });
    } else if (mapping.collection === "edges") {
      reference("items", value.fromId, ["fromId"]);
      reference("items", value.toId, ["toId"]);
    } else if (mapping.collection === "entityMemos") {
      reference(
        value.targetKind === "FILE" ? "files" : "items",
        value.targetId,
        ["targetId"],
      );
    } else if (mapping.collection === "reminders") {
      reference("items", value.linkedProjectId, ["linkedProjectId"]);
      reference("items", value.linkedTaskId, ["linkedTaskId"]);
    } else if (mapping.collection === "projectMaterials") {
      reference("items", value.projectId, ["projectId"]);
      reference(value.kind === "FILE" ? "files" : "library", value.targetId, [
        "targetId",
      ]);
    } else if (mapping.collection === "links") {
      for (const field of ["from", "to"] as const) {
        const ref = localObject(value[field]!);
        const collection =
          ref.kind === "WORK"
            ? "items"
            : ref.kind === "NOTE"
              ? "notes"
              : ref.kind === "FILE"
                ? "files"
                : ["SPACE", "DOCUMENT"].includes(String(ref.kind))
                  ? "library"
                  : null;
        if (!collection)
          throw new DomainError("VALIDATION_ERROR", {
            field: "mergeReference",
          });
        reference(collection, ref.id, [field, "id"]);
      }
    }
  }
  return {
    principalId: actor.principalId,
    localWorkspaceId: local.workspaceId,
    remoteWorkspaceId: remote.workspaceId,
    localRevision: local.revision,
    remoteRevision: remote.revision,
    mappings,
    skipped,
    references,
  };
}
