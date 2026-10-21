import { type ActorContext, DomainError } from "@arclattice/domain";
import { requireCanonicalCalendarSettings } from "./calendar-replay-effects";
import { requireCanonicalCategory } from "./category-replay-effects";
import type { EntityMemoIdentity } from "./entity-memos";
import type { LibraryEntry } from "./library";
import { requireCanonicalKnowledgeLink } from "./linked-knowledge-replay-effects";
import { buildLocalCalendarReplayRequest } from "./local-calendar-replay-request";
import { projectLocalEntityMemo } from "./local-canonical-entity-memo";
import { requireCanonicalFile } from "./local-canonical-file";
import { validateLocalCanonicalKnowledgeValue } from "./local-canonical-knowledge";
import {
  projectLocalManualOrder,
  validateLocalCanonicalManualOrder,
} from "./local-canonical-manual-order";
import { projectLocalRecurrence } from "./local-canonical-recurrence";
import { validateLocalCanonicalReminderValue } from "./local-canonical-reminder";
import { validateLocalCanonicalWorkValue } from "./local-canonical-work";
import { validateLocalCanonicalWorkflowValue } from "./local-canonical-workflow";
import { buildLocalCategoryReplayRequest } from "./local-category-replay-request";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import { buildLocalEntityMemoReplayRequest } from "./local-entity-memo-replay-request";
import { buildLocalFileReplayRequest } from "./local-file-replay-request";
import { equalLocalJson } from "./local-json-equal";
import { prepareLocalKnowledgeProjection } from "./local-knowledge-projection";
import { buildLocalKnowledgeReplayRequest } from "./local-knowledge-replay-request";
import type { LocalWikiIndexer } from "./local-library-store";
import { buildLocalLinkedKnowledgeReplayRequest } from "./local-linked-knowledge-replay-request";
import { buildLocalManualOrderReplayRequest } from "./local-manual-order-replay-request";
import { buildLocalNavigationReplayRequest } from "./local-navigation-replay-request";
import { buildLocalNoteKnowledgeReplayRequest } from "./local-note-knowledge-replay-request";
import { buildLocalOrganizationReplayRequest } from "./local-organization-replay-request";
import type {
  LocalJson,
  LocalMetadataStore,
  LocalMutation,
  LocalRecordWrite,
  LocalSyncState,
} from "./local-persistence";
import { buildLocalPlanReplayRequest } from "./local-plan-replay-request";
import { buildLocalProjectKnowledgeReplayRequest } from "./local-project-knowledge-replay-request";
import { buildLocalPurgeReplayRequest } from "./local-purge-replay-request";
import { buildLocalRecurrenceReplayRequest } from "./local-recurrence-replay-request";
import { buildLocalReminderReplayRequest } from "./local-reminder-replay-request";
import type { LocalReplicaCommit } from "./local-replica";
import { buildLocalWorkReplayRequest } from "./local-work-replay-request";
import { requireCanonicalNavigationPreference } from "./navigation-replay-effects";
import type { Note } from "./notebook";
import { requireCanonicalOrganization } from "./organization-replay-effects";
import {
  requireCanonicalProjectMaterial,
  requireProjectMaterialReplica,
} from "./project-knowledge-replay-effects";
import { bodyManifest } from "./workspace-bootstrap";

interface CanonicalEffect {
  collection:
    | "items"
    | "edges"
    | "notes"
    | "library"
    | "reminders"
    | "calendarSettings"
    | "navigationPreference"
    | "manualOrders"
    | "categories"
    | "organization"
    | "projectMaterials"
    | "workflows"
    | "links"
    | "files"
    | "entityMemos";
  id: string;
  version: number;
  value: LocalJson;
}
function invalid(): never {
  throw new DomainError("VALIDATION_ERROR", { field: "workReceipt" });
}
const key = (collection: string, id: string) =>
  JSON.stringify([collection, id]);

/** Prepare only; caller commits through the strict replica port. No HTTP or user mutation. */
export async function prepareLocalWorkReplayAcknowledgement(
  actorInput: ActorContext,
  bindingInput: LocalSyncState,
  planInput: LocalCommandPlan,
  receiptInput: unknown,
  pendingInput: readonly LocalMutation[],
  metadata: LocalMetadataStore,
  knowledgeWiki?: LocalWikiIndexer,
  memoIdentity?: Pick<EntityMemoIdentity, "forTarget">,
): Promise<LocalReplicaCommit> {
  const actor = { ...actorInput },
    binding = structuredClone(bindingInput),
    plan = structuredClone(planInput),
    pending = structuredClone(pendingInput),
    receiptSnapshot = structuredClone(localDto(receiptInput));
  const request =
    (await buildLocalPurgeReplayRequest(plan, binding, memoIdentity)) ??
    (memoIdentity
      ? await buildLocalEntityMemoReplayRequest(plan, binding, memoIdentity)
      : null) ??
    buildLocalReminderReplayRequest(plan) ??
    buildLocalCalendarReplayRequest(plan) ??
    buildLocalNavigationReplayRequest(plan, binding) ??
    buildLocalManualOrderReplayRequest(plan) ??
    buildLocalCategoryReplayRequest(plan) ??
    buildLocalOrganizationReplayRequest(plan) ??
    buildLocalProjectKnowledgeReplayRequest(plan) ??
    buildLocalRecurrenceReplayRequest(plan) ??
    buildLocalLinkedKnowledgeReplayRequest(plan) ??
    buildLocalNoteKnowledgeReplayRequest(plan) ??
    buildLocalPlanReplayRequest(plan) ??
    buildLocalFileReplayRequest(plan) ??
    (knowledgeWiki ? buildLocalKnowledgeReplayRequest(plan) : null) ??
    buildLocalWorkReplayRequest(plan);
  if (
    !request ||
    !binding.remoteWorkspaceId ||
    !binding.serverOrigin ||
    !binding.epoch ||
    binding.workspaceId !== actor.workspaceId ||
    pending.some(
      (mutation) =>
        mutation.workspaceId !== actor.workspaceId ||
        mutation.principalId !== actor.principalId,
    ) ||
    plan.mutations.some(
      (mutation) =>
        mutation.workspaceId !== actor.workspaceId ||
        mutation.principalId !== actor.principalId ||
        mutation.state !== "SENDING" ||
        !Number.isSafeInteger(mutation.attemptCount) ||
        mutation.attemptCount < 1 ||
        !mutation.lastAttemptAt ||
        !Number.isFinite(Date.parse(mutation.lastAttemptAt)),
    )
  )
    invalid();
  const receipt = localObject(receiptSnapshot);
  if (
    Object.keys(receipt).some(
      (field) =>
        !["commandId", "deviceId", "result", "effects"].includes(field),
    ) ||
    receipt.commandId !== request.idempotencyKey ||
    receipt.deviceId !== request.deviceId ||
    !Array.isArray(receipt.effects) ||
    !Object.hasOwn(receipt, "result")
  )
    invalid();
  const expected = new Map(
    plan.mutations.map((mutation) => [
      key(mutation.entityType, mutation.entityId),
      mutation,
    ]),
  );
  if (receipt.effects.length !== expected.size) invalid();
  const canonical: CanonicalEffect[] = [];
  const seen = new Set<string>();
  for (const input of receipt.effects) {
    const effect = localObject(input);
    if (
      Object.keys(effect).some(
        (field) =>
          !["collection", "id", "op", "version", "value"].includes(field),
      ) ||
      typeof effect.collection !== "string" ||
      typeof effect.id !== "string"
    )
      invalid();
    if (
      effect.collection === "navigationPreference" &&
      effect.id !== binding.remotePrincipalId
    )
      invalid();
    const purge = plan.command?.name.endsWith(".purge");
    const remoteEffects = localObject(
      localObject(request.body).syncCommand!,
    ).effects;
    const purgeMemo =
      purge &&
      effect.collection === "entityMemos" &&
      Array.isArray(remoteEffects)
        ? plan.mutations[
            remoteEffects.findIndex(
              (e) =>
                localObject(e).collection === "entityMemos" &&
                localObject(e).id === effect.id,
            )
          ]
        : undefined;
    const identity = key(
        effect.collection,
        effect.collection === "entityMemos"
          ? (purgeMemo?.entityId ?? plan.mutations[0]!.entityId)
          : effect.collection === "navigationPreference"
            ? actor.principalId
            : effect.id,
      ),
      original = expected.get(identity);
    if (
      !original ||
      seen.has(identity) ||
      effect.op !== (original.operation === "DELETE" ? "DELETE" : "UPSERT") ||
      effect.version !== (original.baseVersion ?? 0) + 1 ||
      !Object.hasOwn(effect, "value")
    )
      invalid();
    seen.add(identity);
    const value = effect.value;
    if (value === undefined) invalid();
    if (effect.op === "DELETE") {
      if (value !== null) invalid();
    } else {
      if (
        original.entityType === "notes" ||
        original.entityType === "library"
      ) {
        if (!knowledgeWiki) invalid();
        validateLocalCanonicalKnowledgeValue(
          original.entityType,
          original.entityId,
          binding.remoteWorkspaceId,
          effect.version as number,
          value,
        );
      } else if (original.entityType === "entityMemos") {
        if (!memoIdentity) invalid();
        const projected = await projectLocalEntityMemo(
          actor,
          binding,
          value,
          memoIdentity,
        );
        const captured = localObject(localObject(plan.command!.input).input!);
        if (
          projected.remote.id !== effect.id ||
          projected.local.id !== original.entityId ||
          projected.remote.version !== effect.version ||
          !equalLocalJson(receipt.result!, value) ||
          projected.remote.bodyMd !== captured.bodyMd ||
          (projected.remote.deletedAt !== null) !==
            localObject(plan.command!.input).deleted
        )
          invalid();
      } else if (original.entityType === "files") {
        requireCanonicalFile(
          value,
          original.entityId,
          binding.remoteWorkspaceId,
          effect.version as number,
        );
      } else if (original.entityType === "links") {
        requireCanonicalKnowledgeLink(
          value,
          original.entityId,
          binding.remoteWorkspaceId,
          effect.version as number,
        );
      } else if (original.entityType === "workflows") {
        if (!binding.remotePrincipalId) invalid();
        validateLocalCanonicalWorkflowValue(
          original.entityId,
          binding.remoteWorkspaceId,
          effect.version as number,
          value,
        );
      } else if (original.entityType === "projectMaterials") {
        (plan.command?.name === "project.material.delete"
          ? requireProjectMaterialReplica
          : requireCanonicalProjectMaterial)(
          value,
          original.entityId,
          binding.remoteWorkspaceId,
          effect.version as number,
        );
      } else if (original.entityType === "organization") {
        requireCanonicalOrganization(
          value,
          original.entityId,
          binding.remoteWorkspaceId,
          effect.version as number,
        );
      } else if (original.entityType === "categories") {
        if (!binding.remotePrincipalId) invalid();
        requireCanonicalCategory(
          value,
          original.entityId,
          binding.remoteWorkspaceId,
          effect.version as number,
        );
      } else if (original.entityType === "manualOrders") {
        if (!binding.remotePrincipalId) invalid();
        validateLocalCanonicalManualOrder(
          original.entityId,
          binding.remoteWorkspaceId,
          effect.version as number,
          value,
        );
      } else if (original.entityType === "navigationPreference") {
        if (
          original.entityId !== actor.principalId ||
          !binding.remotePrincipalId
        )
          invalid();
        requireCanonicalNavigationPreference(value, effect.version as number);
      } else if (original.entityType === "calendarSettings") {
        if (original.entityId !== "workspace" || !binding.remotePrincipalId)
          invalid();
        requireCanonicalCalendarSettings(value, effect.version as number);
      } else if (original.entityType === "reminders")
        validateLocalCanonicalReminderValue(
          original.entityId,
          binding.remoteWorkspaceId,
          effect.version as number,
          value,
        );
      else
        validateLocalCanonicalWorkValue(
          original.entityType as "items" | "edges",
          original.entityId,
          binding.remoteWorkspaceId,
          effect.version as number,
          value,
        );
    }
    canonical.push({
      collection: original.entityType as CanonicalEffect["collection"],
      id: original.entityId,
      version: effect.version as number,
      value,
    });
  }
  const refs = [
    { collection: "$local.workspace", id: "revision" },
    ...canonical.flatMap((effect) => [
      {
        collection: "$local.remoteBase",
        id: key(effect.collection, effect.id),
      },
      { collection: effect.collection, id: effect.id },
    ]),
  ];
  const loaded = metadata.getMany
    ? await metadata.getMany(actor.workspaceId, refs)
    : await Promise.all(
        refs.map((ref) =>
          metadata.get(actor.workspaceId, ref.collection, ref.id),
        ),
      );
  if (
    loaded.length !== refs.length ||
    loaded.some(
      (entity, index) =>
        entity &&
        (entity.workspaceId !== actor.workspaceId ||
          entity.collection !== refs[index]?.collection ||
          entity.id !== refs[index]?.id),
    )
  )
    invalid();
  const revision = loaded[0] ?? null;
  if (
    revision &&
    (revision.workspaceId !== actor.workspaceId ||
      localObject(revision.value).revision !== revision.version)
  )
    invalid();
  const acceptedIds = new Set(plan.mutationIds);
  const laterKeys = new Set(
    pending
      .filter((mutation) => !acceptedIds.has(mutation.id))
      .map((mutation) => key(mutation.entityType, mutation.entityId)),
  );
  const mutationIdsByEntity = new Map<string, string[]>();
  for (const mutation of plan.mutations) {
    const identity = key(mutation.entityType, mutation.entityId);
    const ids = mutationIdsByEntity.get(identity) ?? [];
    ids.push(mutation.id);
    mutationIdsByEntity.set(identity, ids);
  }
  const records: LocalRecordWrite[] = [];
  for (const [index, effect] of canonical.entries()) {
    const baseId = key(effect.collection, effect.id);
    const base = loaded[1 + index * 2] ?? null;
    const current = loaded[2 + index * 2] ?? null;
    let version = effect.version,
      value = effect.value;
    if (base) {
      const previous = localObject(base.value);
      if (
        base.workspaceId !== actor.workspaceId ||
        previous.remoteWorkspaceId !== binding.remoteWorkspaceId ||
        previous.serverOrigin !== binding.serverOrigin ||
        previous.epoch !== binding.epoch ||
        (previous.remotePrincipalId ?? null) !==
          (binding.remotePrincipalId ?? null) ||
        typeof previous.version !== "number" ||
        !Number.isSafeInteger(previous.version) ||
        previous.version < 1 ||
        previous.value === undefined
      )
        invalid();
      if (
        previous.version === version &&
        !equalLocalJson(previous.value, value)
      ) {
        // A metadata pull can precede recovery of an accepted body-bearing receipt.
        // Require exact manifest metadata and character count before hydrating.
        const knowledge =
          effect.collection === "notes" || effect.collection === "library";
        const full = value === null ? null : localObject(value);
        if (
          !knowledge ||
          !full ||
          typeof full.bodyMd !== "string" ||
          !equalLocalJson(
            previous.value,
            localDto(bodyManifest(full as unknown as Note | LibraryEntry)),
          )
        )
          throw new DomainError("VERSION_CONFLICT");
      }
      if (previous.version > version) {
        version = previous.version;
        value = previous.value;
      }
    }
    const memoIndex = plan.mutations.findIndex(
      (m) => m.entityType === "entityMemos" && m.entityId === effect.id,
    );
    const requested = localObject(
      localObject(request.body).syncCommand!,
    ).effects;
    const memoHint =
      effect.collection === "entityMemos"
        ? localObject(
            value === null ? plan.mutations[memoIndex]!.basePayload! : value,
          )
        : null;
    const memoRemoteId =
      value === null && memoHint && Array.isArray(requested)
        ? localObject(requested[memoIndex]!).id
        : memoHint?.id;
    records.push({
      expectedVersion: base?.version ?? null,
      entity: {
        workspaceId: actor.workspaceId,
        collection: "$local.remoteBase",
        id: baseId,
        version: (base?.version ?? 0) + 1,
        value: localDto({
          remoteWorkspaceId: binding.remoteWorkspaceId,
          ...(binding.remotePrincipalId === undefined
            ? {}
            : { remotePrincipalId: binding.remotePrincipalId }),
          serverOrigin: binding.serverOrigin,
          epoch: binding.epoch,
          collection: effect.collection,
          id: effect.id,
          ...(effect.collection === "entityMemos"
            ? {
                remoteId: memoRemoteId,
                memoTarget: {
                  targetKind: memoHint!.targetKind,
                  targetId: memoHint!.targetId,
                },
              }
            : {}),
          version,
          commandId: plan.id,
          mutationIds: mutationIdsByEntity.get(baseId),
          value,
        }),
      },
    });
    const later = laterKeys.has(baseId);
    if (!later && (!current || current.version <= version)) {
      if (
        (effect.collection === "notes" || effect.collection === "library") &&
        value !== null
      ) {
        if (!knowledgeWiki || value === null) invalid();
        records.push(
          ...(await prepareLocalKnowledgeProjection(
            actor,
            binding.remoteWorkspaceId,
            effect.collection,
            effect.id,
            version,
            value,
            metadata,
            knowledgeWiki,
            binding,
          )),
        );
        continue;
      }
      const projectedMemo =
        effect.collection === "entityMemos" && value !== null && memoIdentity
          ? await projectLocalEntityMemo(actor, binding, value, memoIdentity)
          : null;
      if (
        effect.collection === "entityMemos" &&
        value !== null &&
        (!projectedMemo ||
          projectedMemo.local.id !== effect.id ||
          projectedMemo.local.version !== version)
      )
        invalid();
      const localValue =
        value === null
          ? {
              id: effect.id,
              workspaceId: actor.workspaceId,
              version,
              localTombstone: true,
            }
          : projectedMemo
            ? projectedMemo.local
            : effect.collection === "workflows"
              ? projectLocalRecurrence(
                  value,
                  actor.workspaceId,
                  actor.principalId,
                  binding.remotePrincipalId!,
                )
              : effect.collection === "manualOrders"
                ? projectLocalManualOrder(value, actor.workspaceId)
                : effect.collection === "navigationPreference"
                  ? localDto(
                      requireCanonicalNavigationPreference(value, version),
                    )
                  : effect.collection === "calendarSettings"
                    ? localDto(requireCanonicalCalendarSettings(value, version))
                    : {
                        ...localObject(value),
                        workspaceId: actor.workspaceId,
                        version,
                      };
      records.push({
        expectedVersion: current?.version ?? null,
        entity: {
          workspaceId: actor.workspaceId,
          collection: effect.collection,
          id: effect.id,
          version,
          value: localDto(localValue),
        },
      });
    }
  }
  return {
    workspaceId: actor.workspaceId,
    principalId: actor.principalId,
    expectedWorkspaceVersion: revision?.version ?? null,
    binding,
    nextCursor: binding.cursor,
    records,
    acknowledgements: plan.mutations.map((mutation) => ({
      mutationId: mutation.id,
      deviceId: mutation.deviceId,
      attemptCount: mutation.attemptCount,
      lastAttemptAt: mutation.lastAttemptAt!,
    })),
  };
}
