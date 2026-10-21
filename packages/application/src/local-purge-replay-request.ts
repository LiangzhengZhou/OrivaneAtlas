import {
  DomainError,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
} from "@arclattice/domain";
import type { EntityMemoIdentity } from "./entity-memos";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import type { LocalSyncState } from "./local-persistence";
import type { LocalWorkReplayRequest } from "./local-work-replay-request";
import { requireStableUuid } from "./mutation-receipt";
import {
  type PurgeReplayEffect,
  purgeCollections,
} from "./purge-replay-effects";

export async function buildLocalPurgeReplayRequest(
  plan: LocalCommandPlan,
  binding: LocalSyncState,
  identity?: Pick<EntityMemoIdentity, "forTarget">,
): Promise<LocalWorkReplayRequest | null> {
  if (
    !plan.command ||
    !["work.purge", "note.purge", "library.purge"].includes(
      plan.command.name,
    ) ||
    !["READY", "RECEIPT_REQUIRED"].includes(plan.state)
  )
    return null;
  const invalid = (): never => {
    throw new DomainError("VALIDATION_ERROR", { field: "purgeCommand" });
  };
  const command = localObject(plan.command.input),
    first = plan.mutations[0];
  if (
    !first ||
    Object.keys(command).some((k) => !["id", "version"].includes(k)) ||
    typeof command.id !== "string" ||
    typeof command.version !== "number" ||
    !Number.isSafeInteger(command.version) ||
    command.version < 1 ||
    plan.mutationIds[0] !== plan.id ||
    plan.mutations.length !== plan.mutationIds.length ||
    new Set(plan.mutationIds).size !== plan.mutationIds.length ||
    plan.mutations.length > 2000
  )
    invalid();
  const commandId = requireStableUuid(plan.id, "commandId"),
    deviceId = requireStableUuid(first!.deviceId, "deviceId");
  if (
    !binding.remoteWorkspaceId ||
    !binding.remotePrincipalId ||
    !binding.serverOrigin ||
    !binding.epoch ||
    binding.workspaceId !== first!.workspaceId
  )
    throw new DomainError("FORBIDDEN");
  const effects: PurgeReplayEffect[] = [];
  for (const [index, m] of plan.mutations.entries()) {
    if (
      m.id !== plan.mutationIds[index] ||
      m.commandId !== commandId ||
      m.deviceId !== deviceId ||
      m.workspaceId !== first!.workspaceId ||
      m.principalId !== first!.principalId ||
      !["PENDING", "SENDING"].includes(m.state) ||
      !purgeCollections.includes(
        m.entityType as PurgeReplayEffect["collection"],
      ) ||
      !Number.isSafeInteger(m.baseVersion) ||
      !m.baseVersion ||
      m.baseVersion < 1 ||
      (m.operation !== "DELETE" &&
        !(m.entityType === "workflows" && m.operation === "PATCH"))
    )
      invalid();
    let id = m.entityId;
    if (m.entityType === "entityMemos") {
      if (!identity || !m.basePayload) invalid();
      const memo = requireEntityMemoRecord(m.basePayload!);
      requireEntityMemoOwner(
        { workspaceId: m.workspaceId, principalId: m.principalId },
        memo,
      );
      if (memo.id !== m.entityId || memo.version !== m.baseVersion) invalid();
      id = await identity!.forTarget(
        {
          workspaceId: binding.remoteWorkspaceId!,
          principalId: binding.remotePrincipalId!,
        },
        memo,
      );
    }
    effects.push({
      collection: m.entityType as PurgeReplayEffect["collection"],
      id,
      op: m.operation === "DELETE" ? "DELETE" : "UPSERT",
      baseVersion: m.baseVersion!,
    });
  }
  const collection =
    plan.command.name === "work.purge"
      ? "items"
      : plan.command.name === "note.purge"
        ? "notes"
        : "library";
  if (
    !effects.some(
      (e) =>
        e.collection === collection &&
        e.id === command.id &&
        e.op === "DELETE" &&
        e.baseVersion === command.version,
    )
  )
    invalid();
  return {
    path: "/api/v1/" + plan.command.name.replace(".", "/"),
    idempotencyKey: commandId,
    deviceId,
    body: localDto({
      ...command,
      syncCommand: { commandId, deviceId, effects },
    }),
  };
}
