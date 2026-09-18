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

export interface ProjectCategory {
  id: string;
  workspaceId: string;
  name: string;
  icon: string;
  color: string;
  position: number;
  projectIds: string[];
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
  async list(context: ActorContext) {
    await this.authorization.require(context, "work:read");
    return this.uow.run(context.workspaceId, async (tx) =>
      (await tx.categories()).map(categoryPresentation).sort(compareCategories),
    );
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
      projectIds: string[];
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
      !Array.isArray(input.projectIds) ||
      input.projectIds.length > 100 ||
      input.projectIds.some(
        (id) => typeof id !== "string" || !id || id.length > 240,
      ) ||
      new Set(input.projectIds).size !== input.projectIds.length ||
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
      const unchanged =
        old &&
        JSON.stringify(old.projectIds) === JSON.stringify(input.projectIds);
      if (!unchanged)
        for (const id of input.projectIds) {
          const project = await tx.get(id);
          if (project.type !== "PROJECT" || project.deletedAt)
            throw new DomainError("VALIDATION_ERROR");
        }
      const now = this.clock.now();
      const previous = categoryPresentation(old ?? {});
      const presentation = {
        icon: input.icon === undefined ? previous.icon : input.icon,
        color: input.color === undefined ? previous.color : input.color,
        position:
          input.position === undefined ? previous.position : input.position,
      };
      if (
        typeof presentation.icon !== "string" ||
        /[<>&]/u.test(presentation.icon) ||
        !/^[\p{L}\p{N}\p{S}\p{M}\u200d\uFE0F _-]{0,16}$/u.test(
          presentation.icon,
        ) ||
        typeof presentation.color !== "string" ||
        !/^#[0-9a-fA-F]{6}$/.test(presentation.color) ||
        !Number.isSafeInteger(presentation.position) ||
        presentation.position < 0 ||
        presentation.position > 2147483647
      )
        throw new DomainError("VALIDATION_ERROR");
      const category: ProjectCategory = {
        id: old?.id ?? this.ids.next(),
        workspaceId: context.workspaceId,
        name,
        icon: presentation.icon,
        color: presentation.color.toLowerCase(),
        position: presentation.position,
        projectIds: [...input.projectIds],
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
