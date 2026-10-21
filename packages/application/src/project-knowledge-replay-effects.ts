import { DomainError, requireTitle } from "@arclattice/domain";
import {
  type CanonicalKnowledgeReplayEffect,
  type KnowledgeReplayEffect,
  KnowledgeReplayEffects,
} from "./knowledge-replay-effects";
import type { LibraryStore } from "./library";
import { localDto } from "./local-dto";
import { equalLocalJson } from "./local-json-equal";
import type { NotebookStore } from "./notebook";
import type { ProjectMaterial, ProjectStore } from "./project-materials";

export interface ProjectKnowledgeReplayEffect {
  readonly collection: "projectMaterials" | "library";
  readonly id: string;
  readonly op: "UPSERT";
  readonly baseVersion: number;
}
export interface CanonicalProjectMaterialReplayEffect {
  readonly collection: "projectMaterials";
  readonly id: string;
  readonly op: "UPSERT";
  readonly version: number;
  readonly value: ProjectMaterial;
}
export function requireCanonicalProjectMaterial(
  input: unknown,
  id: string,
  workspaceId: string,
  version: number,
): ProjectMaterial {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DomainError("VALIDATION_ERROR");
  const value = input as ProjectMaterial;
  if (
    value.id !== id ||
    value.workspaceId !== workspaceId ||
    value.version !== version ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !["SPACE", "DOCUMENT"].includes(value.kind) ||
    !["OWNED", "LINKED"].includes(value.ownership) ||
    typeof value.projectId !== "string" ||
    !value.projectId ||
    typeof value.targetId !== "string" ||
    !value.targetId ||
    typeof value.title !== "string" ||
    requireTitle(value.title) !== value.title ||
    value.mime !== null ||
    value.size !== 0 ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    typeof value.updatedBy !== "string" ||
    !value.updatedBy ||
    (value.deletedAt !== null &&
      (typeof value.deletedAt !== "string" ||
        !Number.isFinite(Date.parse(value.deletedAt)))) ||
    (value.role !== undefined &&
      !["PRIMARY", "SUPPORTING", "REFERENCE"].includes(value.role)) ||
    (value.inheritToChildren !== undefined &&
      typeof value.inheritToChildren !== "boolean")
  )
    throw new DomainError("VALIDATION_ERROR", {
      field: "canonicalProjectMaterial",
    });
  return structuredClone(value);
}
/** Read-only pre-v3 metadata. Never accepted as a new Project knowledge write. */
export function requireProjectMaterialReplica(
  input: unknown,
  id: string,
  workspaceId: string,
  version: number,
): ProjectMaterial {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DomainError("VALIDATION_ERROR");
  const value = input as ProjectMaterial;
  if (value.kind !== "FILE")
    return requireCanonicalProjectMaterial(input, id, workspaceId, version);
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "id",
          "workspaceId",
          "projectId",
          "kind",
          "ownership",
          "targetId",
          "title",
          "mime",
          "size",
          "version",
          "updatedBy",
          "updatedAt",
          "deletedAt",
          "role",
          "inheritToChildren",
        ].includes(key),
    ) ||
    value.id !== id ||
    value.workspaceId !== workspaceId ||
    value.version !== version ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    value.ownership !== "OWNED" ||
    value.targetId !== null ||
    typeof value.projectId !== "string" ||
    !value.projectId ||
    typeof value.title !== "string" ||
    requireTitle(value.title) !== value.title ||
    /[\x00-\x1f/\\]/.test(value.title) ||
    value.title.length > 120 ||
    typeof value.mime !== "string" ||
    !/^[\w.+-]+\/[\w.+-]+$/.test(value.mime) ||
    value.mime.length > 127 ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > 2097152 ||
    typeof value.updatedBy !== "string" ||
    !value.updatedBy ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    (value.deletedAt !== null &&
      (typeof value.deletedAt !== "string" ||
        !Number.isFinite(Date.parse(value.deletedAt)))) ||
    (value.role !== undefined &&
      !["PRIMARY", "SUPPORTING", "REFERENCE"].includes(value.role)) ||
    (value.inheritToChildren !== undefined &&
      typeof value.inheritToChildren !== "boolean")
  )
    throw new DomainError("VALIDATION_ERROR", {
      field: "legacyProjectOriginal",
    });
  return structuredClone(value);
}
/** Existing legacy originals may only change lifecycle metadata, never bytes/ownership. */
export function requireLegacyProjectOriginalLifecycle(
  previous: ProjectMaterial,
  value: ProjectMaterial,
  expected: number,
) {
  if (expected < 1 || previous.kind !== "FILE" || value.kind !== "FILE")
    throw new DomainError("VALIDATION_ERROR");
  requireProjectMaterialReplica(
    previous,
    value.id,
    value.workspaceId,
    expected,
  );
  const captured = requireProjectMaterialReplica(
    value,
    previous.id,
    previous.workspaceId,
    expected + 1,
  );
  if (
    !equalLocalJson(
      localDto({
        ...previous,
        version: value.version,
        deletedAt: value.deletedAt,
        updatedBy: value.updatedBy,
        updatedAt: value.updatedAt,
      }),
      localDto(captured),
    )
  )
    throw new DomainError("VALIDATION_ERROR", {
      field: "legacyOriginalLifecycle",
    });
  return captured;
}
/** Composed ports run inside the existing host business/receipt transaction. */
export class ProjectKnowledgeReplayEffects {
  private readonly effects: readonly ProjectKnowledgeReplayEffect[];
  private canonical: readonly (
    | CanonicalProjectMaterialReplayEffect
    | CanonicalKnowledgeReplayEffect
  )[] = [];
  get acceptedEffects() {
    return structuredClone(this.canonical);
  }
  constructor(
    private readonly workspaceId: string,
    private readonly principalId: string,
    effects: readonly ProjectKnowledgeReplayEffect[],
  ) {
    this.effects = structuredClone(effects);
    if (
      !workspaceId ||
      !principalId ||
      !effects.length ||
      effects.length > 100 ||
      new Set(effects.map((effect) => `${effect.collection}:${effect.id}`))
        .size !== effects.length ||
      effects.some(
        (effect) =>
          !["projectMaterials", "library"].includes(effect.collection) ||
          effect.op !== "UPSERT" ||
          typeof effect.id !== "string" ||
          !effect.id ||
          effect.id.length > 240 ||
          !Number.isSafeInteger(effect.baseVersion) ||
          effect.baseVersion < 0,
      ) ||
      !effects.some((effect) => effect.collection === "projectMaterials")
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "projectKnowledgeEffects",
      });
  }
  async run<T>(
    notes: NotebookStore,
    library: LibraryStore,
    projects: ProjectStore,
    operation: (
      notes: NotebookStore,
      library: LibraryStore,
      projects: ProjectStore,
    ) => Promise<T>,
  ) {
    this.canonical = [];
    const effects = this.effects.filter(
      (effect) => effect.collection === "projectMaterials",
    );
    for (const effect of effects) {
      let version = 0;
      try {
        const previous = await projects.get(effect.id);
        if (previous.workspaceId !== this.workspaceId)
          throw new DomainError("FORBIDDEN");
        version = previous.version;
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "NOT_FOUND")
          throw error;
      }
      if (version !== effect.baseVersion)
        throw new DomainError("VERSION_CONFLICT");
    }
    const consumed = new Set<string>();
    const legacyLifecycle = new Set<string>();
    const guarded = new Proxy(projects, {
      get: (target, property) => {
        if (property === "save")
          return async (
            value: ProjectMaterial,
            expected: number,
            base64?: string,
          ) => {
            const effect = effects.find((entry) => entry.id === value.id);
            if (
              !effect ||
              consumed.has(value.id) ||
              effect.baseVersion !== expected ||
              base64 !== undefined
            )
              throw new DomainError("VERSION_CONFLICT");
            const captured =
              value.kind === "FILE" && expected > 0
                ? requireLegacyProjectOriginalLifecycle(
                    await target.get(value.id),
                    value,
                    expected,
                  )
                : requireCanonicalProjectMaterial(
                    value,
                    value.id,
                    this.workspaceId,
                    expected + 1,
                  );
            if (captured.updatedBy !== this.principalId)
              throw new DomainError("FORBIDDEN");
            await target.save(captured, expected);
            if (captured.kind === "FILE") legacyLifecycle.add(value.id);
            consumed.add(value.id);
          };
        if (property === "file")
          return () => {
            throw new DomainError("VALIDATION_ERROR", {
              reason: "FIRST_CLASS_FILE_REQUIRED",
            });
          };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const libraryEffects = this.effects.filter(
      (effect) => effect.collection === "library",
    ) as KnowledgeReplayEffect[];
    const knowledge = libraryEffects.length
      ? new KnowledgeReplayEffects(this.workspaceId, libraryEffects)
      : null;
    const readOnly = <S extends LibraryStore | NotebookStore>(store: S): S =>
      new Proxy(store, {
        get: (target, property) => {
          if (
            [
              "save",
              "purge",
              "putAsset",
              "putAssetChunk",
              "rebuildWikiIndex",
            ].includes(String(property))
          )
            return () => {
              throw new DomainError("VERSION_CONFLICT", {
                field: "undeclaredProjectKnowledgeEffect",
              });
            };
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    const result = knowledge
      ? await knowledge.run(notes, library, (noteStore, libraryStore) =>
          operation(noteStore, libraryStore, guarded),
        )
      : await operation(readOnly(notes), readOnly(library), guarded);
    if (consumed.size !== effects.length)
      throw new DomainError("VERSION_CONFLICT");
    const canonical: CanonicalProjectMaterialReplayEffect[] = [];
    for (const effect of effects)
      canonical.push({
        collection: "projectMaterials",
        id: effect.id,
        op: "UPSERT",
        version: effect.baseVersion + 1,
        value: (legacyLifecycle.has(effect.id)
          ? requireProjectMaterialReplica
          : requireCanonicalProjectMaterial)(
          await projects.get(effect.id),
          effect.id,
          this.workspaceId,
          effect.baseVersion + 1,
        ),
      });
    this.canonical = [...canonical, ...(knowledge?.acceptedEffects ?? [])];
    return result;
  }
}
