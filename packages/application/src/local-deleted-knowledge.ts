import { type ActorContext, DomainError } from "@arclattice/domain";
import type { Clock, IdGenerator } from "./index";
import type { LibraryInput } from "./library";
import { validateLocalCanonicalKnowledgeValue } from "./local-canonical-knowledge";
import { localDto, localObject } from "./local-dto";
import { equalLocalJson } from "./local-json-equal";
import { prepareLocalKnowledgeProjection } from "./local-knowledge-projection";
import type { LocalWikiIndexer } from "./local-library-store";
import type { LocalWorkConflictReview } from "./local-pending-work-rebase";
import type {
  LocalBlobStore,
  LocalMetadataStore,
  LocalOutboxStore,
  LocalRecordWrite,
  LocalWrite,
} from "./local-persistence";
import { LocalRuntime } from "./local-runtime";
import { listLocalWorkConflictReviews } from "./local-work-conflict-review";
import { LocalWorkspace } from "./local-workspace";
import type { NoteInput } from "./notebook";

export type DeletedKnowledgeChoice = "RESTORE" | "REMOTE" | "COPY";
export interface LocalDeletedKnowledgeResolution {
  actor: ActorContext;
  captured: LocalWorkConflictReview;
  choice: DeletedKnowledgeChoice;
  writes: readonly LocalWrite[];
  records: readonly LocalRecordWrite[];
  resultId: string;
}
export interface LocalDeletedKnowledgeStore {
  /** Retire only the captured conflict, retain its evidence, and commit all projections atomically. */
  commit(input: LocalDeletedKnowledgeResolution): Promise<void>;
}

/** Prepare through ordinary Application services without changing the live replica. */
export async function prepareLocalDeletedKnowledge(
  actorInput: ActorContext,
  capturedInput: LocalWorkConflictReview,
  choice: DeletedKnowledgeChoice,
  metadata: LocalMetadataStore,
  outbox: LocalOutboxStore,
  blobs: LocalBlobStore,
  wiki: LocalWikiIndexer,
  clock: Clock,
  ids: IdGenerator,
): Promise<LocalDeletedKnowledgeResolution> {
  const actor = Object.freeze({ ...actorInput }),
    captured = structuredClone(capturedInput);
  if (!["RESTORE", "REMOTE", "COPY"].includes(choice))
    throw new DomainError("VALIDATION_ERROR");
  const current = (
    await listLocalWorkConflictReviews(
      actor,
      captured.binding,
      metadata,
      outbox,
    )
  ).find((review) => review.original.id === captured.original.id);
  if (!current || !equalLocalJson(localDto(current), localDto(captured)))
    throw new DomainError("VERSION_CONFLICT", { field: "conflictReview" });
  const { original, binding } = captured;
  const collection = original.entityType;
  if (
    (collection !== "notes" && collection !== "library") ||
    captured.followers?.length ||
    original.state !== "CONFLICT" ||
    original.attemptCount < 1 ||
    !original.lastAttemptAt ||
    original.principalId !== actor.principalId
  )
    throw new DomainError("VALIDATION_ERROR", { field: "deletedKnowledge" });
  const command = localObject(captured.originalCommand.value);
  if (command.name !== (collection === "notes" ? "note.save" : "library.save"))
    throw new DomainError("VALIDATION_ERROR");
  const intent = localObject(command.input!);
  const input = localObject(intent.input!);
  const remote = localObject(captured.remoteBase.value);
  const canonical = validateLocalCanonicalKnowledgeValue(
    collection,
    original.entityId,
    binding.remoteWorkspaceId!,
    Number(remote.version),
    remote.value!,
  );
  if (
    !canonical.deletedAt ||
    (collection === "library" && canonical.kind !== "DOCUMENT") ||
    typeof input.bodyMd !== "string" ||
    intent.id !== original.entityId ||
    intent.create !== false ||
    intent.version !== original.baseVersion
  )
    throw new DomainError("VALIDATION_ERROR", { field: "deletedKnowledge" });
  const canonicalRecords = await prepareLocalKnowledgeProjection(
    actor,
    binding.remoteWorkspaceId!,
    collection,
    original.entityId,
    canonical.version,
    localDto(canonical),
    metadata,
    wiki,
    binding,
  );
  const overlay = new Map(
    canonicalRecords
      .filter(
        (record) =>
          record.entity.collection === collection ||
          record.entity.collection ===
            (collection === "notes" ? "$local.noteBody" : "$local.libraryBody"),
      )
      .map((record) => [
        JSON.stringify([record.entity.collection, record.entity.id]),
        record.entity.collection === collection
          ? record.entity
          : {
              ...record.entity,
              version: record.expectedVersion ?? 0,
            },
      ]),
  );
  let staged: {
    writes: readonly LocalWrite[];
    records: readonly LocalRecordWrite[];
  } | null = null;
  const shadow: LocalMetadataStore = {
    get: async (workspaceId, kind, id) =>
      structuredClone(
        overlay.get(JSON.stringify([kind, id])) ??
          (await metadata.get(workspaceId, kind, id)),
      ),
    list: async (workspaceId, kind) => {
      const entries = new Map(
        (await metadata.list(workspaceId, kind)).map((entry) => [
          entry.id,
          entry,
        ]),
      );
      for (const entry of overlay.values())
        if (entry.collection === kind) entries.set(entry.id, entry);
      return structuredClone([...entries.values()]);
    },
    commit: async (workspaceId, principalId, writes, records = []) => {
      if (
        staged ||
        workspaceId !== actor.workspaceId ||
        principalId !== actor.principalId
      )
        throw new DomainError("FORBIDDEN");
      staged = structuredClone({ writes, records });
    },
  };
  let resultId = original.entityId;
  if (choice !== "REMOTE") {
    const runtime = new LocalRuntime(
      new LocalWorkspace(
        shadow,
        blobs,
        {
          schemaVersion: 1,
          ...actor,
          deviceId: original.deviceId,
        },
        wiki,
        clock,
        ids,
      ),
    );
    const result =
      collection === "notes"
        ? choice === "RESTORE"
          ? await runtime.restoreNoteAndSave(
              original.entityId,
              canonical.version,
              input as unknown as NoteInput,
            )
          : await runtime.saveNote(null, 0, input as unknown as NoteInput)
        : choice === "RESTORE"
          ? await runtime.restoreLibraryAndSave(
              original.entityId,
              canonical.version,
              input as unknown as LibraryInput,
            )
          : await runtime.saveLibrary(
              null,
              0,
              input as unknown as LibraryInput,
            );
    resultId = result.id;
    if (!staged) throw new DomainError("VALIDATION_ERROR");
  }
  const batch = staged as {
    writes: readonly LocalWrite[];
    records: readonly LocalRecordWrite[];
  } | null;
  const records: LocalRecordWrite[] = [...(batch?.records ?? [])];
  const used = new Set(
    records.map((record) =>
      JSON.stringify([record.entity.collection, record.entity.id]),
    ),
  );
  for (const record of canonicalRecords) {
    if (choice === "RESTORE" && record.entity.collection === collection)
      continue;
    if (
      !used.has(JSON.stringify([record.entity.collection, record.entity.id]))
    ) {
      const finalVersion =
        choice === "RESTORE" &&
        record.entity.collection.endsWith("BodyAvailability")
          ? canonical.version + 2
          : null;
      records.push(
        finalVersion === null
          ? record
          : {
              ...record,
              entity: {
                ...record.entity,
                value: localDto({
                  ...localObject(record.entity.value),
                  entityVersion: finalVersion,
                }),
              },
            },
      );
    }
  }
  if (!batch)
    records.push({
      expectedVersion: captured.expectedWorkspaceVersion,
      entity: {
        workspaceId: actor.workspaceId,
        collection: "$local.workspace",
        id: "revision",
        version: (captured.expectedWorkspaceVersion ?? 0) + 1,
        value: { revision: (captured.expectedWorkspaceVersion ?? 0) + 1 },
      },
    });
  records.push({
    expectedVersion: null,
    entity: {
      workspaceId: actor.workspaceId,
      collection: "$local.superseded",
      id: original.id,
      version: 1,
      value: localDto({
        reason: "REVIEWED_DELETION",
        choice,
        at: clock.now(),
        original,
        originalCommand: captured.originalCommand,
        remoteBase: captured.remoteBase,
        resultId,
        replacementCommandIds: [
          ...new Set(
            (batch?.writes ?? []).map((write) => write.mutation.commandId),
          ),
        ],
      }),
    },
  });
  return structuredClone({
    actor,
    captured,
    choice,
    writes: batch?.writes ?? [],
    records,
    resultId,
  });
}
