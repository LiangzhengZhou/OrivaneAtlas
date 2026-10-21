import { DomainError, requireTitle } from "@arclattice/domain";
import {
  type CategoryChange,
  type ProjectCategory,
  requireCategoryPresentation,
} from "./categories";
import type { UnitOfWork, WorkTransaction } from "./index";

export interface CategoryReplayEffect {
  readonly collection: "categories";
  readonly id: string;
  readonly op: "UPSERT";
  readonly baseVersion: number;
}
export interface CanonicalCategoryReplayEffect {
  readonly collection: "categories";
  readonly id: string;
  readonly op: "UPSERT";
  readonly version: number;
  readonly value: ProjectCategory;
}
export function requireCanonicalCategory(
  input: unknown,
  id: string,
  workspaceId: string,
  version: number,
): ProjectCategory {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DomainError("VALIDATION_ERROR");
  const value = input as ProjectCategory;
  if (
    value.id !== id ||
    value.workspaceId !== workspaceId ||
    value.version !== version ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    typeof value.name !== "string" ||
    requireTitle(value.name) !== value.name ||
    typeof value.createdBy !== "string" ||
    !value.createdBy ||
    typeof value.updatedBy !== "string" ||
    !value.updatedBy ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    (value.deletedAt !== null &&
      (typeof value.deletedAt !== "string" ||
        !Number.isFinite(Date.parse(value.deletedAt))))
  )
    throw new DomainError("VALIDATION_ERROR", { field: "canonicalCategory" });
  requireCategoryPresentation(value);
  if (value.color !== value.color.toLowerCase())
    throw new DomainError("VALIDATION_ERROR", { field: "canonicalCategory" });
  return structuredClone(value);
}

export class CategoryReplayUnitOfWork implements UnitOfWork {
  private readonly effects: readonly CategoryReplayEffect[];
  private canonical: readonly CanonicalCategoryReplayEffect[] = [];
  get acceptedEffects(): readonly CanonicalCategoryReplayEffect[] {
    return structuredClone(this.canonical);
  }
  constructor(
    private readonly delegate: UnitOfWork,
    private readonly workspaceId: string,
    private readonly principalId: string,
    effects: readonly CategoryReplayEffect[],
  ) {
    this.effects = structuredClone(effects);
    if (
      !effects.length ||
      effects.length > 2000 ||
      new Set(this.effects.map((effect) => effect.id)).size !==
        effects.length ||
      this.effects.some(
        (effect) =>
          effect.collection !== "categories" ||
          effect.op !== "UPSERT" ||
          !effect.id ||
          !Number.isSafeInteger(effect.baseVersion) ||
          effect.baseVersion < 0,
      )
    )
      throw new DomainError("VALIDATION_ERROR", { field: "effects" });
  }
  async run<T>(
    workspaceId: string,
    operation: (tx: WorkTransaction) => T | Promise<T>,
  ): Promise<T> {
    if (workspaceId !== this.workspaceId) throw new DomainError("FORBIDDEN");
    this.canonical = [];
    const expected = new Map(this.effects.map((effect) => [effect.id, effect])),
      principalId = this.principalId;
    const outcome = await this.delegate.run(workspaceId, async (tx) => {
      const old = new Map(
        (await tx.categories()).map((value) => [value.id, value]),
      );
      for (const effect of expected.values())
        if (
          (old.get(effect.id)?.version ?? 0) !== effect.baseVersion ||
          (old.has(effect.id) &&
            old.get(effect.id)?.workspaceId !== workspaceId)
        )
          throw new DomainError("VERSION_CONFLICT");
      const consumed = new Set<string>(),
        journaled = new Set<string>();
      const guarded = new Proxy(tx, {
        get(target, property) {
          if (property === "saveCategory")
            return async (value: ProjectCategory, version: number) => {
              const effect = expected.get(value.id);
              if (
                !effect ||
                consumed.has(value.id) ||
                effect.baseVersion !== version
              )
                throw new DomainError("VERSION_CONFLICT");
              const canonical = requireCanonicalCategory(
                value,
                effect.id,
                workspaceId,
                version + 1,
              );
              consumed.add(effect.id);
              await target.saveCategory(canonical, version);
            };
          if (property === "appendCategoryChange")
            return async (event: CategoryChange) => {
              const effect = expected.get(event.categoryId);
              if (
                !effect ||
                !consumed.has(effect.id) ||
                journaled.has(effect.id) ||
                event.workspaceId !== workspaceId ||
                event.principalId !== principalId ||
                event.version !== effect.baseVersion + 1
              )
                throw new DomainError("VERSION_CONFLICT");
              journaled.add(effect.id);
              await target.appendCategoryChange(event);
            };
          if (
            [
              "insert",
              "replace",
              "purge",
              "addEdge",
              "removeEdge",
              "appendActivity",
              "appendOutbox",
            ].includes(String(property)) ||
            (typeof property === "string" && property.startsWith("save"))
          )
            return () => {
              throw new DomainError("VALIDATION_ERROR", {
                field: "replayCommand",
              });
            };
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const result = await operation(guarded);
      if (consumed.size !== expected.size || journaled.size !== expected.size)
        throw new DomainError("VERSION_CONFLICT");
      const current = new Map(
        (await tx.categories()).map((value) => [value.id, value]),
      );
      return {
        result,
        canonical: this.effects.map(
          (effect): CanonicalCategoryReplayEffect => ({
            collection: "categories",
            id: effect.id,
            op: "UPSERT",
            version: effect.baseVersion + 1,
            value: requireCanonicalCategory(
              current.get(effect.id),
              effect.id,
              workspaceId,
              effect.baseVersion + 1,
            ),
          }),
        ),
      };
    });
    this.canonical = outcome.canonical;
    return outcome.result;
  }
}
