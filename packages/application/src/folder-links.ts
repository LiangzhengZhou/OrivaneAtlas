import type { ActorContext } from "@arclattice/domain";
import { DomainError } from "@arclattice/domain";
import type { AuthorizationService, Clock, IdGenerator } from "./index";

export const folderLinkTargetKinds = ["NOTE", "DOCUMENT", "FILE"] as const;
export type FolderLinkTargetKind = (typeof folderLinkTargetKinds)[number];

export interface FolderLink {
  id: string;
  workspaceId: string;
  folderId: string;
  targetKind: FolderLinkTargetKind;
  targetId: string;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface FolderLinkInput {
  folderId: string;
  targetKind: FolderLinkTargetKind;
  targetId: string;
}
export interface FolderLinkStore {
  list(): Promise<FolderLink[]>;
  findActive(
    folderId: string,
    targetKind: FolderLinkTargetKind,
    targetId: string,
  ): Promise<FolderLink | null>;
  save(link: FolderLink, expectedVersion: number): Promise<void>;
}
/** Adapter-owned existence and folder-scope checks, executed in the same transaction. */
export interface FolderLinkTargetPort {
  folder(
    folderId: string,
  ): Promise<{ archived: boolean; scope: string } | null>;
  target(targetKind: FolderLinkTargetKind, targetId: string): Promise<boolean>;
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stableId = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !uuid.test(value))
    throw new DomainError("VALIDATION_ERROR", { field });
  return value;
};

export function requireFolderLinkInput(
  input: FolderLinkInput,
): FolderLinkInput {
  if (!input || typeof input !== "object")
    throw new DomainError("VALIDATION_ERROR");
  if (!folderLinkTargetKinds.includes(input.targetKind))
    throw new DomainError("VALIDATION_ERROR");
  return {
    folderId: stableId(input.folderId, "folderId"),
    targetKind: input.targetKind,
    targetId: stableId(input.targetId, "targetId"),
  };
}

/** Must run inside the host's receipt/transaction boundary. */
export class FolderLinkService {
  constructor(
    private readonly store: FolderLinkStore,
    private readonly targets: FolderLinkTargetPort,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async list(context: ActorContext, folderId?: string) {
    await this.authorization.require(context, "work:read");
    const links = (await this.store.list()).filter(
      (link) =>
        link.workspaceId === context.workspaceId &&
        link.deletedAt === null &&
        (folderId === undefined || link.folderId === folderId),
    );
    return links;
  }

  async create(
    context: ActorContext,
    inputValue: FolderLinkInput,
    idValue?: string,
  ): Promise<FolderLink> {
    await this.authorization.require(context, "work:update");
    const input = requireFolderLinkInput(inputValue);
    const folder = await this.targets.folder(input.folderId);
    if (!folder || folder.archived || folder.scope !== "GENERAL")
      throw new DomainError("VALIDATION_ERROR");
    if (!(await this.targets.target(input.targetKind, input.targetId)))
      throw new DomainError("NOT_FOUND");
    if (
      await this.store.findActive(
        input.folderId,
        input.targetKind,
        input.targetId,
      )
    )
      throw new DomainError("VERSION_CONFLICT");
    const id =
      idValue === undefined ? this.ids.next() : stableId(idValue, "id");
    const now = this.clock.now();
    const link: FolderLink = {
      ...input,
      id,
      workspaceId: context.workspaceId,
      version: 1,
      createdBy: context.principalId,
      createdAt: now,
      updatedBy: context.principalId,
      updatedAt: now,
      deletedAt: null,
    };
    await this.store.save(link, 0);
    return link;
  }

  async remove(
    context: ActorContext,
    id: string,
    expectedVersion: number,
  ): Promise<FolderLink> {
    await this.authorization.require(context, "work:delete");
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new DomainError("VALIDATION_ERROR");
    const link = (await this.store.list()).find(
      (entry) => entry.id === id && entry.workspaceId === context.workspaceId,
    );
    if (!link || link.deletedAt) throw new DomainError("NOT_FOUND");
    if (link.version !== expectedVersion)
      throw new DomainError("VERSION_CONFLICT");
    const removed: FolderLink = {
      ...link,
      version: expectedVersion + 1,
      updatedBy: context.principalId,
      updatedAt: this.clock.now(),
      deletedAt: this.clock.now(),
    };
    await this.store.save(removed, expectedVersion);
    return removed;
  }
}
