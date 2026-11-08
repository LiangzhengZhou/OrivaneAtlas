import { DomainError } from "@arclattice/domain";
import type { FolderLink, FolderLinkStore } from "./folder-links";
import { localObject } from "./local-dto";
import type { FolderLinkReplayEffect } from "./local-folder-link-replay-request";
import type { LocalJson } from "./local-persistence";
import type {
  ProjectFolderLink,
  ProjectFolderLinkStore,
  SpaceFolderLink,
  SpaceFolderLinkStore,
} from "./scoped-folder-links";

type Collection = FolderLinkReplayEffect["collection"];
export function requireCanonicalFolderLink(
  collection: Collection,
  value: unknown,
  id: string,
  workspaceId: string,
  version: number,
) {
  const link = localObject(value as LocalJson);
  if (
    link.id !== id ||
    link.workspaceId !== workspaceId ||
    link.version !== version ||
    typeof link.createdBy !== "string" ||
    typeof link.updatedBy !== "string" ||
    typeof link.createdAt !== "string" ||
    typeof link.updatedAt !== "string" ||
    (link.deletedAt !== null && typeof link.deletedAt !== "string") ||
    (collection === "folderLinks" &&
      (typeof link.folderId !== "string" ||
        !["NOTE", "DOCUMENT", "FILE"].includes(String(link.targetKind)) ||
        typeof link.targetId !== "string")) ||
    (collection === "spaceFolderLinks" &&
      (typeof link.spaceId !== "string" ||
        typeof link.folderId !== "string")) ||
    (collection === "projectFolderLinks" &&
      (typeof link.projectId !== "string" || typeof link.folderId !== "string"))
  )
    throw new DomainError("VALIDATION_ERROR", { field: "canonicalFolderLink" });
  return structuredClone(link);
}
interface AcceptedEffect {
  readonly collection: Collection;
  readonly id: string;
  readonly op: "UPSERT";
  readonly version: number;
  readonly value: unknown;
}

class LinkReplayGuard {
  private readonly consumed = new Set<string>();
  private readonly effects: readonly FolderLinkReplayEffect[];
  private readonly canonical: AcceptedEffect[] = [];
  constructor(
    private readonly collection: Collection,
    private readonly workspaceId: string,
    private readonly principalId: string,
    effects: readonly FolderLinkReplayEffect[],
  ) {
    this.effects = structuredClone(effects);
    if (
      !workspaceId ||
      !principalId ||
      !this.effects.length ||
      this.effects.some(
        (effect) =>
          effect.collection !== collection ||
          effect.op !== "UPSERT" ||
          !Number.isSafeInteger(effect.baseVersion) ||
          effect.baseVersion < 0,
      ) ||
      new Set(this.effects.map((effect) => effect.id)).size !==
        this.effects.length
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "folderLinkEffects",
      });
  }
  get acceptedEffects(): AcceptedEffect[] {
    return structuredClone(this.canonical);
  }
  async accept(
    value: {
      id: string;
      workspaceId: string;
      updatedBy: string;
    },
    expectedVersion: number,
  ): Promise<void> {
    const effect = this.effects.find((entry) => entry.id === value.id);
    if (
      !effect ||
      this.consumed.has(value.id) ||
      effect.baseVersion !== expectedVersion
    )
      throw new DomainError("VERSION_CONFLICT");
    if (
      value.workspaceId !== this.workspaceId ||
      value.updatedBy !== this.principalId
    )
      throw new DomainError("FORBIDDEN");
    this.consumed.add(value.id);
    this.canonical.push({
      collection: this.collection,
      id: value.id,
      op: "UPSERT",
      version: expectedVersion + 1,
      value: structuredClone(value),
    });
  }
  finish(): void {
    if (this.consumed.size !== this.effects.length)
      throw new DomainError("VERSION_CONFLICT");
  }
}

export class FolderLinkReplayStore implements FolderLinkStore {
  private readonly guard: LinkReplayGuard;
  constructor(
    private readonly delegate: FolderLinkStore,
    workspaceId: string,
    principalId: string,
    effects: readonly FolderLinkReplayEffect[],
  ) {
    this.guard = new LinkReplayGuard(
      "folderLinks",
      workspaceId,
      principalId,
      effects,
    );
  }
  get acceptedEffects() {
    return this.guard.acceptedEffects;
  }
  list(): Promise<FolderLink[]> {
    return this.delegate.list();
  }
  findActive(
    folderId: string,
    targetKind: FolderLink["targetKind"],
    targetId: string,
  ) {
    return this.delegate.findActive(folderId, targetKind, targetId);
  }
  async save(value: FolderLink, expected: number): Promise<void> {
    await this.guard.accept(value, expected);
    await this.delegate.save(value, expected);
  }
  finish(): void {
    this.guard.finish();
  }
}

export class SpaceFolderLinkReplayStore implements SpaceFolderLinkStore {
  private readonly guard: LinkReplayGuard;
  constructor(
    private readonly delegate: SpaceFolderLinkStore,
    workspaceId: string,
    principalId: string,
    effects: readonly FolderLinkReplayEffect[],
  ) {
    this.guard = new LinkReplayGuard(
      "spaceFolderLinks",
      workspaceId,
      principalId,
      effects,
    );
  }
  get acceptedEffects() {
    return this.guard.acceptedEffects;
  }
  list(): Promise<SpaceFolderLink[]> {
    return this.delegate.list();
  }
  findActive(spaceId: string, folderId: string) {
    return this.delegate.findActive(spaceId, folderId);
  }
  async save(value: SpaceFolderLink, expected: number): Promise<void> {
    await this.guard.accept(value, expected);
    await this.delegate.save(value, expected);
  }
  finish(): void {
    this.guard.finish();
  }
}

export class ProjectFolderLinkReplayStore implements ProjectFolderLinkStore {
  private readonly guard: LinkReplayGuard;
  constructor(
    private readonly delegate: ProjectFolderLinkStore,
    workspaceId: string,
    principalId: string,
    effects: readonly FolderLinkReplayEffect[],
  ) {
    this.guard = new LinkReplayGuard(
      "projectFolderLinks",
      workspaceId,
      principalId,
      effects,
    );
  }
  get acceptedEffects() {
    return this.guard.acceptedEffects;
  }
  list(): Promise<ProjectFolderLink[]> {
    return this.delegate.list();
  }
  findActive(projectId: string, folderId: string) {
    return this.delegate.findActive(projectId, folderId);
  }
  async save(value: ProjectFolderLink, expected: number): Promise<void> {
    await this.guard.accept(value, expected);
    await this.delegate.save(value, expected);
  }
  finish(): void {
    this.guard.finish();
  }
}
