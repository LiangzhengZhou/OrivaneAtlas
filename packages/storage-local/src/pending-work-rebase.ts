import {
  bodyManifest,
  buildLocalEntityMemoReplayRequest,
  compareLocalMutations,
  equalLocalJson,
  type LocalEntity,
  type LocalMutation,
  type LocalPendingWorkRebase,
  LocalStorageError,
  type LocalSyncState,
  type LocalWorkspaceIdentity,
  localCommandMutationIds,
  localDto,
  localObject,
  projectLocalEntityMemo,
} from "@arclattice/application";
import {
  DomainError,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
} from "@arclattice/domain";
import { deriveEntityMemoId } from "./entity-memo-identity";

/** Reconciliation and its replacement Outbox entry commit together. No network await. */
export async function commitPendingWorkRebase(
  db: IDBDatabase,
  source: LocalPendingWorkRebase,
  indexEntity: (entity: LocalEntity) => LocalEntity,
): Promise<void> {
  const input = structuredClone(source),
    { actor, replacement, original, binding } = input;
  const next = replacement.mutation,
    command = input.replacementCommand;
  const reviewed =
    input.reason === "REVIEWED_LOCAL" || input.reason === "REVIEWED_REMOTE";
  const followers = input.followers ?? [];
  const preserving = followers.length > 0;
  const bad = () => new LocalStorageError("INVALID_WRITE");
  const knowledge =
    original.entityType === "notes" || original.entityType === "library";
  const memo = original.entityType === "entityMemos";
  if (memo) {
    try {
      const base = localObject(input.remoteBase.value);
      const projected = await projectLocalEntityMemo(
        actor,
        binding,
        base.value,
        { forTarget: deriveEntityMemoId },
      );
      const previous = requireEntityMemoRecord(
        original.operation === "CREATE"
          ? original.payload
          : original.basePayload,
      );
      const intended = requireEntityMemoRecord(next.payload);
      requireEntityMemoOwner(actor, previous);
      requireEntityMemoOwner(actor, intended);
      if (
        base.remoteId !== projected.remote.id ||
        base.remoteWorkspaceId !== binding.remoteWorkspaceId ||
        base.remotePrincipalId !== binding.remotePrincipalId ||
        base.serverOrigin !== binding.serverOrigin ||
        base.epoch !== binding.epoch ||
        base.version !== projected.remote.version ||
        projected.local.id !== original.entityId ||
        previous.id !== original.entityId ||
        intended.id !== original.entityId ||
        previous.targetKind !== projected.local.targetKind ||
        previous.targetId !== projected.local.targetId ||
        intended.targetKind !== previous.targetKind ||
        intended.targetId !== previous.targetId ||
        !equalLocalJson(localDto(projected.local), next.basePayload!) ||
        !(await buildLocalEntityMemoReplayRequest(
          {
            id: next.id,
            state: "READY",
            command: {
              name: "memo.save",
              input: localObject(command.value).input!,
            },
            mutationIds: [next.id],
            mutations: [next],
          },
          binding,
          { forTarget: deriveEntityMemoId },
        ))
      )
        throw bad();
    } catch (error) {
      if (error instanceof DomainError) throw bad();
      throw error;
    }
  }
  const commandName = memo
    ? "memo.save"
    : knowledge
      ? original.entityType === "notes"
        ? "note.save"
        : "library.save"
      : original.entityType === "files"
        ? "file.rename"
        : "work.update";
  const manifest = (value: import("@arclattice/application").LocalJson) =>
    knowledge
      ? localDto(
          bodyManifest(
            localObject(value) as unknown as
              | import("@arclattice/application").Note
              | import("@arclattice/application").LibraryEntry,
          ),
        )
      : value;
  const prefix = original.entityType === "notes" ? "note" : "library";
  const projectionKeys =
    knowledge && !preserving
      ? new Set([
          JSON.stringify([`$local.${prefix}Body`, original.entityId]),
          JSON.stringify([
            `$local.${prefix}Revision`,
            JSON.stringify([original.entityId, replacement.entity.version]),
          ]),
          JSON.stringify([`$local.${prefix}Search`, original.entityId]),
          JSON.stringify([
            `$local.${prefix}BodyAvailability`,
            original.entityId,
          ]),
          ...(original.entityType === "library"
            ? [JSON.stringify(["$local.wikiSources", original.entityId])]
            : []),
        ])
      : new Set<string>();
  for (const record of input.projections ?? []) {
    const key = JSON.stringify([record.entity.collection, record.entity.id]);
    if (
      !projectionKeys.delete(key) ||
      record.entity.workspaceId !== actor.workspaceId ||
      record.entity.version !== (record.expectedVersion ?? 0) + 1
    )
      return Promise.reject(bad());
    if (
      record.entity.collection === `$local.${prefix}Body` &&
      !equalLocalJson(
        record.entity.value,
        localDto({
          noteVersion: replacement.entity.version,
          bodyMd: localObject(next.payload).bodyMd,
        }),
      )
    )
      return Promise.reject(bad());
    if (
      record.entity.collection === `$local.${prefix}Revision` &&
      !equalLocalJson(record.entity.value, next.payload)
    )
      return Promise.reject(bad());
  }
  if (projectionKeys.size) return Promise.reject(bad());
  let predecessor = original;
  for (const follower of followers) {
    if (
      !reviewed ||
      !input.preservedCurrent ||
      !original.order ||
      follower.workspaceId !== actor.workspaceId ||
      follower.principalId !== actor.principalId ||
      follower.deviceId !== original.deviceId ||
      follower.entityType !== original.entityType ||
      follower.entityId !== original.entityId ||
      follower.operation !== "PATCH" ||
      follower.state !== "PENDING" ||
      follower.attemptCount !== 0 ||
      follower.lastAttemptAt !== null ||
      !follower.order ||
      !predecessor.order ||
      compareLocalMutations(predecessor, follower) >= 0 ||
      follower.baseVersion !== localObject(predecessor.payload).version ||
      follower.basePayload === undefined ||
      !equalLocalJson(follower.basePayload, predecessor.payload)
    )
      return Promise.reject(bad());
    predecessor = follower;
  }
  if (
    (input.preservedCurrent !== undefined) !== preserving ||
    (preserving &&
      (input.preservedCurrent!.workspaceId !== actor.workspaceId ||
        input.preservedCurrent!.collection !== original.entityType ||
        input.preservedCurrent!.id !== original.entityId ||
        input.preservedCurrent!.version !== replacement.expectedVersion ||
        !equalLocalJson(
          input.preservedCurrent!.value,
          manifest(predecessor.payload),
        )))
  )
    return Promise.reject(bad());
  if (
    (reviewed &&
      (original.attemptCount < 1 || original.lastAttemptAt === null)) ||
    (input.reason !== undefined &&
      !["CLEAN_REBASE", "REVIEWED_LOCAL", "REVIEWED_REMOTE"].includes(
        input.reason,
      )) ||
    actor.workspaceId !== binding.workspaceId ||
    !binding.remotePrincipalId ||
    original.workspaceId !== actor.workspaceId ||
    original.principalId !== actor.principalId ||
    (reviewed
      ? original.state !== "CONFLICT"
      : original.state !== "PENDING" ||
        original.attemptCount !== 0 ||
        original.lastAttemptAt !== null) ||
    !["items", "files", "notes", "library", "entityMemos"].includes(
      original.entityType,
    ) ||
    localObject(input.originalCommand.value).name !== commandName ||
    localObject(command.value).name !== commandName ||
    (original.operation !== "PATCH" &&
      !(
        memo &&
        original.operation === "CREATE" &&
        original.baseVersion === null &&
        original.basePayload === null
      )) ||
    input.originalCommand.id !== original.commandId ||
    localCommandMutationIds(
      input.originalCommand,
      actor.workspaceId,
      actor.principalId,
    )?.join() !== original.id ||
    input.remoteBase.workspaceId !== actor.workspaceId ||
    input.remoteBase.collection !== "$local.remoteBase" ||
    input.remoteBase.id !==
      JSON.stringify([original.entityType, original.entityId]) ||
    next.workspaceId !== actor.workspaceId ||
    next.principalId !== actor.principalId ||
    next.state !== "PENDING" ||
    next.attemptCount !== 0 ||
    next.lastAttemptAt !== null ||
    next.entityId !== original.entityId ||
    next.entityType !== original.entityType ||
    next.operation !== "PATCH" ||
    next.id === original.id ||
    next.commandId !== next.id ||
    next.deviceId !== original.deviceId ||
    replacement.entity.workspaceId !== actor.workspaceId ||
    replacement.entity.collection !== original.entityType ||
    replacement.entity.id !== original.entityId ||
    !equalLocalJson(manifest(next.payload), replacement.entity.value) ||
    replacement.entity.version !== (next.baseVersion ?? 0) + 1 ||
    replacement.expectedVersion === null ||
    (!preserving &&
      replacement.entity.version <= replacement.expectedVersion) ||
    command.id !== next.id ||
    command.version !== 1 ||
    command.collection !== "$local.command" ||
    localCommandMutationIds(
      command,
      actor.workspaceId,
      actor.principalId,
    )?.join() !== next.id ||
    next.order?.transactionVersion !==
      (preserving
        ? original.order!.transactionVersion
        : (input.expectedWorkspaceVersion ?? 0) + 1) ||
    next.order.operationIndex !==
      (preserving ? original.order!.operationIndex : 0)
  )
    return Promise.reject(bad());
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      ["entities", "identity", "sync", "outbox"],
      "readwrite",
      { durability: "strict" },
    );
    const entities = tx.objectStore("entities"),
      outbox = tx.objectStore("outbox");
    let failure: Error | null = null,
      remaining = 0,
      scheduled = false;
    const fail = () => {
      failure = new LocalStorageError("VERSION_CONFLICT");
      tx.abort();
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? tx.error ?? bad());
    const finish = () => {
      if (!scheduled || remaining || failure) return;
      if (!preserving) entities.put(replacement.entity);
      for (const record of input.projections ?? [])
        entities.put(indexEntity(record.entity));
      entities.add(command);
      entities.add({
        workspaceId: actor.workspaceId,
        collection: "$local.superseded",
        id: original.id,
        version: 1,
        value: localDto({
          original,
          commandId: original.commandId,
          replacementId: next.id,
          reason: input.reason ?? "CLEAN_REBASE",
          at: next.createdAt,
        }),
      });
      const revision = (input.expectedWorkspaceVersion ?? 0) + 1;
      entities.put({
        workspaceId: actor.workspaceId,
        collection: "$local.workspace",
        id: "revision",
        version: revision,
        value: { revision },
      });
      outbox.delete([actor.workspaceId, original.id]);
      outbox.add(next);
    };
    const read = <T>(request: IDBRequest<T>, valid: (value: T) => boolean) => {
      remaining++;
      request.onsuccess = () => {
        if (failure) return;
        if (!valid(request.result)) {
          fail();
          return;
        }
        remaining--;
        finish();
      };
    };
    read<LocalWorkspaceIdentity | undefined>(
      tx.objectStore("identity").get("default"),
      (owner) =>
        owner?.workspaceId === actor.workspaceId &&
        owner.principalId === actor.principalId &&
        owner.deviceId === original.deviceId,
    );
    read<LocalSyncState | undefined>(
      tx.objectStore("sync").get(actor.workspaceId),
      (current) =>
        !!current && equalLocalJson(localDto(current), localDto(binding)),
    );
    read<LocalMutation[]>(
      outbox
        .index("entity")
        .getAll([actor.workspaceId, original.entityType, original.entityId]),
      (entries) =>
        entries.length === 1 + followers.length &&
        [original, ...followers].every((expected) =>
          entries.some((entry) =>
            equalLocalJson(localDto(entry), localDto(expected)),
          ),
        ),
    );
    read<LocalMutation | undefined>(
      outbox.get([actor.workspaceId, next.id]),
      (entry) => entry === undefined,
    );
    read<LocalEntity | undefined>(
      entities.get([actor.workspaceId, "$local.workspace", "revision"]),
      (entry) => (entry?.version ?? null) === input.expectedWorkspaceVersion,
    );
    for (const record of [input.originalCommand, input.remoteBase])
      read<LocalEntity | undefined>(
        entities.get([actor.workspaceId, record.collection, record.id]),
        (current) =>
          !!current && equalLocalJson(localDto(current), localDto(record)),
      );
    read<LocalEntity | undefined>(
      entities.get([actor.workspaceId, original.entityType, original.entityId]),
      (current) =>
        !!current &&
        current.version === replacement.expectedVersion &&
        equalLocalJson(
          current.value,
          preserving
            ? input.preservedCurrent!.value
            : manifest(original.payload),
        ),
    );
    for (const record of input.projections ?? [])
      read<LocalEntity | undefined>(
        entities.get([
          actor.workspaceId,
          record.entity.collection,
          record.entity.id,
        ]),
        (current) => (current?.version ?? null) === record.expectedVersion,
      );
    scheduled = true;
    finish();
  });
}
