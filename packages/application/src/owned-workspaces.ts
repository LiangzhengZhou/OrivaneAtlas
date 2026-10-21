import {
  type ActorContext,
  DomainError,
  requireTitle,
} from "@arclattice/domain";
import { requireStableUuid, stableUuidPattern } from "./mutation-receipt";

export const ownedWorkspaceCreateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name"],
  properties: {
    id: { type: "string", pattern: stableUuidPattern },
    name: { type: "string", minLength: 1, maxLength: 240, pattern: "\\S" },
  },
} as const;

export interface OwnedWorkspace {
  id: string;
  name: string;
  ownerPrincipalId: string;
  version: 1;
  createdAt: string;
}
export interface OwnedWorkspaceCreate {
  id: string;
  name: string;
  createdAt: string;
  activityId: string;
}
/** Host-only ownership port. Caller authenticates the principal and owns the transaction. */
export interface OwnedWorkspaceDirectory {
  list(): Promise<readonly OwnedWorkspace[]>;
  create(input: OwnedWorkspaceCreate): Promise<OwnedWorkspace>;
}
export function requireOwnedWorkspaceCreate(
  input: OwnedWorkspaceCreate,
): OwnedWorkspaceCreate {
  const copy = structuredClone(input);
  requireStableUuid(copy.id);
  requireStableUuid(copy.activityId);
  copy.name = requireTitle(copy.name);
  if (!Number.isFinite(Date.parse(copy.createdAt)))
    throw new DomainError("VALIDATION_ERROR");
  return copy;
}
export class OwnedWorkspaceService {
  constructor(
    private readonly directory: OwnedWorkspaceDirectory,
    private readonly authorization: {
      require(actor: ActorContext): Promise<void>;
    },
    private readonly ids: { next(): string },
    private readonly clock: { now(): string },
  ) {}
  async create(actorInput: ActorContext, id: string, name: string) {
    const actor = { ...actorInput };
    await this.authorization.require(actor);
    const input = requireOwnedWorkspaceCreate({
      id,
      name,
      activityId: this.ids.next(),
      createdAt: this.clock.now(),
    });
    return this.directory.create(input);
  }
}
