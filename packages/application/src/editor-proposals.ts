import { type ActorContext, DomainError } from "@arclattice/domain";

export interface EditorSource {
  workspaceId: string;
  documentId: string;
  version: number;
  from: number;
  to: number;
  sourceText: string;
}
export interface EditorProposal extends EditorSource {
  id: string;
  sourceHash: string;
  replacement: string;
  explanation?: string;
}

/** Selection proposals are temporary. Application validates identity and source;
 * the editor adapter alone applies the returned change through its transaction. */
export class EditorProposalService {
  constructor(private readonly hash: (text: string) => Promise<string>) {}

  private requireSource(actor: ActorContext, source: EditorSource) {
    if (source.workspaceId !== actor.workspaceId)
      throw new DomainError("FORBIDDEN");
    if (
      !source.documentId ||
      source.documentId.length > 240 ||
      !Number.isSafeInteger(source.version) ||
      source.version < 0 ||
      !Number.isSafeInteger(source.from) ||
      !Number.isSafeInteger(source.to) ||
      source.from < 0 ||
      source.to < source.from ||
      source.to - source.from !== source.sourceText.length ||
      source.sourceText.length > 12000
    )
      throw new DomainError("VALIDATION_ERROR");
  }

  async propose(
    actorInput: ActorContext,
    input: EditorSource,
    id: string,
    replacement: string,
  ): Promise<EditorProposal> {
    const actor = Object.freeze({ ...actorInput }),
      source = structuredClone(input);
    this.requireSource(actor, source);
    if (
      !id ||
      id.length > 240 ||
      typeof replacement !== "string" ||
      replacement.length > 100000
    )
      throw new DomainError("VALIDATION_ERROR");
    const sourceHash = await this.hash(source.sourceText);
    if (!/^[a-f0-9]{64}$/.test(sourceHash))
      throw new Error("INVALID_SOURCE_HASH");
    return { ...source, id, sourceHash, replacement };
  }

  async review(
    actorInput: ActorContext,
    proposalInput: EditorProposal,
    currentInput: EditorSource,
  ) {
    const actor = Object.freeze({ ...actorInput }),
      proposal = structuredClone(proposalInput),
      current = structuredClone(currentInput);
    this.requireSource(actor, proposal);
    this.requireSource(actor, current);
    if (
      proposal.documentId !== current.documentId ||
      proposal.version !== current.version ||
      proposal.from !== current.from ||
      proposal.to !== current.to ||
      proposal.sourceText !== current.sourceText ||
      proposal.sourceHash !== (await this.hash(current.sourceText))
    )
      throw new DomainError("VERSION_CONFLICT");
    if (
      typeof proposal.replacement !== "string" ||
      proposal.replacement.length > 100000
    )
      throw new DomainError("VALIDATION_ERROR");
    return { from: current.from, to: current.to, insert: proposal.replacement };
  }
}
