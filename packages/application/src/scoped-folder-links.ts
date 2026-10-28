import type { ActorContext } from "@arclattice/domain";
import { DomainError } from "@arclattice/domain";
import type { AuthorizationService, Clock, IdGenerator } from "./index";

export interface SpaceFolderLink {
  id: string;
  workspaceId: string;
  spaceId: string;
  folderId: string;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface ProjectFolderLink {
  id: string;
  workspaceId: string;
  projectId: string;
  folderId: string;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface SpaceFolderLinkStore {
  list(): Promise<SpaceFolderLink[]>;
  findActive(
    spaceId: string,
    folderId: string,
  ): Promise<SpaceFolderLink | null>;
  save(value: SpaceFolderLink, expectedVersion: number): Promise<void>;
}
export interface ProjectFolderLinkStore {
  list(): Promise<ProjectFolderLink[]>;
  findActive(
    projectId: string,
    folderId: string,
  ): Promise<ProjectFolderLink | null>;
  save(value: ProjectFolderLink, expectedVersion: number): Promise<void>;
}
export interface ScopedFolderTargetPort {
  folder(
    folderId: string,
  ): Promise<{ archived: boolean; scope: string } | null>;
  space(spaceId: string): Promise<boolean>;
  project(projectId: string): Promise<boolean>;
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !uuid.test(value))
    throw new DomainError("VALIDATION_ERROR", { field });
  return value;
};
async function requireGeneralFolder(
  targets: ScopedFolderTargetPort,
  folderId: string,
) {
  const folder = await targets.folder(folderId);
  if (!folder || folder.archived || folder.scope !== "GENERAL")
    throw new DomainError("VALIDATION_ERROR");
}
function requireVersion(value: number) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new DomainError("VALIDATION_ERROR");
}

export class SpaceFolderLinkService {
  constructor(
    private readonly store: SpaceFolderLinkStore,
    private readonly targets: ScopedFolderTargetPort,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}
  async list(context: ActorContext, spaceId?: string) {
    await this.authorization.require(context, "work:read");
    return (await this.store.list()).filter(
      (link) =>
        link.workspaceId === context.workspaceId &&
        link.deletedAt === null &&
        (spaceId === undefined || link.spaceId === spaceId),
    );
  }
  async create(
    context: ActorContext,
    input: { spaceId: string; folderId: string },
    stableId?: string,
  ): Promise<SpaceFolderLink> {
    await this.authorization.require(context, "work:update");
    const spaceId = id(input.spaceId, "spaceId");
    const folderId = id(input.folderId, "folderId");
    await requireGeneralFolder(this.targets, folderId);
    if (!(await this.targets.space(spaceId)))
      throw new DomainError("NOT_FOUND");
    if (await this.store.findActive(spaceId, folderId))
      throw new DomainError("VERSION_CONFLICT");
    const now = this.clock.now();
    const link: SpaceFolderLink = {
      id: stableId === undefined ? this.ids.next() : id(stableId, "id"),
      workspaceId: context.workspaceId,
      spaceId,
      folderId,
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
  async remove(context: ActorContext, linkId: string, expected: number) {
    await this.authorization.require(context, "work:delete");
    requireVersion(expected);
    const link = (await this.store.list()).find(
      (entry) =>
        entry.id === linkId && entry.workspaceId === context.workspaceId,
    );
    if (!link || link.deletedAt) throw new DomainError("NOT_FOUND");
    if (link.version !== expected) throw new DomainError("VERSION_CONFLICT");
    const removed = {
      ...link,
      version: expected + 1,
      updatedBy: context.principalId,
      updatedAt: this.clock.now(),
      deletedAt: this.clock.now(),
    };
    await this.store.save(removed, expected);
    return removed;
  }
}

export class ProjectFolderLinkService {
  constructor(
    private readonly store: ProjectFolderLinkStore,
    private readonly targets: ScopedFolderTargetPort,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}
  async list(context: ActorContext, projectId?: string) {
    await this.authorization.require(context, "work:read");
    return (await this.store.list()).filter(
      (link) =>
        link.workspaceId === context.workspaceId &&
        link.deletedAt === null &&
        (projectId === undefined || link.projectId === projectId),
    );
  }
  async create(
    context: ActorContext,
    input: { projectId: string; folderId: string },
    stableId?: string,
  ): Promise<ProjectFolderLink> {
    await this.authorization.require(context, "work:update");
    const projectId = id(input.projectId, "projectId");
    const folderId = id(input.folderId, "folderId");
    await requireGeneralFolder(this.targets, folderId);
    if (!(await this.targets.project(projectId)))
      throw new DomainError("NOT_FOUND");
    if (await this.store.findActive(projectId, folderId))
      throw new DomainError("VERSION_CONFLICT");
    const now = this.clock.now();
    const link: ProjectFolderLink = {
      id: stableId === undefined ? this.ids.next() : id(stableId, "id"),
      workspaceId: context.workspaceId,
      projectId,
      folderId,
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
  async remove(context: ActorContext, linkId: string, expected: number) {
    await this.authorization.require(context, "work:delete");
    requireVersion(expected);
    const link = (await this.store.list()).find(
      (entry) =>
        entry.id === linkId && entry.workspaceId === context.workspaceId,
    );
    if (!link || link.deletedAt) throw new DomainError("NOT_FOUND");
    if (link.version !== expected) throw new DomainError("VERSION_CONFLICT");
    const removed = {
      ...link,
      version: expected + 1,
      updatedBy: context.principalId,
      updatedAt: this.clock.now(),
      deletedAt: this.clock.now(),
    };
    await this.store.save(removed, expected);
    return removed;
  }
}
