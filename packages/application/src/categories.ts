import {
  type ActorContext,
  DomainError,
  requireTitle,
} from "@arclattice/domain";
import type {
  AuthorizationService,
  Clock,
  IdGenerator,
  UnitOfWork,
} from "./index";
import { stableEntityIds } from "./stable-entity-ids";

export interface ProjectCategory {
  id: string;
  workspaceId: string;
  name: string;
  icon: string;
  color: string;
  position: number;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface CategoryChange {
  id: string;
  workspaceId: string;
  principalId: string;
  categoryId: string;
  version: number;
  occurredAt: string;
}
export class CategoryService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}
  async createWithStableId(
    contextInput: ActorContext,
    id: string,
    input: Omit<Parameters<CategoryService["save"]>[1], "id">,
  ) {
    const context = Object.freeze({ ...contextInput }),
      captured = structuredClone(input);
    await this.authorization.require(
      context,
      captured.deleted ? "work:delete" : "work:create",
    );
    if (Object.hasOwn(captured, "id"))
      throw new DomainError("VALIDATION_ERROR");
    const ids = stableEntityIds(this.ids, "CATEGORY", id);
    const uow: UnitOfWork = {
      run: (workspaceId, operation) =>
        this.uow.run(workspaceId, async (tx) => {
          if (workspaceId !== context.workspaceId)
            throw new DomainError("FORBIDDEN");
          if ((await tx.categories()).some((category) => category.id === id))
            throw new DomainError("VERSION_CONFLICT");
          return operation(tx);
        }),
    };
    return new CategoryService(uow, this.authorization, this.clock, ids).save(
      context,
      captured,
    );
  }
  async list(context: ActorContext) {
    await this.authorization.require(context, "work:read");
    return this.uow.run(context.workspaceId, async (tx) =>
      (await tx.categories()).map(categoryPresentation).sort(compareCategories),
    );
  }
  async reorder(
    context: ActorContext,
    ordered: readonly { readonly id: string; readonly version: number }[],
  ): Promise<ProjectCategory[]> {
    await this.authorization.require(context, "work:update");
    return this.uow.run(context.workspaceId, async (tx) => {
      const current = (await tx.categories()).filter(
        (category) => !category.deletedAt,
      );
      const byId = new Map(current.map((category) => [category.id, category]));
      const seen = new Set<string>();
      if (ordered.length !== current.length)
        throw new DomainError("VERSION_CONFLICT", {
          reason: "CATEGORY_MEMBERSHIP_CHANGED",
        });
      for (const member of ordered) {
        if (seen.has(member.id) || !byId.has(member.id))
          throw new DomainError("VALIDATION_ERROR", {
            reason: "INVALID_CATEGORY_ORDER",
          });
        seen.add(member.id);
        if (byId.get(member.id)?.version !== member.version)
          throw new DomainError("VERSION_CONFLICT");
      }
      if (ordered.length * 1024 > 2147483647)
        throw new DomainError("VALIDATION_ERROR", {
          reason: "CATEGORY_ORDER_TOO_LARGE",
        });
      const now = this.clock.now();
      const result: ProjectCategory[] = [];
      for (const [index, member] of ordered.entries()) {
        const old = byId.get(member.id);
        if (!old) throw new DomainError("NOT_FOUND");
        const position = (index + 1) * 1024;
        if (old.position === position) {
          result.push(old);
          continue;
        }
        const category: ProjectCategory = {
          ...old,
          position,
          version: old.version + 1,
          updatedAt: now,
          updatedBy: context.principalId,
        };
        await tx.saveCategory(category, old.version);
        await tx.appendCategoryChange({
          id: this.ids.next(),
          workspaceId: context.workspaceId,
          principalId: context.principalId,
          categoryId: category.id,
          version: category.version,
          occurredAt: now,
        });
        result.push(category);
      }
      return result;
    });
  }
  async save(
    context: ActorContext,
    input: {
      id?: string;
      version: number;
      name: string;
      icon?: string;
      color?: string;
      position?: number;
      deleted: boolean;
    },
  ) {
    await this.authorization.require(
      context,
      input.deleted ? "work:delete" : input.id ? "work:update" : "work:create",
    );
    const name = requireTitle(input.name);
    if (
      !Number.isSafeInteger(input.version) ||
      input.version < 0 ||
      typeof input.deleted !== "boolean" ||
      (!input.id && (input.version !== 0 || input.deleted))
    )
      throw new DomainError("VALIDATION_ERROR");
    return this.uow.run(context.workspaceId, async (tx) => {
      const categories = await tx.categories();
      const old = input.id
        ? categories.find((c) => c.id === input.id)
        : undefined;
      if (input.id && !old) throw new DomainError("NOT_FOUND");
      if ((old?.version ?? 0) !== input.version)
        throw new DomainError("VERSION_CONFLICT");
      if (
        categories.some(
          (c) =>
            c.id !== input.id &&
            !c.deletedAt &&
            c.name.toLocaleLowerCase("en-US") ===
              name.toLocaleLowerCase("en-US"),
        ) &&
        !input.deleted
      )
        throw new DomainError("VALIDATION_ERROR");
      const now = this.clock.now();
      const previous = categoryPresentation(old ?? {});
      const presentation = {
        icon: input.icon === undefined ? previous.icon : input.icon,
        color: input.color === undefined ? previous.color : input.color,
        position:
          input.position === undefined ? previous.position : input.position,
      };
      requireCategoryPresentation(presentation);
      const category: ProjectCategory = {
        id: old?.id ?? this.ids.nextFor?.("CATEGORY") ?? this.ids.next(),
        workspaceId: context.workspaceId,
        name,
        icon: presentation.icon,
        color: presentation.color.toLowerCase(),
        position: presentation.position,
        version: input.version + 1,
        createdBy: old?.createdBy ?? context.principalId,
        updatedBy: context.principalId,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
        deletedAt: input.deleted ? (old?.deletedAt ?? now) : null,
      };
      await tx.saveCategory(category, input.version);
      await tx.appendCategoryChange({
        id: this.ids.next(),
        workspaceId: context.workspaceId,
        principalId: context.principalId,
        categoryId: category.id,
        version: category.version,
        occurredAt: now,
      });
      return category;
    });
  }
}

export function requireCategoryPresentation(input: {
  icon: string;
  color: string;
  position: number;
}): void {
  if (
    typeof input.icon !== "string" ||
    /[<>&]/u.test(input.icon) ||
    !/^[\p{L}\p{N}\p{S}\p{M}\u200d\uFE0F _-]{0,16}$/u.test(input.icon) ||
    typeof input.color !== "string" ||
    !/^#[0-9a-fA-F]{6}$/.test(input.color) ||
    !Number.isSafeInteger(input.position) ||
    input.position < 0 ||
    input.position > 2147483647
  )
    throw new DomainError("VALIDATION_ERROR");
}

export function categoryPresentation<
  T extends { icon?: string; color?: string; position?: number },
>(category: T) {
  return {
    ...category,
    icon: category.icon ?? "",
    color: category.color ?? "#7863c5",
    position: category.position ?? 0,
  };
}

export function compareCategories(
  left: ProjectCategory,
  right: ProjectCategory,
) {
  return (
    left.position - right.position ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}
