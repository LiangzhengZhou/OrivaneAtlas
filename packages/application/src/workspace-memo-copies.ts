import {
  type ActorContext,
  DomainError,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
} from "@arclattice/domain";
import type { EntityMemoIdentity } from "./entity-memos";
import { localDto, localObject } from "./local-dto";
import type { BindingPreviewSide } from "./workspace-binding-preview";
import {
  materializeWorkspaceMergeCopies,
  type WorkspaceMergeCopy,
} from "./workspace-merge-materialize";
import type { planWorkspaceMergeSelection } from "./workspace-merge-selection";

/** The reviewed target mapping changes a private Memo's canonical identity too.
 * No source owner is ever sent as remote authorization. */
export async function materializeWorkspaceMemoCopies(
  sourceInput: BindingPreviewSide,
  planInput: ReturnType<typeof planWorkspaceMergeSelection>,
  remoteInput: ActorContext,
  identity: Pick<EntityMemoIdentity, "forTarget">,
) {
  const source = structuredClone(sourceInput),
    plan = structuredClone(planInput),
    remote = { ...remoteInput };
  if (remote.workspaceId !== plan.remoteWorkspaceId || !remote.principalId)
    throw new DomainError("FORBIDDEN");
  const copies = materializeWorkspaceMergeCopies(source, plan);
  const used = new Set(
    copies
      .filter((copy) => copy.collection !== "entityMemos")
      .map((copy) => copy.targetId),
  );
  const result: WorkspaceMergeCopy[] = [];
  for (const copy of copies) {
    if (copy.collection !== "entityMemos") {
      result.push(copy);
      continue;
    }
    const row = source.records.find(
      (row) => row.collection === "entityMemos" && row.id === copy.sourceId,
    );
    if (!row) throw new DomainError("VALIDATION_ERROR");
    const original = requireEntityMemoRecord(row.value);
    const actor = {
      workspaceId: source.workspaceId,
      principalId: plan.principalId,
    };
    requireEntityMemoOwner(actor, original);
    if (original.id !== (await identity.forTarget(actor, original)))
      throw new DomainError("VALIDATION_ERROR");
    const value = localObject(copy.value);
    // A reviewed ownership transfer copies text, never another owner's AI grant.
    delete value.aiPolicy;
    const memo = requireEntityMemoRecord(value);
    const targetId = await identity.forTarget(remote, memo);
    if (used.has(targetId)) throw new DomainError("VALIDATION_ERROR");
    used.add(targetId);
    result.push({
      ...copy,
      targetId,
      value: localDto({ ...value, id: targetId }),
    });
  }
  return {
    copies: result,
    selection: {
      ...plan,
      mappings: plan.mappings.map((mapping) =>
        mapping.collection === "entityMemos" && mapping.action === "COPY"
          ? {
              ...mapping,
              targetId: result.find(
                (copy) =>
                  copy.collection === "entityMemos" &&
                  copy.sourceId === mapping.sourceId,
              )!.targetId,
            }
          : mapping,
      ),
    },
  };
}
