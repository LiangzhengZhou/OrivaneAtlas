import type { ActorContext } from "@arclattice/domain";
import { localCommandMutationIds } from "./local-command";
import { localDto, localObject } from "./local-dto";
import {
  compareLocalMutations,
  validLocalMutationOrder,
} from "./local-mutation-order";
import type {
  LocalJson,
  LocalMetadataStore,
  LocalMutation,
} from "./local-persistence";

export interface LocalCommandPlan {
  readonly id: string;
  readonly state:
    | "READY"
    | "LEGACY"
    | "RECEIPT_REQUIRED"
    | "CONFLICT"
    | "REJECTED"
    | "CORRUPT";
  readonly command: { readonly name: string; readonly input: LocalJson } | null;
  readonly mutationIds: readonly string[];
  readonly mutations: readonly LocalMutation[];
}

/** One detached Outbox batch. No write, transport, rebase or legacy diff replay. */
export async function planLocalCommands(
  actorInput: ActorContext,
  store: LocalMetadataStore,
  pendingInput: readonly LocalMutation[],
): Promise<readonly LocalCommandPlan[]> {
  const actor = { ...actorInput };
  const pending = structuredClone(pendingInput);
  if (
    pending.some(
      (mutation) =>
        mutation.workspaceId !== actor.workspaceId ||
        mutation.principalId !== actor.principalId ||
        !validLocalMutationOrder(mutation.order),
    )
  )
    throw new Error("LOCAL_COMMAND_SCOPE_CORRUPT");
  const groups = new Map<string, LocalMutation[]>();
  const legacy: LocalCommandPlan[] = [];
  for (const mutation of [...pending].sort(compareLocalMutations)) {
    if (mutation.commandId === undefined) {
      legacy.push({
        id: mutation.id,
        state: "LEGACY",
        command: null,
        mutationIds: [mutation.id],
        mutations: [mutation],
      });
      continue;
    }
    const group = groups.get(mutation.commandId) ?? [];
    group.push(mutation);
    groups.set(mutation.commandId, group);
  }
  const plans = await Promise.all(
    [...groups].map(async ([id, mutations]): Promise<LocalCommandPlan> => {
      const record = await store.get(actor.workspaceId, "$local.command", id);
      const ids = record
        ? localCommandMutationIds(record, actor.workspaceId, actor.principalId)
        : null;
      const corrupt: LocalCommandPlan = {
        id,
        state: "CORRUPT",
        command: null,
        mutationIds: mutations.map((mutation) => mutation.id),
        mutations,
      };
      const positions = new Map(
        ids?.map((mutationId, index) => [mutationId, index]) ?? [],
      );
      if (
        !record ||
        !ids ||
        mutations.some(
          (mutation) =>
            !positions.has(mutation.id) ||
            !mutation.order ||
            mutation.order.operationIndex !== positions.get(mutation.id) ||
            !Number.isSafeInteger(mutation.attemptCount) ||
            mutation.attemptCount < 0 ||
            (mutation.attemptCount === 0 && mutation.lastAttemptAt !== null) ||
            (mutation.attemptCount > 0 &&
              (mutation.lastAttemptAt === null ||
                !Number.isFinite(Date.parse(mutation.lastAttemptAt)))),
        ) ||
        new Set(mutations.map((mutation) => mutation.order?.transactionVersion))
          .size !== 1 ||
        new Set(mutations.map((mutation) => mutation.id)).size !==
          mutations.length ||
        new Set(mutations.map((mutation) => mutation.deviceId)).size !== 1
      )
        return corrupt;
      const data = localObject(localDto(record.value));
      const currentIds = mutations.map((mutation) => mutation.id);
      const remaining = new Set(currentIds);
      const missing = ids.filter((mutationId) => !remaining.has(mutationId));
      if (
        !missing.length &&
        ids.some((mutationId, index) => mutationId !== currentIds[index])
      )
        return corrupt;
      const state = mutations.some((mutation) => mutation.state === "CONFLICT")
        ? "CONFLICT"
        : mutations.some((mutation) => mutation.state === "REJECTED")
          ? "REJECTED"
          : missing.length ||
              mutations.some(
                (mutation) =>
                  mutation.attemptCount > 0 || mutation.state === "SENDING",
              )
            ? "RECEIPT_REQUIRED"
            : "READY";
      return {
        id,
        state,
        command: { name: String(data.name), input: data.input! },
        mutationIds: [...ids],
        mutations,
      };
    }),
  );
  return [...legacy, ...plans].sort((left, right) =>
    compareLocalMutations(left.mutations[0]!, right.mutations[0]!),
  );
}
