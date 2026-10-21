import {
  type ActorContext,
  DomainError,
  type EntityMemo,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
  requireTitle,
} from "@arclattice/domain";
import { requireStableUuid } from "./mutation-receipt";

export type MemoFormalization =
  | {
      kind: "CREATE_TASK";
      title: string;
      bodyMd: string;
      projectId: string | null;
    }
  | { kind: "CREATE_DOCUMENT"; title: string; bodyMd: string; spaceId: string }
  | {
      kind: "APPEND_DOCUMENT";
      bodyMd: string;
      documentId: string;
      version: number;
    };
export interface MemoProposal {
  readonly id: string;
  readonly source: EntityMemo;
  readonly sourceHash: string;
  readonly change: MemoFormalization;
}

function change(input: MemoFormalization): MemoFormalization {
  if (
    !input ||
    typeof input !== "object" ||
    typeof input.bodyMd !== "string" ||
    !input.bodyMd.trim() ||
    input.bodyMd.length > 100000
  )
    throw new DomainError("VALIDATION_ERROR");
  const id = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= 240;
  let keys: string[];
  if (input.kind === "CREATE_TASK") {
    requireTitle(input.title);
    if (input.projectId !== null && !id(input.projectId))
      throw new DomainError("VALIDATION_ERROR");
    keys = ["kind", "title", "bodyMd", "projectId"];
  } else if (input.kind === "CREATE_DOCUMENT") {
    if (
      typeof input.title !== "string" ||
      input.title.length > 240 ||
      !id(input.spaceId)
    )
      throw new DomainError("VALIDATION_ERROR");
    keys = ["kind", "title", "bodyMd", "spaceId"];
  } else if (input.kind === "APPEND_DOCUMENT") {
    if (
      !id(input.documentId) ||
      !Number.isSafeInteger(input.version) ||
      input.version < 1 ||
      input.version >= Number.MAX_SAFE_INTEGER
    )
      throw new DomainError("VALIDATION_ERROR");
    keys = ["kind", "bodyMd", "documentId", "version"];
  } else throw new DomainError("VALIDATION_ERROR");
  if (Object.keys(input).some((key) => !keys.includes(key)))
    throw new DomainError("VALIDATION_ERROR");
  return structuredClone(input);
}

/** Private, temporary reviewed intent. Adapters hash; Application owns identity
 * and stale-source rules. Applying still enters the ordinary business services. */
export class MemoProposalService {
  constructor(
    private readonly hash: (value: string) => Promise<string>,
    private readonly nextId: () => string,
  ) {}
  async propose(
    actorInput: ActorContext,
    sourceInput: EntityMemo,
    input: MemoFormalization,
  ): Promise<MemoProposal> {
    const actor = { ...actorInput },
      source = structuredClone(requireEntityMemoRecord(sourceInput));
    requireEntityMemoOwner(actor, source);
    if (source.deletedAt) throw new DomainError("NOT_FOUND");
    const proposed = change(input);
    const sourceHash = await this.hash(source.bodyMd);
    if (!/^[a-f0-9]{64}$/.test(sourceHash))
      throw new Error("INVALID_SOURCE_HASH");
    return {
      id: requireStableUuid(this.nextId()),
      source,
      sourceHash,
      change: proposed,
    };
  }
  async review(
    actorInput: ActorContext,
    proposalInput: MemoProposal,
    currentInput: EntityMemo,
  ): Promise<MemoFormalization> {
    const actor = { ...actorInput },
      proposal = structuredClone(proposalInput);
    const current = structuredClone(requireEntityMemoRecord(currentInput));
    requireStableUuid(proposal.id);
    const source = requireEntityMemoRecord(proposal.source);
    requireEntityMemoOwner(actor, source);
    requireEntityMemoOwner(actor, current);
    if (
      current.deletedAt ||
      source.deletedAt ||
      current.id !== source.id ||
      current.targetId !== source.targetId ||
      current.targetKind !== source.targetKind ||
      current.version !== source.version ||
      current.bodyMd !== source.bodyMd ||
      current.updatedAt !== source.updatedAt ||
      proposal.sourceHash !== (await this.hash(current.bodyMd))
    )
      throw new DomainError("VERSION_CONFLICT", { field: "memoProposal" });
    return change(proposal.change);
  }
}
