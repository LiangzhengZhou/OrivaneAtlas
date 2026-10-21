import {
  bodyManifest,
  equalLocalJson,
  type LocalDeletedKnowledgeResolution,
  type LocalEntity,
  type LocalMutation,
  LocalStorageError,
  type LocalSyncState,
  type LocalWorkspaceIdentity,
  localDto,
  localObject,
  validateLocalCanonicalKnowledgeValue,
} from "@arclattice/application";

/** Queue all read guards inside the business transaction, with no network or awaited callbacks. */
export function guardDeletedKnowledge(
  tx: IDBTransaction,
  input: LocalDeletedKnowledgeResolution,
  abort: (error: Error) => void,
  validatedPurgedMemo = false,
) {
  const { actor, captured, choice } = input;
  const { original, binding } = captured;
  const invalid = () => new LocalStorageError("INVALID_WRITE");
  if (
    (!validatedPurgedMemo && captured.followers?.length) ||
    original.state !== "CONFLICT" ||
    original.attemptCount < 1 ||
    !original.lastAttemptAt ||
    original.workspaceId !== actor.workspaceId ||
    original.principalId !== actor.principalId ||
    !(validatedPurgedMemo
      ? original.entityType === "entityMemos" && choice === "REMOTE"
      : ["notes", "library"].includes(original.entityType)) ||
    !["RESTORE", "REMOTE", "COPY"].includes(choice) ||
    binding.workspaceId !== actor.workspaceId
  )
    throw invalid();
  if (!validatedPurgedMemo) {
    const remote = localObject(captured.remoteBase.value);
    const canonical = validateLocalCanonicalKnowledgeValue(
      original.entityType as "notes" | "library",
      original.entityId,
      binding.remoteWorkspaceId!,
      Number(remote.version),
      remote.value!,
    );
    if (
      !canonical.deletedAt ||
      (original.entityType === "library" && canonical.kind !== "DOCUMENT")
    )
      throw invalid();
    const primary = input.records.filter(
      (record) => !record.entity.collection.startsWith("$local."),
    );
    if (choice === "RESTORE") {
      if (
        primary.length ||
        input.writes.length !== 2 ||
        input.resultId !== original.entityId ||
        input.writes.some(
          (write, index) =>
            write.entity.collection !== original.entityType ||
            write.entity.id !== original.entityId ||
            write.expectedVersion !== canonical.version + index ||
            localObject(write.mutation.payload).deletedAt !== null,
        )
      )
        throw invalid();
    } else {
      if (
        primary.length !== 1 ||
        primary[0]!.entity.collection !== original.entityType ||
        primary[0]!.entity.id !== original.entityId ||
        !equalLocalJson(
          primary[0]!.entity.value,
          localDto(
            bodyManifest({ ...canonical, workspaceId: actor.workspaceId }),
          ),
        ) ||
        primary[0]!.entity.version !== canonical.version ||
        primary[0]!.expectedVersion !== captured.current.version ||
        (choice === "REMOTE"
          ? input.writes.length !== 0 || input.resultId !== original.entityId
          : input.writes.length !== 1 ||
            input.resultId === original.entityId ||
            input.writes[0]!.entity.id !== input.resultId ||
            input.writes[0]!.expectedVersion !== null ||
            input.writes[0]!.entity.collection !== original.entityType)
      )
        throw invalid();
    }
  }
  if (
    !input.records.some(
      (record) =>
        record.entity.collection === "$local.superseded" &&
        record.entity.id === original.id &&
        record.expectedVersion === null &&
        equalLocalJson(
          localObject(record.entity.value).original!,
          localDto(original),
        ),
    )
  )
    throw invalid();
  const entities = tx.objectStore("entities"),
    outbox = tx.objectStore("outbox");
  const read = <T>(request: IDBRequest<T>, valid: (value: T) => boolean) => {
    request.onsuccess = () => {
      try {
        if (!valid(request.result))
          abort(new LocalStorageError("VERSION_CONFLICT"));
      } catch (error) {
        abort(error instanceof Error ? error : invalid());
      }
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
    (state) => !!state && equalLocalJson(localDto(state), localDto(binding)),
  );
  read<LocalMutation[]>(
    outbox
      .index("entity")
      .getAll([actor.workspaceId, original.entityType, original.entityId]),
    (entries) => {
      const expected = [
        original,
        ...(validatedPurgedMemo ? (captured.followers ?? []) : []),
      ];
      return (
        entries.length === expected.length &&
        expected.every((value) =>
          entries.some((entry) =>
            equalLocalJson(localDto(entry), localDto(value)),
          ),
        )
      );
    },
  );
  read<LocalEntity | undefined>(
    entities.get([actor.workspaceId, "$local.workspace", "revision"]),
    (entry) => (entry?.version ?? null) === captured.expectedWorkspaceVersion,
  );
  for (const expected of [
    captured.current,
    captured.originalCommand,
    captured.remoteBase,
  ])
    read<LocalEntity | undefined>(
      entities.get([actor.workspaceId, expected.collection, expected.id]),
      (entry) => !!entry && equalLocalJson(localDto(entry), localDto(expected)),
    );
  if (validatedPurgedMemo) {
    const evidence = localObject(input.records[2]!.entity.value);
    const followers = evidence.followers!;
    if (!Array.isArray(followers)) throw invalid();
    for (const follower of followers) {
      const command = localObject(follower).command as unknown as LocalEntity;
      read<LocalEntity | undefined>(
        entities.get([actor.workspaceId, "$local.command", command.id]),
        (entry) =>
          !!entry && equalLocalJson(localDto(entry), localDto(command)),
      );
    }
    for (const follower of captured.followers ?? [])
      outbox.delete([actor.workspaceId, follower.id]);
  }
  outbox.delete([actor.workspaceId, original.id]);
}
