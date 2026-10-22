import {
  type ActorContext,
  DomainError,
  requireCalendarTimezone,
} from "@arclattice/domain";
import { requireCanonicalCalendarSettings } from "./calendar-replay-effects";
import { requireCanonicalCategory } from "./category-replay-effects";
import type { EntityMemoIdentity, EntityMemoTarget } from "./entity-memos";
import type { LibraryEntry } from "./library";
import { requireCanonicalKnowledgeLink } from "./linked-knowledge-replay-effects";
import { projectLocalEntityMemo } from "./local-canonical-entity-memo";
import { requireCanonicalFile } from "./local-canonical-file";
import { validateLocalCanonicalKnowledgeManifest } from "./local-canonical-knowledge";
import {
  projectLocalManualOrder,
  validateLocalCanonicalManualOrder,
} from "./local-canonical-manual-order";
import { projectLocalRecurrence } from "./local-canonical-recurrence";
import { validateLocalCanonicalReminderValue } from "./local-canonical-reminder";
import { validateLocalCanonicalWorkValue } from "./local-canonical-work";
import { validateLocalCanonicalWorkflowValue } from "./local-canonical-workflow";
import { localDto, localObject } from "./local-dto";
import { equalLocalJson } from "./local-json-equal";
import { prepareLocalKnowledgeManifestProjection } from "./local-knowledge-manifest-projection";
import type {
  LocalEntity,
  LocalJson,
  LocalMetadataStore,
  LocalMutation,
  LocalRecordWrite,
  LocalSyncState,
} from "./local-persistence";
import type { LocalReplicaCommit } from "./local-replica";
import { requireCanonicalNavigationPreference } from "./navigation-replay-effects";
import type { Note } from "./notebook";
import { requireCanonicalOrganization } from "./organization-replay-effects";
import { requireProjectMaterialReplica } from "./project-knowledge-replay-effects";
import { bodyManifest } from "./workspace-bootstrap";

const key = (collection: string, id: string) =>
  JSON.stringify([collection, id]);
function invalid(): never {
  throw new DomainError("VALIDATION_ERROR", { field: "workDelta" });
}
interface Effect {
  collection:
    | "items"
    | "edges"
    | "notes"
    | "library"
    | "wikiLinks"
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
  remoteId?: string;
  memoTarget?: EntityMemoTarget;
  unseenMemoDelete?: boolean;
}

/** Work/knowledge metadata projection. Other collections stop cursor advancement safely. */
export async function prepareLocalWorkPull(
  actor: ActorContext,
  binding: LocalSyncState,
  page: unknown,
  pending: readonly LocalMutation[],
  metadata: LocalMetadataStore,
  memoIdentity?: Pick<EntityMemoIdentity, "forTarget">,
): Promise<LocalReplicaCommit | null> {
  return prepareProjection(
    actor,
    binding,
    page,
    pending,
    metadata,
    memoIdentity,
    false,
  );
}

/** Full metadata is a distinct input, never invented change-log sequences. */
export async function prepareLocalWorkspaceBootstrap(
  actor: ActorContext,
  binding: LocalSyncState,
  manifestInput: unknown,
  pending: readonly LocalMutation[],
  metadata: LocalMetadataStore,
  memoIdentity?: Pick<EntityMemoIdentity, "forTarget">,
): Promise<LocalReplicaCommit> {
  const manifest = localObject(localDto(manifestInput));
  const workspace = localObject(manifest.workspace!);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.epoch !== binding.epoch ||
    typeof manifest.cursor !== "number" ||
    manifest.cursor < binding.cursor
  )
    throw new DomainError("VERSION_CONFLICT", { field: "workspaceBootstrap" });
  const collections: Record<
    string,
    { upserts: LocalJson[]; removed: string[] }
  > = {};
  const records: LocalJson[] = [];
  for (const name of [
    "items",
    "edges",
    "categories",
    "organization",
    "projectMaterials",
    "links",
    "reminders",
    "workflows",
    "manualOrders",
    "wikiLinks",
    "files",
    "notes",
    "library",
  ]) {
    const source =
      name === "notes" || name === "library" ? manifest[name] : workspace[name];
    if (
      source === undefined &&
      [
        "items",
        "edges",
        "notes",
        "library",
        "projectMaterials",
        "organization",
        "links",
      ].includes(name)
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "incompleteWorkspaceBootstrap",
      });
    const entries = source ?? [];
    if (!Array.isArray(entries)) throw new DomainError("VALIDATION_ERROR");
    collections[name] = { upserts: entries, removed: [] };
    for (const entry of entries) {
      const entity = localObject(entry);
      records.push({
        workspaceId: binding.remoteWorkspaceId!,
        collection: name,
        entityId:
          name === "organization" ? `${entity.kind}:${entity.id}` : entity.id!,
        version: name === "edges" ? 1 : entity.version!,
        op: "UPSERT",
      });
    }
  }
  const values: Record<string, LocalJson> = {};
  for (const name of ["calendarSettings", "navigationPreference"]) {
    const value = workspace[name];
    if (value === undefined || localObject(value).version === 0) continue;
    values[name] = value;
    records.push({
      workspaceId: binding.remoteWorkspaceId!,
      collection: name,
      entityId:
        name === "calendarSettings" ? "workspace" : binding.remotePrincipalId!,
      version: localObject(value).version!,
      op: "UPSERT",
    });
  }
  const prepared = await prepareProjection(
    actor,
    binding,
    {
      epoch: manifest.epoch,
      cursor: manifest.cursor,
      recovery: false,
      hasMore: false,
      snapshot: null,
      records,
      changes: { collections, values },
    },
    pending,
    metadata,
    memoIdentity,
    true,
  );
  const revision = prepared
    ? null
    : await metadata.get(actor.workspaceId, "$local.workspace", "revision");
  const marker = await metadata.get(
    actor.workspaceId,
    "$local.workspaceBootstrap",
    "complete",
  );
  const base = prepared ?? {
    workspaceId: actor.workspaceId,
    principalId: actor.principalId,
    binding,
    nextCursor: manifest.cursor,
    expectedWorkspaceVersion: revision?.version ?? null,
    records: [],
  };
  return {
    ...base,
    records: [
      ...base.records,
      {
        expectedVersion: marker?.version ?? null,
        entity: {
          workspaceId: actor.workspaceId,
          collection: "$local.workspaceBootstrap",
          id: "complete",
          version: (marker?.version ?? 0) + 1,
          value: {
            schemaVersion: 1,
            serverOrigin: binding.serverOrigin,
            remoteWorkspaceId: binding.remoteWorkspaceId,
            remotePrincipalId: binding.remotePrincipalId!,
            epoch: binding.epoch,
            cursor: manifest.cursor,
          },
        },
      },
    ],
  };
}

async function prepareProjection(
  actorInput: ActorContext,
  bindingInput: LocalSyncState,
  pageInput: unknown,
  pendingInput: readonly LocalMutation[],
  metadata: LocalMetadataStore,
  memoIdentity?: Pick<EntityMemoIdentity, "forTarget">,
  fullSnapshot = false,
): Promise<LocalReplicaCommit | null> {
  const actor = { ...actorInput },
    binding = structuredClone(bindingInput),
    pending = structuredClone(pendingInput);
  if (
    !actor.workspaceId ||
    !actor.principalId ||
    !Number.isSafeInteger(binding.version) ||
    binding.version < 1 ||
    !Number.isSafeInteger(binding.cursor) ||
    binding.cursor < 0 ||
    binding.workspaceId !== actor.workspaceId ||
    !binding.remotePrincipalId ||
    !binding.remoteWorkspaceId ||
    !binding.serverOrigin ||
    !binding.epoch ||
    pending.some(
      (mutation) =>
        mutation.workspaceId !== actor.workspaceId ||
        mutation.principalId !== actor.principalId,
    )
  )
    invalid();
  const page = localObject(localDto(pageInput));
  if (page.recovery === true || page.epoch !== binding.epoch)
    throw new DomainError("VERSION_CONFLICT", { field: "syncEpoch" });
  if (
    page.recovery !== false ||
    page.snapshot !== null ||
    typeof page.hasMore !== "boolean" ||
    typeof page.cursor !== "number" ||
    !Number.isSafeInteger(page.cursor) ||
    page.cursor < binding.cursor ||
    !Array.isArray(page.records) ||
    page.records.length > (fullSnapshot ? 100000 : 2000)
  )
    invalid();
  const changes = localObject(page.changes!),
    collections = localObject(changes.collections!),
    values = localObject(changes.values!);
  if (
    Object.keys(values).some(
      (name) =>
        ![
          "calendarSettings",
          "calendarTimezone",
          "navigationPreference",
        ].includes(name),
    ) ||
    Object.keys(collections).some(
      (collection) =>
        ![
          "items",
          "edges",
          "notes",
          "library",
          "wikiLinks",
          "reminders",
          "manualOrders",
          "categories",
          "organization",
          "projectMaterials",
          "workflows",
          "links",
          "files",
          ...(memoIdentity ? ["entityMemos"] : []),
        ].includes(collection),
    )
  )
    throw new DomainError("VALIDATION_ERROR", {
      field: "unsupportedSyncCollection",
    });
  let lastSeq = binding.cursor;
  const logged = new Map<
    string,
    { collection: Effect["collection"]; id: string; version: number }
  >();
  for (const input of page.records) {
    const record = localObject(input);
    if (
      record.workspaceId !== binding.remoteWorkspaceId ||
      (!fullSnapshot &&
        (typeof record.seq !== "number" ||
          !Number.isSafeInteger(record.seq) ||
          record.seq <= lastSeq ||
          record.seq > page.cursor)) ||
      typeof record.entityId !== "string" ||
      !record.entityId ||
      record.entityId.length > 240 ||
      typeof record.version !== "number" ||
      !Number.isSafeInteger(record.version) ||
      record.version < 1 ||
      !["UPSERT", "DELETE"].includes(String(record.op))
    )
      invalid();
    if (
      record.collection !== "items" &&
      record.collection !== "edges" &&
      record.collection !== "notes" &&
      record.collection !== "library" &&
      record.collection !== "wikiLinks" &&
      record.collection !== "reminders" &&
      record.collection !== "calendarSettings" &&
      record.collection !== "navigationPreference" &&
      record.collection !== "manualOrders" &&
      record.collection !== "categories" &&
      record.collection !== "organization" &&
      record.collection !== "projectMaterials" &&
      record.collection !== "workflows" &&
      record.collection !== "links" &&
      record.collection !== "files" &&
      !(memoIdentity && record.collection === "entityMemos")
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "unsupportedSyncCollection",
      });
    if (!fullSnapshot) lastSeq = record.seq as number;
    if (
      record.collection === "calendarSettings" &&
      (record.entityId !== "workspace" || record.op !== "UPSERT")
    )
      invalid();
    if (
      record.collection === "navigationPreference" &&
      (record.entityId !== binding.remotePrincipalId || record.op !== "UPSERT")
    )
      invalid();
    const entityId =
      record.collection === "navigationPreference"
        ? actor.principalId
        : record.entityId;
    logged.set(key(record.collection, entityId), {
      collection: record.collection,
      id: entityId,
      version: record.version,
    });
  }
  const effects = new Map<string, Effect>();
  if (values.navigationPreference !== undefined) {
    const record = logged.get(key("navigationPreference", actor.principalId)),
      value = localObject(values.navigationPreference);
    if (
      !record ||
      typeof value.version !== "number" ||
      value.version < record.version
    )
      invalid();
    const canonical = requireCanonicalNavigationPreference(
      value,
      value.version,
    );
    effects.set(key("navigationPreference", actor.principalId), {
      collection: "navigationPreference",
      id: actor.principalId,
      version: canonical.version,
      value: localDto(canonical),
    });
  }
  if (values.calendarSettings !== undefined) {
    const record = logged.get(key("calendarSettings", "workspace"));
    const value = localObject(values.calendarSettings);
    if (
      !record ||
      typeof value.version !== "number" ||
      value.version < record.version
    )
      invalid();
    const canonical = requireCanonicalCalendarSettings(value, value.version);
    if (
      values.calendarTimezone !== undefined &&
      (typeof values.calendarTimezone !== "string" ||
        (canonical.timezone !== null &&
          values.calendarTimezone !== canonical.timezone))
    )
      invalid();
    if (typeof values.calendarTimezone === "string")
      requireCalendarTimezone(values.calendarTimezone);
    effects.set(key("calendarSettings", "workspace"), {
      collection: "calendarSettings",
      id: "workspace",
      version: canonical.version,
      value: localDto(canonical),
    });
  } else if (values.calendarTimezone !== undefined) invalid();
  for (const [name, input] of Object.entries(collections)) {
    const collection = name as Effect["collection"],
      change = localObject(input);
    if (
      collection === "calendarSettings" ||
      collection === "navigationPreference"
    )
      invalid();
    if (!Array.isArray(change.upserts) || !Array.isArray(change.removed))
      invalid();
    for (const value of change.upserts) {
      const entity = localObject(value);
      if (typeof entity.id !== "string") invalid();
      const entityId =
        collection === "organization"
          ? `${entity.kind}:${entity.id}`
          : entity.id;
      const id = key(collection, entityId),
        record = logged.get(id);
      const version = collection === "edges" ? 1 : entity.version;
      if (
        !record ||
        effects.has(id) ||
        typeof version !== "number" ||
        version < record.version
      )
        invalid();
      if (collection === "entityMemos") {
        if (!memoIdentity) invalid();
        const projected = await projectLocalEntityMemo(
          actor,
          binding,
          value,
          memoIdentity,
        );
        effects.set(id, {
          collection,
          id: projected.local.id,
          remoteId: projected.remote.id,
          memoTarget: {
            targetKind: projected.remote.targetKind,
            targetId: projected.remote.targetId,
          },
          version: projected.remote.version,
          value,
        });
        continue;
      }
      if (collection === "notes" || collection === "library")
        validateLocalCanonicalKnowledgeManifest(
          collection,
          entityId,
          binding.remoteWorkspaceId,
          version,
          value,
        );
      else if (collection === "files")
        requireCanonicalFile(
          value,
          entityId,
          binding.remoteWorkspaceId,
          version,
        );
      else if (collection === "links")
        requireCanonicalKnowledgeLink(
          value,
          entityId,
          binding.remoteWorkspaceId,
          version,
        );
      else if (collection === "workflows")
        validateLocalCanonicalWorkflowValue(
          entityId,
          binding.remoteWorkspaceId,
          version,
          value,
        );
      else if (collection === "projectMaterials")
        requireProjectMaterialReplica(
          value,
          entityId,
          binding.remoteWorkspaceId,
          version,
        );
      else if (collection === "organization")
        requireCanonicalOrganization(
          value,
          entityId,
          binding.remoteWorkspaceId,
          version,
        );
      else if (collection === "categories")
        requireCanonicalCategory(
          value,
          entity.id,
          binding.remoteWorkspaceId,
          version,
        );
      else if (collection === "manualOrders")
        validateLocalCanonicalManualOrder(
          entity.id,
          binding.remoteWorkspaceId,
          version,
          value,
        );
      else if (collection === "reminders")
        validateLocalCanonicalReminderValue(
          entity.id,
          binding.remoteWorkspaceId,
          version,
          value,
        );
      else if (collection === "wikiLinks") {
        if (
          entity.workspaceId !== binding.remoteWorkspaceId ||
          entity.version !== version ||
          typeof entity.sourceDocumentId !== "string" ||
          !entity.sourceDocumentId ||
          (entity.targetDocumentId !== null &&
            typeof entity.targetDocumentId !== "string") ||
          typeof entity.targetText !== "string" ||
          (entity.alias !== null && typeof entity.alias !== "string") ||
          (entity.heading !== null && typeof entity.heading !== "string")
        )
          invalid();
      } else
        validateLocalCanonicalWorkValue(
          collection,
          entity.id,
          binding.remoteWorkspaceId,
          version,
          value,
        );
      effects.set(id, { collection, id: entityId, version, value });
    }
    for (const id of change.removed) {
      if (typeof id !== "string") invalid();
      const identity = key(collection, id),
        record = logged.get(identity);
      if (!record || effects.has(identity)) invalid();
      if (collection === "entityMemos") {
        if (!memoIdentity) invalid();
        // A never-hydrated purged memo has no local state to remove. Existing
        // local memos can be mapped without trusting an arbitrary remote ID.
        const candidates = await metadata.list(
          actor.workspaceId,
          "entityMemos",
        );
        let mapped: { id: string; target: EntityMemoTarget } | null = null;
        for (const candidate of candidates) {
          if (
            candidate.value === null ||
            localObject(candidate.value).localTombstone === true
          )
            continue;
          const local = localObject(candidate.value);
          const projected = await projectLocalEntityMemo(
            actor,
            binding,
            {
              ...local,
              id: await memoIdentity.forTarget(
                {
                  workspaceId: binding.remoteWorkspaceId,
                  principalId: binding.remotePrincipalId,
                },
                local as unknown as EntityMemoTarget,
              ),
              workspaceId: binding.remoteWorkspaceId,
              ownerPrincipalId: binding.remotePrincipalId,
              createdBy: binding.remotePrincipalId,
              updatedBy: binding.remotePrincipalId,
            },
            memoIdentity,
          );
          if (
            candidate.id !== projected.local.id ||
            candidate.version !== projected.local.version ||
            !equalLocalJson(candidate.value, localDto(projected.local))
          )
            invalid();
          if (projected.remote.id === id)
            mapped = {
              id: candidate.id,
              target: {
                targetKind: projected.local.targetKind,
                targetId: projected.local.targetId,
              },
            };
        }
        effects.set(identity, {
          collection,
          id: mapped?.id ?? id,
          remoteId: id,
          ...(mapped
            ? { memoTarget: mapped.target }
            : { unseenMemoDelete: true }),
          version: record.version + 1,
          value: null,
        });
        continue;
      }
      effects.set(identity, {
        collection,
        id,
        version: record.version + 1,
        value: null,
      });
    }
  }
  if (effects.size !== logged.size) invalid();
  if (!effects.size && page.cursor === binding.cursor) return null;
  const ordered = [...effects.values()].filter(
    (effect) => !effect.unseenMemoDelete,
  );
  const refs = [
    { collection: "$local.workspace", id: "revision" },
    ...ordered.flatMap((effect) => [
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
        entity !== null &&
        (entity.workspaceId !== actor.workspaceId ||
          entity.collection !== refs[index]!.collection ||
          entity.id !== refs[index]!.id),
    )
  )
    invalid();
  const pendingKeys = new Set(
    pending.map((mutation) => key(mutation.entityType, mutation.entityId)),
  );
  const records: LocalRecordWrite[] = [];
  for (const [index, effect] of ordered.entries()) {
    const base = loaded[1 + index * 2] ?? null,
      current = loaded[2 + index * 2] ?? null;
    let version = effect.version,
      value = effect.value;
    if (base) {
      const previous = localObject(base.value);
      if (
        previous.collection !== effect.collection ||
        previous.id !== effect.id ||
        (effect.collection === "entityMemos" &&
          previous.remoteId !== effect.remoteId) ||
        previous.remoteWorkspaceId !== binding.remoteWorkspaceId ||
        previous.remotePrincipalId !== binding.remotePrincipalId ||
        previous.serverOrigin !== binding.serverOrigin ||
        previous.epoch !== binding.epoch ||
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
        const knowledge =
          effect.collection === "notes" || effect.collection === "library";
        const previousValue =
          previous.value === null ? null : localObject(previous.value);
        if (
          !knowledge ||
          !previousValue ||
          typeof previousValue.bodyMd !== "string" ||
          !equalLocalJson(
            localDto(
              bodyManifest(previousValue as unknown as Note | LibraryEntry),
            ),
            value,
          )
        )
          throw new DomainError("VERSION_CONFLICT");
        value = previous.value;
      }
      if (previous.version > version) {
        if (previous.value === null && value !== null)
          throw new DomainError("VERSION_CONFLICT", {
            field: "syncDeletedIdentity",
          });
        version = previous.version;
        value = previous.value;
      }
    }
    const identity = key(effect.collection, effect.id);
    if (!base && current && !pendingKeys.has(identity))
      throw new DomainError("VERSION_CONFLICT", { field: "syncIdCollision" });
    records.push({
      expectedVersion: base?.version ?? null,
      entity: {
        workspaceId: actor.workspaceId,
        collection: "$local.remoteBase",
        id: identity,
        version: (base?.version ?? 0) + 1,
        value: localDto({
          remoteWorkspaceId: binding.remoteWorkspaceId,
          remotePrincipalId: binding.remotePrincipalId,
          serverOrigin: binding.serverOrigin,
          epoch: binding.epoch,
          collection: effect.collection,
          id: effect.id,
          ...(effect.collection === "entityMemos"
            ? { remoteId: effect.remoteId, memoTarget: effect.memoTarget }
            : {}),
          version,
          value,
        }),
      },
    });
    if (!pendingKeys.has(identity)) {
      if (current && current.version > version)
        throw new DomainError("VERSION_CONFLICT");
      if (
        value !== null &&
        (effect.collection === "notes" || effect.collection === "library")
      ) {
        const full = localObject(value);
        const manifest =
          typeof full.bodyMd === "string"
            ? localDto(bodyManifest(full as unknown as Note | LibraryEntry))
            : value;
        const localManifest = localDto({
          ...localObject(manifest),
          workspaceId: actor.workspaceId,
        });
        if (
          current?.version === version &&
          equalLocalJson(current.value, localManifest)
        )
          continue;
        records.push(
          ...(await prepareLocalKnowledgeManifestProjection(
            actor,
            binding,
            effect.collection,
            effect.id,
            version,
            manifest,
            metadata,
          )),
        );
        continue;
      }
      const canonical: LocalEntity = {
        workspaceId: actor.workspaceId,
        collection: effect.collection,
        id: effect.id,
        version,
        value:
          value === null
            ? {
                id: effect.id,
                workspaceId: actor.workspaceId,
                version,
                localTombstone: true,
              }
            : effect.collection === "entityMemos" && memoIdentity
              ? localDto(
                  (
                    await projectLocalEntityMemo(
                      actor,
                      binding,
                      value,
                      memoIdentity,
                    )
                  ).local,
                )
              : effect.collection === "workflows"
                ? projectLocalRecurrence(
                    value,
                    actor.workspaceId,
                    actor.principalId,
                    binding.remotePrincipalId,
                  )
                : effect.collection === "manualOrders"
                  ? projectLocalManualOrder(value, actor.workspaceId)
                  : effect.collection === "navigationPreference"
                    ? localDto(
                        requireCanonicalNavigationPreference(value, version),
                      )
                    : effect.collection === "calendarSettings"
                      ? localDto(
                          requireCanonicalCalendarSettings(value, version),
                        )
                      : localDto({
                          ...localObject(value),
                          workspaceId: actor.workspaceId,
                          ...(effect.collection === "items" ? { version } : {}),
                        }),
      };
      records.push({
        expectedVersion: current?.version ?? null,
        entity: canonical,
      });
    }
  }
  return {
    workspaceId: actor.workspaceId,
    principalId: actor.principalId,
    binding,
    expectedWorkspaceVersion: loaded[0]?.version ?? null,
    nextCursor: page.cursor,
    records,
  };
}
