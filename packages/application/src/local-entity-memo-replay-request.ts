import {
  DomainError,
  requireEntityMemoInput,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
} from "@arclattice/domain";
import type { EntityMemoIdentity } from "./entity-memos";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import { equalLocalJson } from "./local-json-equal";
import type { LocalSyncState } from "./local-persistence";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";

/** Replays immutable private intent, with identity mapped only through the captured binding. */
export async function buildLocalEntityMemoReplayRequest(
  input: LocalCommandPlan,
  bindingInput: LocalSyncState,
  identity: Pick<EntityMemoIdentity, "forTarget">,
): Promise<LocalWorkReplayRequest | null> {
  const plan = structuredClone(input),
    binding = structuredClone(bindingInput);
  if (
    plan.command?.name !== "memo.save" ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state) ||
    plan.mutations.length !== 1 ||
    plan.mutationIds.length !== 1 ||
    plan.mutationIds[0] !== plan.id
  )
    return null;
  if (
    !binding.remotePrincipalId ||
    !binding.remoteWorkspaceId ||
    !binding.serverOrigin ||
    !binding.epoch ||
    !Number.isSafeInteger(binding.version) ||
    binding.version < 1 ||
    !Number.isSafeInteger(binding.cursor) ||
    binding.cursor < 0
  )
    throw new DomainError("FORBIDDEN");
  const mutation = plan.mutations[0]!;
  const commandId = requireStableUuid(plan.id, "commandId"),
    deviceId = requireStableUuid(mutation.deviceId, "deviceId");
  const command = localObject(plan.command.input);
  function invalid(): never {
    throw new DomainError("VALIDATION_ERROR", { field: "memoCommand" });
  }
  if (
    mutation.id !== commandId ||
    mutation.commandId !== commandId ||
    mutation.workspaceId !== binding.workspaceId ||
    !mutation.principalId ||
    mutation.entityType !== "entityMemos" ||
    !["PENDING", "SENDING"].includes(mutation.state) ||
    Object.keys(command).some(
      (key) => !["id", "version", "input", "deleted"].includes(key),
    ) ||
    command.id !== mutation.entityId ||
    typeof command.version !== "number" ||
    !Number.isSafeInteger(command.version) ||
    command.version < 0 ||
    command.version >= Number.MAX_SAFE_INTEGER ||
    command.version !== (mutation.baseVersion ?? 0) ||
    mutation.operation !== (command.version === 0 ? "CREATE" : "PATCH") ||
    typeof command.deleted !== "boolean"
  )
    invalid();
  const value = localObject(command.input!);
  const normalized = requireEntityMemoInput(
    value as unknown as import("@arclattice/domain").EntityMemoInput,
  );
  if (!equalLocalJson(localDto(normalized), value)) invalid();
  const actor = Object.freeze({
    workspaceId: mutation.workspaceId,
    principalId: mutation.principalId,
  });
  const memo = requireEntityMemoRecord(mutation.payload);
  requireEntityMemoOwner(actor, memo);
  if (
    memo.id !== command.id ||
    memo.version !== command.version + 1 ||
    memo.targetKind !== normalized.targetKind ||
    memo.targetId !== normalized.targetId ||
    memo.bodyMd !== normalized.bodyMd ||
    (normalized.aiPolicy !== undefined &&
      !equalLocalJson(
        localDto(memo.aiPolicy ?? null),
        localDto(normalized.aiPolicy),
      )) ||
    (memo.deletedAt !== null) !== command.deleted
  )
    invalid();
  const target = Object.freeze({
    targetKind: normalized.targetKind,
    targetId: normalized.targetId,
  });
  if (memo.id !== (await identity.forTarget(actor, target))) invalid();
  const remoteId = await identity.forTarget(
    Object.freeze({
      workspaceId: binding.remoteWorkspaceId,
      principalId: binding.remotePrincipalId,
    }),
    target,
  );
  return {
    path: "/api/v1/memo/save",
    idempotencyKey: commandId,
    deviceId,
    body: localDto({
      version: command.version,
      input: normalized,
      deleted: command.deleted,
      syncCommand: {
        commandId,
        deviceId,
        effects: [
          {
            collection: "entityMemos",
            id: remoteId,
            op: "UPSERT",
            baseVersion: command.version,
          },
        ],
      },
    }),
  };
}
