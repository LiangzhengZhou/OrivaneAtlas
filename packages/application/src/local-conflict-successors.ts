import type { LocalCommandPlan } from "./local-command-plan";
import { localObject } from "./local-dto";
import { equalLocalJson } from "./local-json-equal";
import { compareLocalMutations } from "./local-mutation-order";
import type { LocalMutation } from "./local-persistence";

/** Review the first conflict only. Later never-sent edits remain independent commands. */
export function localConflictSuccessors(
  first: LocalCommandPlan,
  plans: readonly LocalCommandPlan[],
): readonly LocalMutation[] | null {
  const original = first.mutations[0];
  if (!original || first.state !== "CONFLICT" || first.mutations.length !== 1)
    return null;
  const related = plans
    .filter((plan) =>
      plan.mutations.some(
        (mutation) =>
          mutation.entityType === original.entityType &&
          mutation.entityId === original.entityId,
      ),
    )
    .sort((left, right) =>
      compareLocalMutations(left.mutations[0]!, right.mutations[0]!),
    );
  if (related[0]?.id !== first.id) return null;
  let previous = original;
  const followers: LocalMutation[] = [];
  for (const plan of related.slice(1)) {
    const mutation = plan.mutations[0];
    if (
      !mutation ||
      plan.state !== "READY" ||
      plan.command?.name !== first.command?.name ||
      plan.mutations.length !== 1 ||
      mutation.operation !== "PATCH" ||
      mutation.state !== "PENDING" ||
      mutation.attemptCount !== 0 ||
      mutation.lastAttemptAt !== null ||
      mutation.workspaceId !== original.workspaceId ||
      mutation.principalId !== original.principalId ||
      mutation.deviceId !== original.deviceId ||
      !mutation.order ||
      !previous.order ||
      compareLocalMutations(previous, mutation) >= 0 ||
      mutation.baseVersion !== localObject(previous.payload).version ||
      mutation.basePayload === undefined ||
      !equalLocalJson(mutation.basePayload, previous.payload)
    )
      return null;
    followers.push(structuredClone(mutation));
    previous = mutation;
  }
  return followers;
}
