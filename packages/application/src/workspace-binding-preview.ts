import {
  type ActorContext,
  DomainError,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
} from "@arclattice/domain";
import { localDto, localObject } from "./local-dto";
import type { LocalEntity, LocalJson } from "./local-persistence";
import { requireProjectMaterialReplica } from "./project-knowledge-replay-effects";
import type { WorkspaceBootstrap } from "./workspace-bootstrap";

export function bindingManifestRecords(
  workspaceId: string,
  manifest: WorkspaceBootstrap,
): LocalEntity[] {
  const collections = {
    items: manifest.workspace.items,
    edges: manifest.workspace.edges.map((edge) => ({ ...edge, version: 1 })),
    categories: manifest.workspace.categories ?? [],
    organization: manifest.workspace.organization,
    projectMaterials: manifest.workspace.projectMaterials.map((entry) =>
      requireProjectMaterialReplica(
        entry,
        entry.id,
        workspaceId,
        entry.version,
      ),
    ),
    links: manifest.workspace.links,
    reminders: manifest.workspace.reminders ?? [],
    workflows: manifest.workspace.workflows ?? [],
    manualOrders: manifest.workspace.manualOrders ?? [],
    notes: manifest.notes,
    library: manifest.library,
    files: manifest.workspace.files ?? [],
  };
  return Object.entries(collections).flatMap(([collection, entries]) =>
    entries.map((entry) => {
      if (entry.workspaceId !== workspaceId) throw new DomainError("FORBIDDEN");
      return {
        workspaceId,
        collection,
        id:
          collection === "organization" && "kind" in entry
            ? `${entry.kind}:${entry.id}`
            : entry.id,
        version: entry.version,
        value: localDto(entry),
      };
    }),
  );
}

export interface BindingPreviewSide {
  workspaceId: string;
  revision: number;
  records: readonly LocalEntity[];
}
export interface BindingPreviewGroup {
  collection: string;
  key: string;
  localIds: string[];
  remoteIds: string[];
}
const metadata = new Set([
  "id",
  "workspaceId",
  "version",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "provenance",
  "bodyState",
  "bodyCharacterCount",
]);
function canonical(value: LocalJson): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const normalize = (value: string) =>
  value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
function live(side: BindingPreviewSide) {
  if (
    !side.workspaceId ||
    !Number.isSafeInteger(side.revision) ||
    side.revision < 0
  )
    throw new DomainError("VALIDATION_ERROR");
  const seen = new Set<string>();
  return side.records.filter((row) => {
    const key = JSON.stringify([row.collection, row.id]);
    if (seen.has(key)) throw new DomainError("VALIDATION_ERROR");
    seen.add(key);
    if (
      row.workspaceId !== side.workspaceId ||
      !row.id ||
      !Number.isSafeInteger(row.version) ||
      row.version < 1
    )
      throw new DomainError("VALIDATION_ERROR");
    return !localObject(row.value).deletedAt;
  });
}
function groups(
  local: readonly LocalEntity[],
  remote: readonly LocalEntity[],
  keys: (row: LocalEntity) => string[],
): BindingPreviewGroup[] {
  const index = new Map<string, BindingPreviewGroup>();
  for (const [side, rows] of [
    ["localIds", local],
    ["remoteIds", remote],
  ] as const)
    for (const row of rows)
      for (const key of new Set(keys(row))) {
        const scoped = JSON.stringify([row.collection, key]);
        const group = index.get(scoped) ?? {
          collection: row.collection,
          key,
          localIds: [],
          remoteIds: [],
        };
        group[side].push(row.id);
        index.set(scoped, group);
      }
  return [...index.values()].filter(
    (group) => group.localIds.length && group.remoteIds.length,
  );
}
function semantic(row: LocalEntity): string | null {
  const value = localObject(row.value);
  // A manifest cannot prove body equality. Never infer exact duplicates from title/size.
  if (
    ["notes", "library"].includes(row.collection) &&
    typeof value.bodyMd !== "string"
  )
    return null;
  if (!["items", "notes", "library"].includes(row.collection)) return null;
  return canonical(
    Object.fromEntries(
      Object.entries(value).filter(([key]) => !metadata.has(key)),
    ),
  );
}
function counts(rows: readonly LocalEntity[]) {
  const result = { tasks: 0, projects: 0, documents: 0, notes: 0, files: 0 };
  for (const row of rows) {
    const value = localObject(row.value);
    if (row.collection === "items" && value.type === "TASK") result.tasks++;
    if (row.collection === "items" && value.type === "PROJECT")
      result.projects++;
    if (row.collection === "library" && value.kind === "DOCUMENT")
      result.documents++;
    if (row.collection === "notes") result.notes++;
    if (row.collection === "files") result.files++;
  }
  return result;
}

/** Read-only review data. This never authorizes merge, binds identity or writes records. */
export function previewWorkspaceBinding(
  actor: ActorContext,
  localInput: BindingPreviewSide,
  remoteInput: BindingPreviewSide,
) {
  if (actor.workspaceId !== localInput.workspaceId)
    throw new DomainError("FORBIDDEN");
  const localSide = structuredClone(localInput),
    remoteSide = structuredClone(remoteInput);
  const local = live(localSide),
    remote = live(remoteSide);
  for (const row of local) {
    if (row.collection !== "entityMemos") continue;
    const memo = requireEntityMemoRecord(row.value);
    requireEntityMemoOwner(actor, memo);
    if (memo.id !== row.id || memo.version !== row.version)
      throw new DomainError("VALIDATION_ERROR");
  }
  const remoteById = new Map(remote.map((row) => [row.id, row]));
  const idCollisions = local.flatMap((row) => {
    const other = remoteById.get(row.id);
    if (!other) return [];
    const left = semantic(row),
      right = semantic(other);
    return row.collection === other.collection &&
      left !== null &&
      left === right
      ? []
      : [
          {
            id: row.id,
            localCollection: row.collection,
            remoteCollection: other.collection,
          },
        ];
  });
  const projects = new Map(
    [...local, ...remote]
      .filter(
        (row) =>
          row.collection === "items" &&
          localObject(row.value).type === "PROJECT",
      )
      .map((row) => [row.id, localObject(row.value)]),
  );
  const projectHierarchyConflicts = local.flatMap((row) => {
    const value = localObject(row.value),
      other = remoteById.get(row.id);
    if (row.collection !== "items" || value.type !== "PROJECT") return [];
    const remoteParent =
      (other
        ? localObject(other.value).parentProjectId
        : value.parentProjectId) ?? null;
    const missing =
      typeof value.parentProjectId === "string" &&
      !projects.has(value.parentProjectId);
    return missing || remoteParent !== (value.parentProjectId ?? null)
      ? [
          {
            id: row.id,
            reason: missing ? "MISSING_PARENT" : "DIFFERENT_PARENT",
          },
        ]
      : [];
  });
  const resolved = new Set<string>();
  for (const id of projects.keys()) {
    if (resolved.has(id)) continue;
    const path: string[] = [],
      positions = new Map<string, number>();
    let current: string | null = id;
    while (current && projects.has(current) && !resolved.has(current)) {
      const position = positions.get(current);
      if (position !== undefined) {
        for (const cyclicId of path.slice(position))
          projectHierarchyConflicts.push({ id: cyclicId, reason: "CYCLE" });
        break;
      }
      positions.set(current, path.length);
      path.push(current);
      const parent: LocalJson | undefined =
        projects.get(current)!.parentProjectId;
      current = typeof parent === "string" ? parent : null;
    }
    for (const visited of path) resolved.add(visited);
  }
  const taskMembershipConflicts = local.flatMap((row) => {
    const value = localObject(row.value);
    if (row.collection !== "items" || value.type !== "TASK") return [];
    const ids = Array.isArray(value.projectIds) ? value.projectIds : [];
    const missing = ids.filter(
      (id) => typeof id !== "string" || !projects.has(id),
    );
    return missing.length ? [{ id: row.id, missingProjectIds: missing }] : [];
  });
  return {
    localWorkspaceId: localSide.workspaceId,
    remoteWorkspaceId: remoteSide.workspaceId,
    localRevision: localSide.revision,
    remoteRevision: remoteSide.revision,
    counts: { local: counts(local), remote: counts(remote) },
    exactDuplicates: groups(local, remote, (row) => {
      const key = semantic(row);
      return key === null ? [] : [`${row.collection}:${key}`];
    }).map(({ collection, localIds, remoteIds }) => ({
      collection,
      localIds,
      remoteIds,
    })),
    possibleDuplicates: groups(local, remote, (row) => {
      const value = localObject(row.value),
        title = value.title ?? value.name;
      return typeof title === "string" && normalize(title)
        ? [
            `${row.collection}:${String(value.type ?? value.kind ?? "")}:${normalize(title)}`,
          ]
        : [];
    }),
    idCollisions,
    projectHierarchyConflicts,
    taskMembershipConflicts,
    documentNameCollisions: groups(local, remote, (row) => {
      const value = localObject(row.value);
      if (row.collection !== "library" || value.kind !== "DOCUMENT") return [];
      const aliases = Array.isArray(value.aliases) ? value.aliases : [];
      return [value.title, ...aliases]
        .filter(
          (name): name is string =>
            typeof name === "string" && !!normalize(name),
        )
        .map((name) => `${String(value.spaceId)}:${normalize(name)}`);
    }),
    fileHashDuplicates: groups(local, remote, (row) => {
      const value = localObject(row.value);
      return row.collection === "files" && typeof value.contentHash === "string"
        ? [value.contentHash]
        : [];
    }),
  };
}
