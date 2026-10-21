import {
  type ActorContext,
  DomainError,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
} from "@arclattice/domain";
import type { EntityMemoIdentity } from "./entity-memos";
import { requireOriginalFileIdentity } from "./files";
import { projectLocalEntityMemo } from "./local-canonical-entity-memo";
import { requireCanonicalFile } from "./local-canonical-file";
import { validateLocalCanonicalKnowledgeValue } from "./local-canonical-knowledge";
import { validateLocalCanonicalWorkValue } from "./local-canonical-work";
import { localCommandMutationIds } from "./local-command";
import { type LocalCommandPlan, planLocalCommands } from "./local-command-plan";
import { localConflictSuccessors } from "./local-conflict-successors";
import { localDto, localObject } from "./local-dto";
import { equalLocalJson } from "./local-json-equal";
import { prepareLocalKnowledgeProjection } from "./local-knowledge-projection";
import type { LocalWikiIndexer } from "./local-library-store";
import type {
  LocalEntity,
  LocalJson,
  LocalMetadataStore,
  LocalMutation,
  LocalRecordWrite,
  LocalSyncState,
  LocalWrite,
} from "./local-persistence";
import { rebaseLocalRecord } from "./local-rebase";
import { requireStableUuid } from "./mutation-receipt";
import { bodyManifest } from "./workspace-bootstrap";

export interface LocalPendingWorkRebase {
  reason?: "CLEAN_REBASE" | "REVIEWED_LOCAL" | "REVIEWED_REMOTE";
  actor: ActorContext;
  binding: LocalSyncState;
  expectedWorkspaceVersion: number | null;
  original: LocalMutation;
  originalCommand: LocalEntity;
  remoteBase: LocalEntity;
  replacement: LocalWrite;
  replacementCommand: LocalEntity;
  projections?: readonly LocalRecordWrite[];
  preservedCurrent?: LocalEntity;
  followers?: readonly LocalMutation[];
}
export interface LocalWorkConflictReview {
  binding: LocalSyncState;
  expectedWorkspaceVersion: number | null;
  original: LocalMutation;
  originalCommand: LocalEntity;
  remoteBase: LocalEntity;
  current: LocalEntity;
  followers?: readonly LocalMutation[];
}
export interface LocalPendingWorkRebaseStore {
  /** Atomically supersedes a never-sent singleton command; original evidence stays durable. */
  commit(input: LocalPendingWorkRebase): Promise<void>;
}
const editable = new Set([
  "title",
  "descriptionMd",
  "priority",
  "startDate",
  "dueDate",
  "parentProjectId",
  "projectIds",
  "categoryId",
  "assigneePrincipalId",
  "activationState",
  "activationPolicy",
]);

/** Compound/previously transmitted commands retain their original receipt bytes. */
export async function prepareLocalPendingWorkRebase(
  actorInput: ActorContext,
  bindingInput: LocalSyncState,
  planInput: LocalCommandPlan,
  pendingInput: readonly LocalMutation[],
  metadata: LocalMetadataStore,
  ids: { next(): string },
  clock: { now(): string },
  review?: { captured: LocalWorkConflictReview; choice: "LOCAL" | "REMOTE" },
  knowledgeWiki?: LocalWikiIndexer,
  memoIdentity?: Pick<EntityMemoIdentity, "forTarget">,
): Promise<LocalPendingWorkRebase | null> {
  if (review && review.choice !== "LOCAL" && review.choice !== "REMOTE")
    throw new DomainError("VALIDATION_ERROR");
  const actor = { ...actorInput },
    binding = structuredClone(bindingInput),
    plan = structuredClone(planInput),
    pending = structuredClone(pendingInput);
  if (
    binding.workspaceId !== actor.workspaceId ||
    !binding.remoteWorkspaceId ||
    !binding.remotePrincipalId ||
    !binding.epoch ||
    !binding.serverOrigin
  )
    throw new DomainError("FORBIDDEN");
  const fileRename = plan.command?.name === "file.rename";
  const memo = plan.command?.name === "memo.save";
  if (memo && !memoIdentity) return null;
  const knowledge =
    plan.command?.name === "note.save" || plan.command?.name === "library.save";
  const collection = memo
    ? "entityMemos"
    : knowledge
      ? plan.command?.name === "note.save"
        ? "notes"
        : "library"
      : fileRename
        ? "files"
        : "items";
  const commandName = memo
    ? "memo.save"
    : knowledge
      ? collection === "notes"
        ? "note.save"
        : "library.save"
      : fileRename
        ? "file.rename"
        : "work.update";
  const allowedFields = memo
    ? new Set(["bodyMd", "deletedAt", "aiPolicy"])
    : knowledge
      ? new Set([
          "title",
          "bodyMd",
          "aliases",
          "parentDocumentId",
          "spaceId",
          "aiPolicy",
        ])
      : fileRename
        ? new Set(["name"])
        : editable;
  if (knowledge && !knowledgeWiki) return null;
  const mutation = plan.mutations[0];
  const memoCreate =
    memo &&
    mutation?.operation === "CREATE" &&
    mutation.baseVersion === null &&
    mutation.basePayload === null;
  if (memoCreate && !review) return null;
  const followers = review
    ? localConflictSuccessors(
        plan,
        await planLocalCommands(actor, metadata, pending),
      )
    : [];
  if (followers === null) return null;
  if (followers.length && !mutation?.order) return null;
  if (
    review &&
    mutation &&
    (mutation.attemptCount < 1 || mutation.lastAttemptAt === null)
  )
    return null;
  if (
    plan.state !== (review ? "CONFLICT" : "READY") ||
    plan.command?.name !== commandName ||
    plan.mutations.length !== 1 ||
    !mutation ||
    (review
      ? mutation.state !== "CONFLICT"
      : mutation.state !== "PENDING" ||
        mutation.attemptCount !== 0 ||
        mutation.lastAttemptAt !== null) ||
    (mutation.operation !== "PATCH" && !memoCreate) ||
    mutation.entityType !== collection ||
    (mutation.baseVersion === null && !memoCreate) ||
    mutation.basePayload === undefined ||
    mutation.commandId !== plan.id ||
    plan.mutationIds.length !== 1 ||
    plan.mutationIds[0] !== mutation.id ||
    pending.filter(
      (entry) =>
        entry.entityType === collection && entry.entityId === mutation.entityId,
    ).length !==
      1 + followers.length
  )
    return null;
  if (
    mutation.workspaceId !== actor.workspaceId ||
    mutation.principalId !== actor.principalId ||
    pending.some(
      (entry) =>
        entry.workspaceId !== actor.workspaceId ||
        entry.principalId !== actor.principalId,
    )
  )
    throw new DomainError("FORBIDDEN");
  const input = localObject(plan.command.input),
    patch = fileRename ? { name: input.name! } : localObject(input.input!);
  if (
    input.id !== mutation.entityId ||
    input.version !== (memoCreate ? 0 : mutation.baseVersion) ||
    Object.keys(input).some(
      (field) =>
        !(
          fileRename
            ? ["id", "version", "name"]
            : memo
              ? ["id", "version", "input", "deleted"]
              : knowledge
                ? ["id", "version", "create", "input"]
                : ["id", "version", "input"]
        ).includes(field),
    ) ||
    (knowledge && input.create !== false) ||
    (memo &&
      (typeof input.deleted !== "boolean" ||
        Object.keys(patch).some(
          (field) =>
            !["targetKind", "targetId", "bodyMd", "aiPolicy"].includes(field),
        ))) ||
    Object.keys(patch).some(
      (field) =>
        !allowedFields.has(field) &&
        !equalLocalJson(
          patch[field]!,
          localObject((memoCreate ? mutation.payload : mutation.basePayload)!)[
            field
          ]!,
        ),
    )
  )
    return null;
  const originalIntent = memoCreate
    ? {
        state: "CLEAN" as const,
        value: mutation.payload,
        changedFields: [
          "bodyMd",
          ...(Object.hasOwn(patch, "aiPolicy") ? ["aiPolicy"] : []),
        ],
      }
    : rebaseLocalRecord(mutation, mutation.basePayload);
  const originalPayload = localObject(mutation.payload);
  if (
    originalIntent.state !== "CLEAN" ||
    originalIntent.changedFields.some(
      (field) =>
        !Object.hasOwn(patch, field) && !(memo && field === "deletedAt"),
    ) ||
    Object.keys(patch).some(
      (field) => !equalLocalJson(patch[field]!, originalPayload[field]!),
    )
  )
    return null;
  if (memo) {
    const intended = requireEntityMemoRecord(mutation.payload);
    requireEntityMemoOwner(actor, intended);
    if (
      intended.id !== mutation.entityId ||
      (intended.deletedAt !== null) !== input.deleted
    )
      throw new DomainError("VALIDATION_ERROR");
    // Deletion/restoration is always a reviewed decision, never a clean automatic rebase.
    if (!review && originalIntent.changedFields.includes("deletedAt"))
      return null;
  }
  const refs = [
    { collection: "$local.workspace", id: "revision" },
    { collection: "$local.command", id: plan.id },
    {
      collection: "$local.remoteBase",
      id: JSON.stringify([collection, mutation.entityId]),
    },
    { collection, id: mutation.entityId },
  ];
  const records = metadata.getMany
    ? await metadata.getMany(actor.workspaceId, refs)
    : await Promise.all(
        refs.map((ref) =>
          metadata.get(actor.workspaceId, ref.collection, ref.id),
        ),
      );
  const [revision, command, base, current] = records;
  if (!command || !base || !current) return null;
  if (
    review &&
    !equalLocalJson(
      localDto(review.captured),
      localDto({
        binding,
        expectedWorkspaceVersion: revision?.version ?? null,
        original: mutation,
        originalCommand: command,
        remoteBase: base,
        current,
        ...(followers.length ? { followers } : {}),
      }),
    )
  )
    throw new DomainError("VERSION_CONFLICT", { field: "conflictReview" });
  if (
    records.length !== refs.length ||
    records.some(
      (entry, index) =>
        entry &&
        (entry.workspaceId !== actor.workspaceId ||
          entry.collection !== refs[index]!.collection ||
          entry.id !== refs[index]!.id),
    )
  )
    throw new DomainError("VALIDATION_ERROR");
  const stored = localObject(command.value),
    canonical = localObject(base.value);
  if (
    localCommandMutationIds(
      command,
      actor.workspaceId,
      actor.principalId,
    )?.join() !== mutation.id
  )
    throw new DomainError("VALIDATION_ERROR");
  if (
    !equalLocalJson(stored.input!, plan.command.input) ||
    stored.name !== commandName ||
    !Array.isArray(stored.mutationIds) ||
    stored.mutationIds.length !== 1 ||
    stored.mutationIds[0] !== mutation.id ||
    !equalLocalJson(
      current.value,
      knowledge
        ? localDto(
            bodyManifest(
              localObject(
                followers.at(-1)?.payload ?? mutation.payload,
              ) as unknown as
                | import("./library").LibraryEntry
                | import("./notebook").Note,
            ),
          )
        : (followers.at(-1)?.payload ?? mutation.payload),
    )
  )
    return null;
  if (
    canonical.remoteWorkspaceId !== binding.remoteWorkspaceId ||
    canonical.remotePrincipalId !== binding.remotePrincipalId ||
    canonical.serverOrigin !== binding.serverOrigin ||
    canonical.epoch !== binding.epoch ||
    canonical.collection !== collection ||
    canonical.id !== mutation.entityId
  )
    throw new DomainError("VALIDATION_ERROR");
  if (
    typeof canonical.version !== "number" ||
    !Number.isSafeInteger(canonical.version) ||
    canonical.version <= (mutation.baseVersion ?? 0) ||
    canonical.version >= Number.MAX_SAFE_INTEGER ||
    canonical.value === null ||
    canonical.value === undefined
  )
    return null;
  let memoValue: LocalJson | undefined;
  if (memo) {
    const projected = await projectLocalEntityMemo(
      actor,
      binding,
      canonical.value,
      memoIdentity!,
    );
    const originalMemo = requireEntityMemoRecord(
      memoCreate ? mutation.payload : mutation.basePayload,
    );
    requireEntityMemoOwner(actor, originalMemo);
    if (
      projected.local.id !== mutation.entityId ||
      projected.remote.id !== canonical.remoteId ||
      projected.remote.version !== canonical.version ||
      originalMemo.id !== mutation.entityId ||
      originalMemo.version !== (memoCreate ? 1 : mutation.baseVersion) ||
      originalMemo.targetKind !== projected.local.targetKind ||
      originalMemo.targetId !== projected.local.targetId
    )
      throw new DomainError("VALIDATION_ERROR");
    memoValue = localDto(projected.local);
  } else if (knowledge) {
    validateLocalCanonicalKnowledgeValue(
      collection as "notes" | "library",
      mutation.entityId,
      binding.remoteWorkspaceId,
      canonical.version,
      canonical.value,
    );
  } else if (fileRename) {
    if (mutation.baseVersion === null) return null;
    const remoteFile = requireCanonicalFile(
      canonical.value,
      mutation.entityId,
      binding.remoteWorkspaceId,
      canonical.version,
    );
    const originalFile = requireCanonicalFile(
      mutation.basePayload,
      mutation.entityId,
      actor.workspaceId,
      mutation.baseVersion,
    );
    requireOriginalFileIdentity(originalFile, {
      ...remoteFile,
      workspaceId: actor.workspaceId,
    });
  } else
    validateLocalCanonicalWorkValue(
      "items",
      mutation.entityId,
      binding.remoteWorkspaceId,
      canonical.version,
      canonical.value,
    );
  const remoteValue = localObject(memoValue ?? canonical.value);
  if (review && remoteValue.deletedAt !== null && !memo) return null;
  const result = review
    ? {
        state: "CLEAN" as const,
        value: localDto({
          ...remoteValue,
          ...(memo && remoteValue.deletedAt !== null
            ? {
                deletedAt:
                  review.choice === "LOCAL" ? null : remoteValue.deletedAt,
              }
            : {}),
          ...Object.fromEntries(
            originalIntent.changedFields.map((field) => [
              field,
              review.choice === "LOCAL"
                ? originalPayload[field]!
                : remoteValue[field]!,
            ]),
          ),
        }),
        changedFields: originalIntent.changedFields,
      }
    : rebaseLocalRecord(mutation, memoValue ?? canonical.value);
  if (
    result.state !== "CLEAN" ||
    result.value === null ||
    result.changedFields.some((field) => !allowedFields.has(field))
  )
    return null;
  const value = localObject(result.value),
    remote = localObject(memoValue ?? canonical.value);
  if (
    value.id !== mutation.entityId ||
    remote.id !== mutation.entityId ||
    remote.workspaceId !==
      (memo ? actor.workspaceId : binding.remoteWorkspaceId) ||
    remote.version !== canonical.version
  )
    throw new DomainError("VALIDATION_ERROR");
  const version = canonical.version + 1;
  if (!followers.length && version <= current.version) return null;
  const id = requireStableUuid(ids.next()),
    at = clock.now();
  if (!Number.isFinite(Date.parse(at)) || id === mutation.id)
    throw new DomainError("VALIDATION_ERROR");
  const rebased = localDto({
    ...value,
    workspaceId: actor.workspaceId,
    version,
    updatedBy: actor.principalId,
    updatedAt: at,
  });
  const replacement: LocalWrite = {
    expectedVersion: current.version,
    entity: {
      ...current,
      version,
      value: knowledge
        ? localDto(
            bodyManifest(
              localObject(rebased) as unknown as
                | import("./library").LibraryEntry
                | import("./notebook").Note,
            ),
          )
        : rebased,
    },
    mutation: {
      ...mutation,
      operation: "PATCH",
      id,
      commandId: id,
      baseVersion: canonical.version,
      basePayload: localDto({ ...remote, workspaceId: actor.workspaceId }),
      payload: rebased,
      createdAt: at,
      state: "PENDING",
      attemptCount: 0,
      lastAttemptAt: null,
      order: {
        transactionVersion: followers.length
          ? mutation.order!.transactionVersion
          : (revision?.version ?? 0) + 1,
        operationIndex: followers.length ? mutation.order!.operationIndex : 0,
      },
    },
  };
  const projections =
    knowledge && !followers.length
      ? await prepareLocalKnowledgeProjection(
          actor,
          binding.remoteWorkspaceId,
          collection as "notes" | "library",
          mutation.entityId,
          version,
          localDto({
            ...localObject(rebased),
            workspaceId: binding.remoteWorkspaceId,
          }),
          metadata,
          knowledgeWiki!,
          binding,
        )
      : undefined;
  return {
    ...(followers.length ? { preservedCurrent: current, followers } : {}),
    ...(projections
      ? {
          projections: projections.filter(
            (record) => record.entity.collection !== collection,
          ),
        }
      : {}),
    reason: review
      ? review.choice === "LOCAL"
        ? "REVIEWED_LOCAL"
        : "REVIEWED_REMOTE"
      : "CLEAN_REBASE",
    actor,
    binding,
    expectedWorkspaceVersion: revision?.version ?? null,
    original: mutation,
    originalCommand: command,
    remoteBase: base,
    replacement,
    replacementCommand: {
      workspaceId: actor.workspaceId,
      collection: "$local.command",
      id,
      version: 1,
      value: localDto({
        schemaVersion: 1,
        id,
        workspaceId: actor.workspaceId,
        principalId: actor.principalId,
        name: commandName,
        mutationIds: [id],
        input: {
          id: mutation.entityId,
          version: canonical.version,
          ...(knowledge ? { create: false } : {}),
          ...(memo ? { deleted: value.deletedAt !== null } : {}),
          ...(fileRename
            ? { name: value.name! }
            : memo
              ? {
                  input: {
                    targetKind: value.targetKind!,
                    targetId: value.targetId!,
                    bodyMd: value.bodyMd!,
                    ...(Object.hasOwn(value, "aiPolicy")
                      ? { aiPolicy: value.aiPolicy! }
                      : {}),
                  },
                }
              : {
                  input: Object.fromEntries(
                    (knowledge ? Object.keys(patch) : result.changedFields).map(
                      (field) => [field, value[field]!],
                    ),
                  ),
                }),
        },
      }),
    },
  };
}
