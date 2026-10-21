import {
  type ActorContext,
  DomainError,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
} from "@arclattice/domain";
import type { EntityMemoIdentity } from "./entity-memos";
import type { Clock } from "./index";
import { localCommandMutationIds } from "./local-command";
import type { LocalDeletedKnowledgeResolution } from "./local-deleted-knowledge";
import { localDto, localObject } from "./local-dto";
import { equalLocalJson } from "./local-json-equal";
import type { LocalWorkConflictReview } from "./local-pending-work-rebase";
import type { LocalMetadataStore, LocalOutboxStore } from "./local-persistence";
import { listLocalWorkConflictReviews } from "./local-work-conflict-review";

/** Validate the narrow retirement path; a purged target is never silently restored. */
export async function validatePurgedMemoResolution(
  input: LocalDeletedKnowledgeResolution,
  identity: EntityMemoIdentity,
) {
  const { actor, captured } = input;
  const { original, binding } = captured;
  const memo = requireEntityMemoRecord(original.payload);
  requireEntityMemoOwner(actor, memo);
  const remote = localObject(captured.remoteBase.value);
  const target = { targetKind: memo.targetKind, targetId: memo.targetId };
  const command = localObject(captured.originalCommand.value);
  const intent = localObject(command.input!);
  const patch = localObject(intent.input!);
  const members = localCommandMutationIds(
    captured.originalCommand,
    actor.workspaceId,
    actor.principalId,
  );
  if (
    input.choice !== "REMOTE" ||
    captured.originalCommand.id !== original.commandId ||
    command.name !== "memo.save" ||
    !members ||
    members.length !== 1 ||
    members[0] !== original.id ||
    intent.id !== memo.id ||
    intent.version !== (original.baseVersion ?? 0) ||
    patch.targetKind !== memo.targetKind ||
    patch.targetId !== memo.targetId ||
    patch.bodyMd !== memo.bodyMd ||
    intent.deleted !== (memo.deletedAt !== null) ||
    input.writes.length ||
    original.entityType !== "entityMemos" ||
    original.entityId !== memo.id ||
    original.workspaceId !== actor.workspaceId ||
    original.principalId !== actor.principalId ||
    original.state !== "CONFLICT" ||
    original.attemptCount < 1 ||
    !original.lastAttemptAt ||
    binding.workspaceId !== actor.workspaceId ||
    !binding.remoteWorkspaceId ||
    !binding.remotePrincipalId ||
    remote.value !== null ||
    !Number.isSafeInteger(remote.version) ||
    Number(remote.version) < 1 ||
    Number(remote.version) <= (original.baseVersion ?? 0) ||
    remote.collection !== "entityMemos" ||
    remote.id !== memo.id ||
    remote.remoteWorkspaceId !== binding.remoteWorkspaceId ||
    remote.remotePrincipalId !== binding.remotePrincipalId ||
    remote.serverOrigin !== binding.serverOrigin ||
    remote.epoch !== binding.epoch ||
    !equalLocalJson(remote.memoTarget!, localDto(target)) ||
    memo.id !== (await identity.forTarget(actor, target)) ||
    remote.remoteId !==
      (await identity.forTarget(
        {
          workspaceId: binding.remoteWorkspaceId,
          principalId: binding.remotePrincipalId,
        },
        target,
      )) ||
    input.resultId !== memo.id
  )
    throw new DomainError("FORBIDDEN");
  const expected = [
    {
      expectedVersion: captured.current.version,
      entity: {
        workspaceId: actor.workspaceId,
        collection: "entityMemos",
        id: memo.id,
        version: Number(remote.version),
        value: {
          id: memo.id,
          workspaceId: actor.workspaceId,
          version: Number(remote.version),
          localTombstone: true,
        },
      },
    },
    {
      expectedVersion: captured.expectedWorkspaceVersion,
      entity: {
        workspaceId: actor.workspaceId,
        collection: "$local.workspace",
        id: "revision",
        version: (captured.expectedWorkspaceVersion ?? 0) + 1,
        value: { revision: (captured.expectedWorkspaceVersion ?? 0) + 1 },
      },
    },
  ];
  if (
    input.records.length !== 3 ||
    expected.some(
      (record, index) =>
        !equalLocalJson(localDto(record), localDto(input.records[index])),
    )
  )
    throw new DomainError("VALIDATION_ERROR");
  const evidence = input.records[2]!;
  const value = localObject(evidence.entity.value);
  const followers = captured.followers ?? [];
  const archived = value.followers;
  if (!Array.isArray(archived) || archived.length !== followers.length)
    throw new DomainError("VALIDATION_ERROR");
  let previousVersion = memo.version;
  const seen = new Set([original.id, original.commandId]);
  for (const [index, follower] of followers.entries()) {
    const entry = localObject(archived[index]!);
    const followerCommand =
      entry.command as unknown as typeof captured.originalCommand;
    const followerMemo = requireEntityMemoRecord(follower.payload);
    requireEntityMemoOwner(actor, followerMemo);
    const ids = localCommandMutationIds(
      followerCommand,
      actor.workspaceId,
      actor.principalId,
    );
    const followerValue = localObject(followerCommand.value),
      next = localObject(followerValue.input!);
    if (
      follower.workspaceId !== actor.workspaceId ||
      follower.principalId !== actor.principalId ||
      follower.entityType !== "entityMemos" ||
      follower.entityId !== memo.id ||
      follower.deviceId !== original.deviceId ||
      follower.state !== "PENDING" ||
      follower.attemptCount !== 0 ||
      follower.lastAttemptAt !== null ||
      follower.baseVersion !== previousVersion ||
      followerMemo.version !== previousVersion + 1 ||
      followerMemo.id !== memo.id ||
      followerMemo.targetKind !== memo.targetKind ||
      followerMemo.targetId !== memo.targetId ||
      !equalLocalJson(entry.mutation!, localDto(follower)) ||
      !ids ||
      ids.length !== 1 ||
      ids[0] !== follower.id ||
      followerCommand.id !== follower.commandId ||
      followerValue.name !== "memo.save" ||
      next.id !== memo.id ||
      next.version !== previousVersion ||
      !equalLocalJson(
        next.input!,
        localDto({
          ...target,
          bodyMd: followerMemo.bodyMd,
          ...(Object.hasOwn(localObject(next.input!), "aiPolicy")
            ? { aiPolicy: followerMemo.aiPolicy ?? null }
            : {}),
        }),
      ) ||
      next.deleted !== (followerMemo.deletedAt !== null) ||
      seen.has(follower.id) ||
      seen.has(follower.commandId)
    )
      throw new DomainError("VALIDATION_ERROR");
    seen.add(follower.id);
    seen.add(follower.commandId);
    previousVersion = followerMemo.version;
  }
  if (
    followers.length &&
    (captured.current.version !== previousVersion ||
      !equalLocalJson(captured.current.value, followers.at(-1)!.payload))
  )
    throw new DomainError("VERSION_CONFLICT");
  if (
    evidence.expectedVersion !== null ||
    evidence.entity.workspaceId !== actor.workspaceId ||
    evidence.entity.collection !== "$local.superseded" ||
    evidence.entity.id !== original.id ||
    evidence.entity.version !== 1 ||
    value.reason !== "REVIEWED_MEMO_PURGE" ||
    value.choice !== "REMOTE" ||
    typeof value.at !== "string" ||
    !equalLocalJson(value.original!, localDto(original)) ||
    !equalLocalJson(
      value.originalCommand!,
      localDto(captured.originalCommand),
    ) ||
    !equalLocalJson(value.remoteBase!, localDto(captured.remoteBase))
  )
    throw new DomainError("VALIDATION_ERROR");
}

export async function prepareLocalPurgedMemo(
  actorInput: ActorContext,
  reviewInput: LocalWorkConflictReview,
  metadata: LocalMetadataStore,
  outbox: LocalOutboxStore,
  identity: EntityMemoIdentity,
  clock: Clock,
): Promise<LocalDeletedKnowledgeResolution> {
  const actor = Object.freeze({ ...actorInput }),
    captured = structuredClone(reviewInput);
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
  const { original } = captured,
    remote = localObject(captured.remoteBase.value);
  const followers = await Promise.all(
    (captured.followers ?? []).map(async (mutation) => {
      if (!mutation.commandId) throw new DomainError("VALIDATION_ERROR");
      const command = await metadata.get(
        actor.workspaceId,
        "$local.command",
        mutation.commandId,
      );
      if (!command) throw new DomainError("VERSION_CONFLICT");
      return { mutation, command };
    }),
  );
  const version = Number(remote.version);
  const input: LocalDeletedKnowledgeResolution = {
    actor,
    captured,
    choice: "REMOTE",
    writes: [],
    resultId: original.entityId,
    records: [
      {
        expectedVersion: captured.current.version,
        entity: {
          workspaceId: actor.workspaceId,
          collection: "entityMemos",
          id: original.entityId,
          version,
          value: {
            id: original.entityId,
            workspaceId: actor.workspaceId,
            version,
            localTombstone: true,
          },
        },
      },
      {
        expectedVersion: captured.expectedWorkspaceVersion,
        entity: {
          workspaceId: actor.workspaceId,
          collection: "$local.workspace",
          id: "revision",
          version: (captured.expectedWorkspaceVersion ?? 0) + 1,
          value: { revision: (captured.expectedWorkspaceVersion ?? 0) + 1 },
        },
      },
      {
        expectedVersion: null,
        entity: {
          workspaceId: actor.workspaceId,
          collection: "$local.superseded",
          id: original.id,
          version: 1,
          value: localDto({
            reason: "REVIEWED_MEMO_PURGE",
            choice: "REMOTE",
            at: clock.now(),
            original,
            originalCommand: captured.originalCommand,
            remoteBase: captured.remoteBase,
            followers,
          }),
        },
      },
    ],
  };
  await validatePurgedMemoResolution(input, identity);
  return structuredClone(input);
}
