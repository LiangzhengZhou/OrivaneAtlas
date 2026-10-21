import {
  DomainError,
  manualOrderScopeKey,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
  requireManualOrderScope,
  requireManualOrderState,
} from "@arclattice/domain";
import { localObject } from "./local-dto";
import type { LocalEntity } from "./local-persistence";
import type {
  WorkspaceImportJournal,
  WorkspaceImportStep,
} from "./workspace-import";

/** A detached destination version plus an explicit decision; never a forced write. */
export interface WorkspaceImportResolution {
  readonly stepId: string;
  readonly choice: "LOCAL" | "REMOTE";
  readonly remote: LocalEntity;
}

function stepTarget(step: WorkspaceImportStep) {
  const payload = localObject(step.payload);
  if (step.path === "/api/memo/save") {
    const sync = localObject(payload.syncCommand ?? null);
    if (!Array.isArray(sync.effects) || sync.effects.length !== 1)
      throw new DomainError("VALIDATION_ERROR");
    const effect = localObject(sync.effects[0]!);
    if (
      effect.collection !== "entityMemos" ||
      typeof effect.id !== "string" ||
      effect.baseVersion !== payload.version ||
      effect.op !== "UPSERT"
    )
      throw new DomainError("VALIDATION_ERROR");
    return { collection: "entityMemos", id: effect.id };
  }
  if (step.path === "/api/work/update")
    return { collection: "items", id: payload.id };
  if (step.path === "/api/files/rename")
    return { collection: "files", id: payload.id };
  if (step.path === "/api/manual-orders/sequence")
    return {
      collection: "manualOrders",
      id: manualOrderScopeKey(requireManualOrderScope(payload.scope)),
    };
  return null;
}

export function workspaceImportResolutionCandidates(
  journal: WorkspaceImportJournal,
  records: readonly LocalEntity[],
) {
  return journal.steps.slice(journal.accepted.length).flatMap((step) => {
    const payload = localObject(step.payload);
    const target = stepTarget(step),
      collection = target?.collection;
    if (!target || typeof payload.version !== "number") return [];
    const remote = records.find(
      (row) => row.collection === collection && row.id === target.id,
    );
    if (!remote || remote.version <= payload.version) return [];
    const value = localObject(remote.value);
    if (value.deletedAt) return [];
    if (collection === "entityMemos") {
      const memo = requireEntityMemoRecord(value);
      requireEntityMemoOwner(
        {
          workspaceId: journal.targetWorkspaceId,
          principalId: journal.targetPrincipalId,
        },
        memo,
      );
      const input = localObject(payload.input ?? null);
      if (
        memo.id !== remote.id ||
        memo.version !== remote.version ||
        memo.targetKind !== input.targetKind ||
        memo.targetId !== input.targetId ||
        typeof input.bodyMd !== "string" ||
        payload.deleted !== false
      )
        throw new DomainError("VERSION_CONFLICT");
      return [
        {
          stepId: step.id,
          remote,
          title: memo.targetId,
          fields: [
            { field: "bodyMd", local: input.bodyMd, remote: memo.bodyMd },
          ],
        },
      ];
    }
    if (collection === "manualOrders") {
      const state = requireManualOrderState(remote.value);
      const title = (id: string) => {
        const item = records.find(
          (row) => row.collection === "items" && row.id === id,
        );
        return item ? String(localObject(item.value).title ?? id) : id;
      };
      if (!Array.isArray(payload.orderedEntityIds))
        throw new DomainError("VALIDATION_ERROR");
      return [
        {
          stepId: step.id,
          remote,
          title: "order",
          fields: [
            {
              field: "order",
              local: payload.orderedEntityIds
                .map((id) => title(String(id)))
                .join(" → "),
              remote: [...state.entries]
                .sort((a, b) => a.position - b.position)
                .map((entry) => title(entry.entityId))
                .join(" → "),
            },
          ],
        },
      ];
    }
    const input =
      collection === "files"
        ? { name: payload.name }
        : localObject(payload.input ?? null);
    const fields = Object.entries(input).map(([field, local]) => ({
      field,
      local,
      remote: value[field === "projectLifecycle" ? "lifecycle" : field],
    }));
    if (
      !fields.length ||
      fields.some(
        (entry) =>
          typeof entry.local !== "string" ||
          typeof entry.remote !== "string" ||
          !(
            collection === "files"
              ? ["name"]
              : [
                  "status",
                  "activationState",
                  "activationPolicy",
                  "projectLifecycle",
                ]
          ).includes(entry.field),
      )
    )
      return [];
    return [
      {
        stepId: step.id,
        remote,
        title: String(value.title ?? value.name ?? remote.id),
        fields,
      },
    ];
  });
}

/** Restrict review amendments to the final state/rename commands emitted by the importer. */
export function resolveWorkspaceImportSteps(
  journal: WorkspaceImportJournal,
  resolutions: readonly WorkspaceImportResolution[],
): readonly WorkspaceImportStep[] {
  const pending = journal.steps.slice(journal.accepted.length);
  const seen = new Set<string>();
  const amended = new Map<string, WorkspaceImportStep>();
  const resultingWorkVersions = new Map<
    string,
    { previous: number; next: number }
  >();
  for (const decision of resolutions) {
    const step = pending.find((entry) => entry.id === decision.stepId);
    if (
      !step ||
      seen.has(decision.stepId) ||
      !["LOCAL", "REMOTE"].includes(decision.choice)
    )
      throw new DomainError("VALIDATION_ERROR");
    seen.add(decision.stepId);
    const payload = localObject(step.payload),
      remote = decision.remote;
    if (remote.workspaceId !== journal.targetWorkspaceId)
      throw new DomainError("FORBIDDEN");
    const target = stepTarget(step),
      collection = target?.collection;
    const value = localObject(remote.value);
    if (
      !collection ||
      remote.collection !== collection ||
      remote.id !== target?.id ||
      value.id !== remote.id ||
      value.version !== remote.version ||
      (value.workspaceId !== undefined &&
        value.workspaceId !== remote.workspaceId) ||
      value.deletedAt ||
      !Number.isSafeInteger(remote.version) ||
      typeof payload.version !== "number" ||
      !Number.isSafeInteger(payload.version) ||
      payload.version < 0 ||
      remote.version <= payload.version
    )
      throw new DomainError("VERSION_CONFLICT");
    const next = structuredClone(payload);
    next.version = remote.version;
    if (collection === "entityMemos") {
      const memo = requireEntityMemoRecord(value);
      requireEntityMemoOwner(
        {
          workspaceId: journal.targetWorkspaceId,
          principalId: journal.targetPrincipalId,
        },
        memo,
      );
      const input = localObject(payload.input ?? null);
      if (
        memo.targetKind !== input.targetKind ||
        memo.targetId !== input.targetId ||
        typeof input.bodyMd !== "string" ||
        payload.deleted !== false ||
        Object.keys(input).some(
          (key) => !["targetKind", "targetId", "bodyMd"].includes(key),
        )
      )
        throw new DomainError("VALIDATION_ERROR");
      next.input = {
        ...input,
        bodyMd: decision.choice === "REMOTE" ? memo.bodyMd : input.bodyMd,
      };
      const sync = localObject(payload.syncCommand!);
      next.syncCommand = {
        ...sync,
        effects: [
          {
            collection: "entityMemos",
            id: memo.id,
            op: "UPSERT",
            baseVersion: memo.version,
          },
        ],
      };
    } else if (collection === "manualOrders") {
      const state = requireManualOrderState(remote.value);
      if (
        !Array.isArray(payload.orderedEntityIds) ||
        payload.orderedEntityIds.some((id) => typeof id !== "string")
      )
        throw new DomainError("VALIDATION_ERROR");
      if (decision.choice === "REMOTE") {
        const retained = [...state.entries]
          .sort((a, b) => a.position - b.position)
          .map((entry) => entry.entityId);
        const present = new Set(retained);
        next.orderedEntityIds = [
          ...retained,
          ...payload.orderedEntityIds.filter((id) => !present.has(String(id))),
        ];
      }
    } else if (collection === "files") {
      if (typeof value.name !== "string" || typeof payload.name !== "string")
        throw new DomainError("VALIDATION_ERROR");
      if (decision.choice === "REMOTE") next.name = value.name;
    } else {
      const input = localObject(payload.input ?? null),
        replacement = structuredClone(input);
      for (const field of Object.keys(input)) {
        if (
          ![
            "status",
            "activationState",
            "activationPolicy",
            "projectLifecycle",
          ].includes(field)
        )
          throw new DomainError("VALIDATION_ERROR");
        const current =
          value[field === "projectLifecycle" ? "lifecycle" : field];
        if (typeof current !== "string")
          throw new DomainError("VALIDATION_ERROR");
        if (decision.choice === "REMOTE") replacement[field] = current;
      }
      next.input = replacement;
      resultingWorkVersions.set(String(payload.id), {
        previous: payload.version + 1,
        next: remote.version + 1,
      });
    }
    amended.set(step.id, { ...step, payload: next });
  }
  return pending.map((step) => {
    const resolved = amended.get(step.id) ?? structuredClone(step);
    if (resolved.path !== "/api/organize") return resolved;
    const payload = localObject(resolved.payload);
    if (payload.kind !== "WORK" || !Array.isArray(payload.entries))
      return resolved;
    const entries = payload.entries.map((entry) => {
      const member = localObject(entry),
        updated = resultingWorkVersions.get(String(member.id));
      return updated && member.version === updated.previous
        ? { ...member, version: updated.next }
        : member;
    });
    return { ...resolved, payload: { ...payload, entries } };
  });
}
