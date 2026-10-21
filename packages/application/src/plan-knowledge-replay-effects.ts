import { DomainError } from "@arclattice/domain";
import {
  type CanonicalKnowledgeReplayEffect,
  type KnowledgeReplayEffect,
  KnowledgeReplayEffects,
} from "./knowledge-replay-effects";
import type { LibraryStore } from "./library";
import type { NotebookStore } from "./notebook";
import {
  type CanonicalProjectMaterialReplayEffect,
  type ProjectKnowledgeReplayEffect,
  requireCanonicalProjectMaterial,
} from "./project-knowledge-replay-effects";
import type { ProjectMaterial, ProjectStore } from "./project-materials";

/** PLAN can upgrade a new document binding from LINKED v1 to OWNED v2. */
export class PlanKnowledgeReplayEffects {
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
      effects.length > 2000 ||
      effects.some(
        (e) =>
          !["library", "projectMaterials"].includes(e.collection) ||
          e.op !== "UPSERT" ||
          !e.id ||
          e.id.length > 240 ||
          !Number.isSafeInteger(e.baseVersion) ||
          e.baseVersion < 0,
      )
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "planKnowledgeEffects",
      });
    const versions = new Map<string, number>();
    for (const e of this.effects) {
      const key = JSON.stringify([e.collection, e.id]),
        previous = versions.get(key);
      if (previous !== undefined && previous !== e.baseVersion)
        throw new DomainError("VALIDATION_ERROR", {
          field: "planKnowledgeEffects",
        });
      versions.set(key, e.baseVersion + 1);
    }
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
    const materials = this.effects.filter(
        (e) => e.collection === "projectMaterials",
      ),
      groups = new Map<string, ProjectKnowledgeReplayEffect[]>();
    for (const e of materials) {
      const group = groups.get(e.id);
      if (group) {
        group.push(e);
        continue;
      }
      let version = 0;
      try {
        const value = await projects.get(e.id);
        if (value.workspaceId !== this.workspaceId)
          throw new DomainError("FORBIDDEN");
        version = value.version;
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "NOT_FOUND")
          throw error;
      }
      if (version !== e.baseVersion) throw new DomainError("VERSION_CONFLICT");
      groups.set(e.id, [e]);
    }
    let consumed = 0;
    const guarded = new Proxy(projects, {
      get: (target, property) => {
        if (property === "save")
          return async (
            value: ProjectMaterial,
            base: number,
            bytes?: string,
          ) => {
            const expected = groups.get(value.id)?.shift();
            if (
              !expected ||
              expected.baseVersion !== base ||
              bytes !== undefined
            )
              throw new DomainError("VERSION_CONFLICT");
            const captured = requireCanonicalProjectMaterial(
              value,
              value.id,
              this.workspaceId,
              base + 1,
            );
            if (captured.updatedBy !== this.principalId)
              throw new DomainError("FORBIDDEN");
            await target.save(captured, base);
            consumed++;
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
    const bodyEffects = this.effects.filter(
      (e) => e.collection === "library",
    ) as KnowledgeReplayEffect[];
    const knowledge = bodyEffects.length
      ? new KnowledgeReplayEffects(this.workspaceId, bodyEffects)
      : null;
    const readOnly = <S extends NotebookStore | LibraryStore>(store: S): S =>
      new Proxy(store, {
        get(target, property) {
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
                field: "undeclaredPlanKnowledgeEffect",
              });
            };
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    const result = knowledge
      ? await knowledge.run(notes, library, (n, l) => operation(n, l, guarded))
      : await operation(readOnly(notes), readOnly(library), guarded);
    if (consumed !== materials.length)
      throw new DomainError("VERSION_CONFLICT");
    const canonical: CanonicalProjectMaterialReplayEffect[] = [];
    for (const e of new Map(materials.map((e) => [e.id, e])).values())
      canonical.push({
        collection: "projectMaterials",
        id: e.id,
        op: "UPSERT",
        version: e.baseVersion + 1,
        value: requireCanonicalProjectMaterial(
          await projects.get(e.id),
          e.id,
          this.workspaceId,
          e.baseVersion + 1,
        ),
      });
    this.canonical = [...canonical, ...(knowledge?.acceptedEffects ?? [])];
    return result;
  }
}
