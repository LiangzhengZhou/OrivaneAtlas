import { type ActorContext, DomainError } from "@arclattice/domain";
import type {
  AuthorizationService,
  Clock,
  NotebookService,
  WorkService,
} from "./index";
import { requireStableUuid } from "./mutation-receipt";

export const organizationKinds = ["WORK", "NOTE", "FOLDER"] as const;
export type OrganizationKind = (typeof organizationKinds)[number];
export const organizeActions = [
  "archive",
  "unarchive",
  "move",
  "delete",
  "create",
  "rename",
  "icon",
] as const;
export type OrganizeAction = (typeof organizeActions)[number];
/** Folder nesting bound shared by Application validation and the explorer UI. */
export const maxFolderDepth = 8;

export interface Organization {
  kind: OrganizationKind;
  id: string;
  workspaceId: string;
  version: number;
  archived: boolean;
  /** Legacy free-text grouping for NOTE rows written before stable folders. */
  folder: string;
  /** Stable containing folder for NOTE rows; "" is Unfiled. */
  folderId?: string;
  /** Parent folder for FOLDER rows; "" is top level. */
  parentId?: string;
  /** Display name for FOLDER rows. */
  name?: string;
  /** Optional emoji presentation glyph for NOTE/FOLDER rows; "" restores the default. */
  icon?: string;
  updatedAt: string;
  updatedBy: string;
}
export interface OrganizationStore {
  list(): Promise<Organization[]>;
  save(value: Organization, expectedVersion: number): Promise<void>;
}
export interface OrganizeEntry {
  id: string;
  version: number;
  organizationVersion: number;
}
export interface OrganizeInput {
  kind: OrganizationKind;
  action: OrganizeAction;
  /** Legacy NOTE move target by text; kept for older clients. */
  folder?: string;
  /** NOTE move target folder identity; "" moves to Unfiled. */
  folderId?: string;
  /** FOLDER display name for create/rename. */
  name?: string;
  /** FOLDER parent identity for create/move; "" is top level. */
  parentId?: string;
  /** Stable client-generated FOLDER identity for create. */
  id?: string;
  /** Emoji presentation glyph for NOTE/FOLDER icon actions; "" restores the default. */
  icon?: string;
  entries?: OrganizeEntry[];
}
/** Bounded display glyph: no control characters, no blank replacement, max 16 code points. */
export function requireIcon(value: unknown): string {
  if (typeof value !== "string") throw new DomainError("VALIDATION_ERROR");
  if (value !== "" && !value.trim()) throw new DomainError("VALIDATION_ERROR");
  if ([...value].length > 16 || /[\x00-\x1f]/.test(value))
    throw new DomainError("VALIDATION_ERROR");
  return value;
}

/** Trimmed, printable folder name; empty, overlong and control names are rejected. */
export function requireFolderName(value: unknown): string {
  if (typeof value !== "string") throw new DomainError("VALIDATION_ERROR");
  const name = value.trim();
  if (!name || name.length > 80 || /[\x00-\x1f]/.test(name))
    throw new DomainError("VALIDATION_ERROR");
  return name;
}

/** Visible folder ancestry from the recorded parent links. */
export function folderDepth(
  id: string,
  folders: readonly Organization[],
): number {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  let depth = 0;
  let cursor = byId.get(id)?.parentId ?? "";
  while (cursor && !seen.has(cursor)) {
    const parent = byId.get(cursor);
    if (!parent) return Number.MAX_SAFE_INTEGER;
    seen.add(cursor);
    depth += 1;
    cursor = parent.parentId ?? "";
  }
  return depth;
}

/** All folder identities below one folder, including the folder itself. */
export function folderSubtree(
  id: string,
  folders: readonly Organization[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    const parent = folder.parentId ?? "";
    children.set(parent, [...(children.get(parent) ?? []), folder.id]);
  }
  const result = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const next = pending.pop()!;
    if (result.has(next)) continue;
    result.add(next);
    pending.push(...(children.get(next) ?? []));
  }
  return result;
}

/** Height below one folder; leaves have height 0. Cycles fail closed. */
function subtreeHeight(
  id: string,
  folders: readonly Organization[],
  seen: Set<string>,
): number {
  if (seen.has(id)) return Number.MAX_SAFE_INTEGER;
  seen.add(id);
  const children = folders.filter((folder) => folder.parentId === id);
  const height = children.length
    ? Math.max(
        ...children.map((child) => subtreeHeight(child.id, folders, seen)),
      ) + 1
    : 0;
  seen.delete(id);
  return height;
}

export class FolderDirectory {
  private readonly folders: readonly Organization[];
  private readonly active: Map<string, Organization>;
  constructor(organizations: readonly Organization[]) {
    this.folders = structuredClone(
      organizations.filter((entry) => entry.kind === "FOLDER"),
    );
    this.active = new Map(
      this.folders
        .filter((folder) => !folder.archived)
        .map((folder) => [folder.id, folder]),
    );
  }
  get size() {
    return this.active.size;
  }
  isActive(id: string): boolean {
    return this.active.has(id);
  }
  byId(id: string): Organization | undefined {
    return this.active.get(id);
  }
  /** "" is the root; every other parent must be an active folder. */
  requireParent(parentId: string): string {
    if (typeof parentId !== "string" || /[\x00-\x1f]/.test(parentId))
      throw new DomainError("VALIDATION_ERROR");
    if (parentId !== "" && !this.active.has(parentId))
      throw new DomainError("NOT_FOUND");
    return parentId;
  }
  /** Reject moving a folder below itself or one of its descendants. */
  requireMoveTarget(id: string, parentId: string): void {
    if (parentId === id) throw new DomainError("VALIDATION_ERROR");
    if (folderSubtree(id, this.folders).has(parentId))
      throw new DomainError("VALIDATION_ERROR");
  }
  requireDepth(parentId: string, movingId?: string): void {
    const parentDepth = parentId ? folderDepth(parentId, this.folders) + 1 : 0;
    const height = movingId
      ? subtreeHeight(movingId, this.folders, new Set())
      : 0;
    if (parentDepth + height >= maxFolderDepth)
      throw new DomainError("VALIDATION_ERROR");
  }
  children(id: string): readonly Organization[] {
    return this.folders.filter(
      (folder) => !folder.archived && (folder.parentId ?? "") === id,
    );
  }
}

/** Must run within a host request transaction, including its idempotency receipt. */
export class OrganizationService {
  constructor(
    private readonly store: OrganizationStore,
    private readonly work: Pick<WorkService, "snapshot" | "setDeleted">,
    private readonly notes: Pick<NotebookService, "list" | "setDeleted"> &
      Partial<Pick<NotebookService, "manifest">>,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
  ) {}
  async apply(contextInput: ActorContext, inputValue: OrganizeInput) {
    const context = structuredClone(contextInput);
    const input = structuredClone(inputValue);
    await this.authorization.require(
      context,
      input.action === "delete" ? "work:delete" : "work:update",
    );
    if (
      !organizationKinds.includes(input.kind) ||
      !organizeActions.includes(input.action)
    )
      throw new DomainError("VALIDATION_ERROR");
    const metadata = (await this.store.list()).filter(
      (entry) => entry.workspaceId === context.workspaceId,
    );
    const folders = new FolderDirectory(metadata);
    if (input.kind === "FOLDER")
      return this.applyFolder(context, input, metadata, folders);
    if (input.action === "create" || input.action === "rename")
      throw new DomainError("VALIDATION_ERROR");
    const entries = this.requireEntries(input);
    if (
      (input.action === "move" && input.kind !== "NOTE") ||
      (input.action === "icon" && input.kind !== "NOTE") ||
      (["archive", "unarchive"].includes(input.action) && input.kind !== "WORK")
    )
      throw new DomainError("VALIDATION_ERROR");
    let move: { folder: string; folderId: string } | null = null;
    if (input.action === "move")
      move =
        typeof input.folderId === "string"
          ? {
              folder: "",
              folderId: (() => {
                if (input.folderId === "") return "";
                if (!folders.isActive(input.folderId))
                  throw new DomainError("NOT_FOUND");
                return input.folderId;
              })(),
            }
          : {
              folder: this.legacyFolder(input.folder),
              folderId: "",
            };
    const entities = (
      input.kind === "NOTE"
        ? this.notes.manifest
          ? await this.notes.manifest(context)
          : await this.notes.list(context)
        : (await this.work.snapshot(context, true)).items
    ) as readonly {
      id: string;
      version: number;
      workspaceId: string;
      deletedAt: string | null;
      type?: string;
    }[];
    // Preflight all entries before any mutation. The enclosing transaction handles races.
    for (const entry of entries) {
      const entity = entities.find(
        (value) =>
          value.id === entry.id && value.workspaceId === context.workspaceId,
      );
      if (
        !entity ||
        entity.deletedAt ||
        (entity.type === "PROJECT" && input.action === "delete")
      )
        throw new DomainError("NOT_FOUND");
      const old = metadata.find(
        (e) => e.kind === input.kind && e.id === entry.id,
      );
      if (
        entity.version !== entry.version ||
        (old?.version ?? 0) !== entry.organizationVersion
      )
        throw new DomainError("VERSION_CONFLICT");
    }
    for (const entry of entries) {
      if (input.action === "delete") {
        if (input.kind === "NOTE")
          await this.notes.setDeleted(context, entry.id, entry.version, true);
        else await this.work.setDeleted(context, entry.id, entry.version, true);
      } else if (input.action === "icon") {
        const old = metadata.find(
          (e) => e.kind === "NOTE" && e.id === entry.id,
        );
        const next = {
          kind: "NOTE",
          id: entry.id,
          workspaceId: context.workspaceId,
          version: entry.organizationVersion + 1,
          archived: old?.archived ?? false,
          folder: old?.folder ?? "",
          icon: requireIcon(input.icon),
          updatedAt: this.clock.now(),
          updatedBy: context.principalId,
        } as Organization;
        if (old?.folderId !== undefined) next.folderId = old.folderId;
        await this.store.save(next, entry.organizationVersion);
      } else {
        const old = metadata.find(
          (e) => e.kind === input.kind && e.id === entry.id,
        );
        const next = {
          kind: input.kind,
          id: entry.id,
          workspaceId: context.workspaceId,
          version: entry.organizationVersion + 1,
          archived:
            input.action === "archive"
              ? true
              : input.action === "unarchive"
                ? false
                : (old?.archived ?? false),
          folder:
            input.action === "move"
              ? (move!.folder ?? "")
              : (old?.folder ?? ""),
          updatedAt: this.clock.now(),
          updatedBy: context.principalId,
        } as Organization;
        if (input.action === "move") next.folderId = move!.folderId;
        else if (old?.folderId !== undefined) next.folderId = old.folderId;
        if (old?.icon !== undefined) next.icon = old.icon;
        await this.store.save(next, entry.organizationVersion);
      }
    }
    return { changed: entries.length };
  }

  private requireEntries(input: OrganizeInput): OrganizeEntry[] {
    if (
      !Array.isArray(input.entries) ||
      input.entries.length < 1 ||
      input.entries.length > 100 ||
      input.entries.some(
        (e) =>
          !e ||
          typeof e !== "object" ||
          typeof e.id !== "string" ||
          !e.id ||
          !Number.isSafeInteger(e.version) ||
          e.version < 1 ||
          !Number.isSafeInteger(e.organizationVersion) ||
          e.organizationVersion < 0,
      ) ||
      new Set(input.entries.map((e) => e.id)).size !== input.entries.length
    )
      throw new DomainError("VALIDATION_ERROR");
    return input.entries;
  }

  private legacyFolder(value: unknown): string {
    const folder = typeof value === "string" ? value.trim() : "";
    if (folder.length > 80 || /[\x00-\x1f]/.test(folder))
      throw new DomainError("VALIDATION_ERROR");
    return folder;
  }

  private async applyFolder(
    context: ActorContext,
    input: OrganizeInput,
    metadata: Organization[],
    folders: FolderDirectory,
  ): Promise<{ changed: number }> {
    const save = async (
      folder: Organization,
      expectedVersion: number,
      patch: Partial<Organization>,
    ) =>
      this.store.save(
        {
          kind: "FOLDER",
          id: folder.id,
          workspaceId: context.workspaceId,
          version: expectedVersion + 1,
          archived: folder.archived,
          folder: "",
          name: folder.name,
          parentId: folder.parentId ?? "",
          icon: folder.icon,
          updatedAt: this.clock.now(),
          updatedBy: context.principalId,
          ...patch,
        } as Organization,
        expectedVersion,
      );
    if (input.action === "create") {
      const id = requireStableUuid(input.id, "folderId");
      if (metadata.some((entry) => entry.kind === "FOLDER" && entry.id === id))
        throw new DomainError("VERSION_CONFLICT");
      const parentId = folders.requireParent(
        typeof input.parentId === "string" ? input.parentId : "",
      );
      folders.requireDepth(parentId);
      await this.store.save(
        {
          kind: "FOLDER",
          id,
          workspaceId: context.workspaceId,
          version: 1,
          archived: false,
          folder: "",
          name: requireFolderName(input.name),
          parentId,
          updatedAt: this.clock.now(),
          updatedBy: context.principalId,
        },
        0,
      );
      return { changed: 1 };
    }
    const entries = this.requireEntries(input).map((entry) => ({
      entry,
      folder:
        input.action === "unarchive"
          ? metadata.find(
              (row) =>
                row.kind === "FOLDER" && row.id === entry.id && row.archived,
            )
          : folders.byId(entry.id),
    }));
    for (const { entry, folder } of entries) {
      if (!folder || folder.version !== entry.version)
        throw new DomainError(folder ? "VERSION_CONFLICT" : "NOT_FOUND");
    }
    if (input.action === "unarchive") {
      for (const { folder } of entries) {
        folders.requireParent(folder!.parentId ?? "");
        folders.requireDepth(folder!.parentId ?? "");
      }
      for (const { entry, folder } of entries)
        await save(folder!, entry.version, { archived: false });
      return { changed: entries.length };
    }
    if (input.action === "rename") {
      const name = requireFolderName(input.name);
      for (const { entry, folder } of entries)
        await save(folder!, entry.version, { name });
      return { changed: entries.length };
    }
    if (input.action === "icon") {
      const icon = requireIcon(input.icon);
      for (const { entry, folder } of entries)
        await save(folder!, entry.version, { icon });
      return { changed: entries.length };
    }
    if (input.action === "move") {
      const parentId = folders.requireParent(
        typeof input.parentId === "string" ? input.parentId : "",
      );
      for (const { entry, folder } of entries) {
        folders.requireMoveTarget(entry.id, parentId);
        folders.requireDepth(parentId, entry.id);
        await save(folder!, entry.version, { parentId });
      }
      return { changed: entries.length };
    }
    if (input.action === "delete") {
      const referencedNotes = new Set(
        metadata
          .filter((entry) => entry.kind === "NOTE" && entry.folderId)
          .map((entry) => entry.folderId!),
      );
      const childFolders = new Set(
        metadata
          .filter((entry) => entry.kind === "FOLDER" && entry.parentId)
          .map((entry) => entry.parentId!),
      );
      for (const { entry, folder } of entries) {
        if (referencedNotes.has(entry.id) || childFolders.has(entry.id))
          throw new DomainError("VALIDATION_ERROR");
        await save(folder!, entry.version, { archived: true });
      }
      return { changed: entries.length };
    }
    throw new DomainError("VALIDATION_ERROR");
  }
}
