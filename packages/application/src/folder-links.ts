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
export interface MoveFolderLinkInput {
  id: string;
  version: number;
  folderId: string;
  destinationLinkId: string | null;
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

  async move(
    context: ActorContext,
    input: MoveFolderLinkInput,
  ): Promise<FolderLink> {
    await this.authorization.require(context, "work:update");
    await this.authorization.require(context, "work:delete");
    const id = stableId(input.id, "id");
    const folderId = stableId(input.folderId, "folderId");
    const destinationId =
      input.destinationLinkId === null
        ? null
        : stableId(input.destinationLinkId, "destinationLinkId");
    if (!Number.isSafeInteger(input.version) || input.version < 1)
      throw new DomainError("VALIDATION_ERROR", { field: "version" });
    const source = (await this.store.list()).find(
      (link) => link.id === id && link.workspaceId === context.workspaceId,
    );
    if (!source || source.deletedAt) throw new DomainError("NOT_FOUND");
    if (source.version !== input.version)
      throw new DomainError("VERSION_CONFLICT");
    if (
      source.folderId === folderId ||
      !folderLinkTargetKinds.includes(source.targetKind)
    )
      throw new DomainError("VALIDATION_ERROR");
    for (const id of [source.folderId, folderId]) {
      const folder = await this.targets.folder(id);
      if (!folder || folder.archived || folder.scope !== "GENERAL")
        throw new DomainError("VALIDATION_ERROR", { field: "folderId" });
    }
    if (!(await this.targets.target(source.targetKind, source.targetId)))
      throw new DomainError("NOT_FOUND");
    const destination = await this.store.findActive(
      folderId,
      source.targetKind,
      source.targetId,
    );
    if ((destination?.id ?? null) !== destinationId)
      throw new DomainError("VERSION_CONFLICT", { field: "destinationLinkId" });
    const now = this.clock.now();
    const moved = {
      ...source,
      folderId: destination ? source.folderId : folderId,
      deletedAt: destination ? now : null,
      version: source.version + 1,
      updatedAt: now,
      updatedBy: context.principalId,
    };
    await this.store.save(moved, source.version);
    return moved;
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
