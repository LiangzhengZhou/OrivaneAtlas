import {
  type LocalEntity,
  type LocalMutation,
  type LocalReplicaCommit,
  LocalStorageError,
  type LocalSyncState,
  type LocalWorkspaceIdentity,
  replicaCollections,
} from "@arclattice/application";
import {
  DomainError,
  requireEntityMemoInput,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
} from "@arclattice/domain";
import { deriveEntityMemoId } from "./entity-memo-identity";
import { isLocalJson } from "./json";

const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const version = (value: number | null) => value === null || positive(value);

export async function commitReplica(
  db: IDBDatabase,
  source: LocalReplicaCommit,
  project: (entity: LocalEntity) => LocalEntity,
): Promise<void> {
  const input = structuredClone(source);
  const { workspaceId, binding } = input;
  // Memo IDs encode owner/workspace. Validate both identities before opening IDB;
  // hashing inside a live transaction would let it auto-commit between awaits.
  try {
    for (const { entity } of input.records) {
      if (entity.collection === "$local.entityMemoBootstrap") {
        const marker = entity.value;
        if (
          entity.id !== "owner" ||
          !marker ||
          typeof marker !== "object" ||
          Array.isArray(marker) ||
          !("principalId" in marker) ||
          marker.principalId !== input.principalId ||
          !("remotePrincipalId" in marker) ||
          marker.remotePrincipalId !== binding.remotePrincipalId ||
          !("remoteWorkspaceId" in marker) ||
          marker.remoteWorkspaceId !== binding.remoteWorkspaceId ||
          !("serverOrigin" in marker) ||
          marker.serverOrigin !== binding.serverOrigin ||
          !("epoch" in marker) ||
          marker.epoch !== binding.epoch ||
          !("after" in marker) ||
          typeof marker.after !== "number" ||
          !Number.isSafeInteger(marker.after) ||
          marker.after < 0 ||
          !("complete" in marker) ||
          typeof marker.complete !== "boolean" ||
          Object.keys(marker).some(
            (key) =>
              ![
                "principalId",
                "remotePrincipalId",
                "remoteWorkspaceId",
                "serverOrigin",
                "epoch",
                "after",
                "complete",
              ].includes(key),
          )
        )
          throw new LocalStorageError("INVALID_WRITE");
      }
      if (entity.collection === "entityMemos") {
        const value = entity.value;
        if (
          value &&
          typeof value === "object" &&
          "localTombstone" in value &&
          value.localTombstone === true
        ) {
          const base = input.records.find(
            (record) =>
              record.entity.collection === "$local.remoteBase" &&
              record.entity.id === JSON.stringify(["entityMemos", entity.id]),
          )?.entity.value;
          if (
            !base ||
            typeof base !== "object" ||
            !("value" in base) ||
            base.value !== null ||
            !("version" in base) ||
            base.version !== entity.version ||
            !("id" in value) ||
            value.id !== entity.id ||
            !("workspaceId" in value) ||
            value.workspaceId !== workspaceId ||
            !("version" in value) ||
            value.version !== entity.version ||
            Object.keys(value).some(
              (key) =>
                !["id", "workspaceId", "version", "localTombstone"].includes(
                  key,
                ),
            )
          )
            throw new LocalStorageError("INVALID_WRITE");
          continue;
        }
        const memo = requireEntityMemoRecord(entity.value);
        requireEntityMemoOwner(
          { workspaceId, principalId: input.principalId },
          memo,
        );
        if (
          memo.id !== entity.id ||
          memo.version !== entity.version ||
          memo.id !==
            (await deriveEntityMemoId(
              { workspaceId, principalId: input.principalId },
              memo,
            ))
        )
          throw new LocalStorageError("INVALID_WRITE");
      }
      if (
        entity.collection !== "$local.remoteBase" ||
        !entity.value ||
        typeof entity.value !== "object" ||
        !("collection" in entity.value) ||
        entity.value.collection !== "entityMemos"
      )
        continue;
      const base = entity.value;
      if (
        !("value" in base) ||
        !("remoteWorkspaceId" in base) ||
        base.remoteWorkspaceId !== binding.remoteWorkspaceId ||
        !("remotePrincipalId" in base) ||
        base.remotePrincipalId !== binding.remotePrincipalId ||
        !("serverOrigin" in base) ||
        base.serverOrigin !== binding.serverOrigin ||
        !("epoch" in base) ||
        base.epoch !== binding.epoch ||
        !binding.remoteWorkspaceId ||
        !binding.remotePrincipalId
      )
        throw new LocalStorageError("INVALID_WRITE");
      if (base.value === null) {
        if (
          !("memoTarget" in base) ||
          !base.memoTarget ||
          typeof base.memoTarget !== "object" ||
          Array.isArray(base.memoTarget)
        )
          throw new LocalStorageError("INVALID_WRITE");
        const target = requireEntityMemoInput({
          ...base.memoTarget,
          bodyMd: "",
        } as Parameters<typeof requireEntityMemoInput>[0]);
        const localId = await deriveEntityMemoId(
          { workspaceId, principalId: input.principalId },
          target,
        );
        const remoteId = await deriveEntityMemoId(
          {
            workspaceId: binding.remoteWorkspaceId,
            principalId: binding.remotePrincipalId,
          },
          target,
        );
        if (
          !("id" in base) ||
          base.id !== localId ||
          entity.id !== JSON.stringify(["entityMemos", localId]) ||
          !("remoteId" in base) ||
          base.remoteId !== remoteId
        )
          throw new LocalStorageError("INVALID_WRITE");
        continue;
      }
      const memo = requireEntityMemoRecord(base.value);
      requireEntityMemoOwner(
        {
          workspaceId: binding.remoteWorkspaceId,
          principalId: binding.remotePrincipalId,
        },
        memo,
      );
      const localId = await deriveEntityMemoId(
        { workspaceId, principalId: input.principalId },
        memo,
      );
      if (
        !("id" in base) ||
        base.id !== localId ||
        entity.id !== JSON.stringify(["entityMemos", localId]) ||
        !("remoteId" in base) ||
        base.remoteId !== memo.id ||
        !("version" in base) ||
        base.version !== memo.version ||
        memo.id !==
          (await deriveEntityMemoId(
            {
              workspaceId: binding.remoteWorkspaceId,
              principalId: binding.remotePrincipalId,
            },
            memo,
          ))
      )
        throw new LocalStorageError("INVALID_WRITE");
    }
  } catch (error) {
    if (error instanceof LocalStorageError) throw error;
    if (error instanceof DomainError)
      throw new LocalStorageError("INVALID_WRITE");
    throw error;
  }
  const acknowledgements =
    input.acknowledgements ??
    (input.acknowledgement ? [input.acknowledgement] : []);
  const ackIds = new Set(acknowledgements.map((ack) => ack.mutationId));
  const keys = new Set<string>();
  const recordKeys = new Set(
    input.records.map(({ entity }) =>
      JSON.stringify([entity.collection, entity.id]),
    ),
  );
  const bases = new Map(
    input.records
      .filter(({ entity }) => entity.collection === "$local.remoteBase")
      .map(({ entity }) => [entity.id, entity.value]),
  );
  if (
    !workspaceId ||
    !input.principalId ||
    binding.workspaceId !== workspaceId ||
    !binding.remoteWorkspaceId ||
    !binding.serverOrigin ||
    !binding.epoch ||
    (binding.remotePrincipalId !== undefined &&
      binding.remotePrincipalId !== null &&
      (typeof binding.remotePrincipalId !== "string" ||
        !binding.remotePrincipalId ||
        binding.remotePrincipalId.length > 240)) ||
    !positive(binding.version) ||
    !positive(binding.version + 1) ||
    !Number.isSafeInteger(binding.cursor) ||
    binding.cursor < 0 ||
    !Number.isSafeInteger(input.nextCursor) ||
    input.nextCursor < binding.cursor ||
    !version(input.expectedWorkspaceVersion) ||
    !positive((input.expectedWorkspaceVersion ?? 0) + 1) ||
    (input.acknowledgements !== undefined &&
      input.acknowledgement !== undefined) ||
    acknowledgements.length > 2000 ||
    ackIds.size !== acknowledgements.length ||
    acknowledgements.some(
      (ack) =>
        !ack.mutationId ||
        !ack.deviceId ||
        !positive(ack.attemptCount) ||
        !Number.isFinite(Date.parse(ack.lastAttemptAt)),
    ) ||
    input.records.some(({ entity, expectedVersion }) => {
      const key = JSON.stringify([entity.collection, entity.id]);
      const duplicate = keys.has(key);
      keys.add(key);
      let projectionOwner: string | null = null;
      if (
        /^\$local\.(note|library)(Body|BodyAvailability|Search|Revision)$/.test(
          entity.collection,
        )
      )
        projectionOwner = entity.collection.includes("note")
          ? "notes"
          : "library";
      if (entity.collection === "$local.wikiSources")
        projectionOwner = "library";
      const ownerId =
        entity.collection.endsWith("Revision") &&
        entity.value &&
        typeof entity.value === "object" &&
        "id" in entity.value
          ? entity.value.id
          : entity.id;
      const missingOwner =
        projectionOwner !== null &&
        !recordKeys.has(JSON.stringify([projectionOwner, ownerId]));
      const value = entity.value;
      const foreignValue =
        !entity.collection.startsWith("$local.") &&
        value !== null &&
        typeof value === "object" &&
        (("workspaceId" in value && value.workspaceId !== workspaceId) ||
          ("version" in value && value.version !== entity.version));
      return (
        duplicate ||
        missingOwner ||
        foreignValue ||
        entity.workspaceId !== workspaceId ||
        (entity.collection === "navigationPreference" &&
          entity.id !== input.principalId) ||
        !entity.id ||
        !replicaCollections.has(entity.collection) ||
        !positive(entity.version) ||
        !version(expectedVersion) ||
        !isLocalJson(entity.value) ||
        (entity.collection.startsWith("$local.") &&
          entity.version !== (expectedVersion ?? 0) + 1)
      );
    })
  )
    return Promise.reject(new LocalStorageError("INVALID_WRITE"));
  const projected = input.records.map(({ entity }) => project(entity));
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      ["entities", "outbox", "sync", "identity"],
      "readwrite",
      { durability: "strict" },
    );
    let failure: Error | null = null;
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(failure ?? tx.error ?? new Error("LOCAL_TRANSACTION_ABORTED"));
    const entities = tx.objectStore("entities");
    const outbox = tx.objectStore("outbox");
    let remaining = 0;
    let scheduled = false;
    const acceptedById = new Map<string, LocalMutation | undefined>();
    const pending = new Map<string, LocalMutation[]>();
    const fail = () => {
      failure = new LocalStorageError("VERSION_CONFLICT");
      tx.abort();
    };
    const finish = () => {
      if (!scheduled || remaining || failure) return;
      for (const ack of acknowledgements) {
        const accepted = acceptedById.get(ack.mutationId);
        if (
          !accepted ||
          accepted.state !== "SENDING" ||
          accepted.principalId !== input.principalId ||
          accepted.deviceId !== ack.deviceId ||
          accepted.attemptCount !== ack.attemptCount ||
          accepted.lastAttemptAt !== ack.lastAttemptAt
        ) {
          fail();
          return;
        }
        const base = bases.get(
          JSON.stringify([accepted.entityType, accepted.entityId]),
        );
        if (
          !base ||
          typeof base !== "object" ||
          Array.isArray(base) ||
          !("remoteWorkspaceId" in base) ||
          !("collection" in base) ||
          !("id" in base) ||
          !("version" in base) ||
          base.remoteWorkspaceId !== binding.remoteWorkspaceId ||
          base.collection !== accepted.entityType ||
          base.id !== accepted.entityId ||
          ((!("mutationId" in base) || base.mutationId !== accepted.id) &&
            (!("mutationIds" in base) ||
              !Array.isArray(base.mutationIds) ||
              !base.mutationIds.includes(accepted.id))) ||
          typeof base.version !== "number" ||
          !positive(base.version) ||
          base.version < (accepted.baseVersion ?? 0) + 1 ||
          !Object.hasOwn(base, "value")
        ) {
          fail();
          return;
        }
        const canonical = "value" in base ? base.value : undefined;
        if (
          canonical !== null &&
          (!canonical ||
            typeof canonical !== "object" ||
            Array.isArray(canonical) ||
            ("id" in canonical &&
              (accepted.entityType === "organization"
                ? !("kind" in canonical) ||
                  !["WORK", "NOTE", "FOLDER"].includes(
                    String(canonical.kind),
                  ) ||
                  `${canonical.kind}:${canonical.id}` !== accepted.entityId
                : accepted.entityType === "entityMemos"
                  ? !("remoteId" in base) || canonical.id !== base.remoteId
                  : canonical.id !== accepted.entityId)) ||
            ("workspaceId" in canonical &&
              canonical.workspaceId !== binding.remoteWorkspaceId) ||
            ("version" in canonical && canonical.version !== base.version))
        ) {
          fail();
          return;
        }
      }
      for (const { entity } of input.records) {
        if (entity.collection.startsWith("$local.")) continue;
        const edits =
          pending.get(JSON.stringify([entity.collection, entity.id])) ?? [];
        if (edits.some((mutation) => !ackIds.has(mutation.id))) {
          fail();
          return;
        }
      }
      for (const entity of projected) entities.put(entity);
      const revision = (input.expectedWorkspaceVersion ?? 0) + 1;
      entities.put({
        workspaceId,
        collection: "$local.workspace",
        id: "revision",
        version: revision,
        value: { revision },
      });
      tx.objectStore("sync").put({
        ...binding,
        cursor: input.nextCursor,
        version: binding.version + 1,
      });
      for (const ack of acknowledgements)
        outbox.delete([workspaceId, ack.mutationId]);
    };
    const read = <T>(
      request: IDBRequest<T>,
      consume: (value: T) => boolean,
    ) => {
      remaining++;
      request.onsuccess = () => {
        if (failure) return;
        if (!consume(request.result)) {
          fail();
          return;
        }
        remaining--;
        finish();
      };
    };
    read<LocalWorkspaceIdentity | undefined>(
      tx.objectStore("identity").get("default"),
      (own) =>
        own?.workspaceId === workspaceId &&
        own.principalId === input.principalId,
    );
    read<LocalSyncState | undefined>(
      tx.objectStore("sync").get(workspaceId),
      (current) =>
        !!current &&
        current.version === binding.version &&
        current.remoteWorkspaceId === binding.remoteWorkspaceId &&
        current.serverOrigin === binding.serverOrigin &&
        current.epoch === binding.epoch &&
        (current.remotePrincipalId ?? null) ===
          (binding.remotePrincipalId ?? null) &&
        current.cursor === binding.cursor,
    );
    read<LocalEntity | undefined>(
      entities.get([workspaceId, "$local.workspace", "revision"]),
      (current) =>
        (current?.version ?? null) === input.expectedWorkspaceVersion,
    );
    for (const ack of acknowledgements)
      read<LocalMutation | undefined>(
        outbox.get([workspaceId, ack.mutationId]),
        (current) => {
          acceptedById.set(ack.mutationId, current);
          return true;
        },
      );
    for (const { entity, expectedVersion } of input.records) {
      read<LocalEntity | undefined>(
        entities.get([workspaceId, entity.collection, entity.id]),
        (current) => (current?.version ?? null) === expectedVersion,
      );
      if (!entity.collection.startsWith("$local."))
        read<LocalMutation[]>(
          outbox
            .index("entity")
            .getAll([workspaceId, entity.collection, entity.id]),
          (entries) => {
            pending.set(
              JSON.stringify([entity.collection, entity.id]),
              entries,
            );
            return true;
          },
        );
    }
    scheduled = true;
  });
}
