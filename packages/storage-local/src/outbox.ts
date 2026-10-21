import {
  type LocalEntity,
  type LocalMutation,
  type LocalOutboxTransition,
  LocalStorageError,
  type LocalSyncState,
  type LocalWorkspaceIdentity,
  localCommandMutationIds,
  localOutboxTransition,
} from "@arclattice/application";
import { isLocalJson } from "./json";

/** Claim/reset all command effects together; no transport awaits in this transaction. */
export function transitionOutboxBatch(
  db: IDBDatabase,
  source: readonly LocalOutboxTransition[],
): Promise<readonly LocalMutation[]> {
  const inputs = structuredClone(source);
  const first = inputs[0];
  if (
    !first ||
    inputs.length > 2000 ||
    new Set(inputs.map((input) => input.mutationId)).size !== inputs.length ||
    inputs.some(
      (input) =>
        input.workspaceId !== first.workspaceId ||
        input.binding.version !== first.binding.version ||
        input.binding.remoteWorkspaceId !== first.binding.remoteWorkspaceId ||
        input.binding.serverOrigin !== first.binding.serverOrigin ||
        (input.binding.remotePrincipalId ?? null) !==
          (first.binding.remotePrincipalId ?? null),
    )
  )
    return Promise.reject(new LocalStorageError("INVALID_WRITE"));
  const inputsById = new Map(inputs.map((input) => [input.mutationId, input]));
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      ["outbox", "sync", "entities", "identity"],
      "readwrite",
      { durability: "strict" },
    );
    let failure: Error | null = null;
    const updated = new Map<string, LocalMutation>();
    const commands = new Map<string, LocalEntity | undefined>();
    const groups = new Map<string, LocalMutation[]>();
    let own: LocalWorkspaceIdentity | undefined;
    let remaining = 0;
    let scheduled = false;
    tx.oncomplete = () =>
      resolve(inputs.map((input) => updated.get(input.mutationId)!));
    tx.onabort = () =>
      reject(failure ?? tx.error ?? new Error("LOCAL_TRANSACTION_ABORTED"));
    const fail = (error: Error = new LocalStorageError("VERSION_CONFLICT")) => {
      failure = error;
      tx.abort();
    };
    const outbox = tx.objectStore("outbox");
    const finish = () => {
      if (!scheduled || remaining || failure) return;
      for (const [id, mutations] of groups) {
        const record = commands.get(id);
        const members =
          record && isLocalJson(record.value)
            ? localCommandMutationIds(
                record,
                first.workspaceId,
                mutations[0]!.principalId,
              )
            : null;
        if (
          !own ||
          own.workspaceId !== first.workspaceId ||
          mutations.some(
            (mutation) => mutation.principalId !== own!.principalId,
          ) ||
          !members ||
          members.length !== mutations.length ||
          members.some((member, index) => member !== mutations[index]!.id)
        ) {
          fail();
          return;
        }
        const targets = mutations.map(
          (mutation) => inputsById.get(mutation.id)!,
        );
        if (
          targets.some(
            (input) =>
              input.expectedState !== targets[0]!.expectedState ||
              input.nextState !== targets[0]!.nextState,
          )
        ) {
          fail();
          return;
        }
      }
      for (const value of updated.values()) outbox.put(value);
    };
    const read = <T>(request: IDBRequest<T>, consume: (value: T) => void) => {
      remaining++;
      request.onsuccess = () => {
        if (failure) return;
        try {
          consume(request.result);
          remaining--;
          finish();
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      };
    };
    read<LocalWorkspaceIdentity | undefined>(
      tx.objectStore("identity").get("default"),
      (value) => {
        own = value;
      },
    );
    read<LocalSyncState | undefined>(
      tx.objectStore("sync").get(first.workspaceId),
      (current) => {
        if (
          !current ||
          current.version !== first.binding.version ||
          current.remoteWorkspaceId !== first.binding.remoteWorkspaceId ||
          current.serverOrigin !== first.binding.serverOrigin ||
          (current.remotePrincipalId ?? null) !==
            (first.binding.remotePrincipalId ?? null) ||
          !current.remoteWorkspaceId ||
          !current.serverOrigin
        )
          throw new LocalStorageError("VERSION_CONFLICT");
      },
    );
    for (const input of inputs)
      read<LocalMutation | undefined>(
        outbox.get([input.workspaceId, input.mutationId]),
        (current) => {
          if (!current) throw new LocalStorageError("VERSION_CONFLICT");
          updated.set(input.mutationId, localOutboxTransition(current, input));
          if (current.commandId !== undefined) {
            const group = groups.get(current.commandId) ?? [];
            group.push(current);
            groups.set(current.commandId, group);
            if (!commands.has(current.commandId)) {
              commands.set(current.commandId, undefined);
              const id = current.commandId;
              read<LocalEntity | undefined>(
                tx
                  .objectStore("entities")
                  .get([first.workspaceId, "$local.command", id]),
                (value) => {
                  commands.set(id, value);
                },
              );
            }
          }
        },
      );
    scheduled = true;
  });
}
